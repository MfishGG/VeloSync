import secrets
from urllib.parse import quote

from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.shortcuts import redirect
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView

from . import social
from .models import UserProfile
from .serializers import RegisterSerializer, UserSerializer
from .social import PROVIDER_META, SocialError


class ThrottledTokenRefreshView(TokenRefreshView):
    """refresh 换 access。也要限流 —— 否则可以拿一个 refresh token 无限刷 access。"""

    throttle_scope = "login"


def _token_pair(user) -> dict:
    refresh = RefreshToken.for_user(user)
    # 预取绑定关系：让登录响应里的 user 直接带上微信头像 / OpenID，免前端二次请求
    full = User.objects.filter(pk=user.pk).prefetch_related("social_accounts").first() or user
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "user": UserSerializer(full).data,
    }


class LoginView(APIView):
    """POST /api/auth/login/ —— JWT 登录"""

    permission_classes = [AllowAny]
    # 无锁定、无验证码，不限流就是可无限撞库的敞口
    throttle_scope = "login"

    def post(self, request):
        username = request.data.get("username", "")
        password = request.data.get("password", "")
        user = authenticate(username=username, password=password)
        if user is None:
            return Response({"detail": "用户名或密码错误"}, status=status.HTTP_400_BAD_REQUEST)
        return Response(_token_pair(user))


class RegisterView(APIView):
    """POST /api/auth/register/ —— 注册"""

    permission_classes = [AllowAny]
    throttle_scope = "register"

    def post(self, request):
        ser = RegisterSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        if User.objects.filter(username=data["username"]).exists():
            return Response({"detail": "用户名已存在"}, status=status.HTTP_400_BAD_REQUEST)
        user = User.objects.create_user(
            username=data["username"],
            password=data["password"],
            email=data.get("email", ""),
            first_name=data.get("nickname", ""),
        )
        return Response(_token_pair(user), status=status.HTTP_201_CREATED)


class MeView(APIView):
    """GET /api/auth/me/ —— 当前用户信息（含第三方绑定：微信头像 / OpenID）"""

    def get(self, request):
        user = (
            User.objects.filter(pk=request.user.pk).prefetch_related("social_accounts").first()
        ) or request.user
        return Response(UserSerializer(user).data)


class BindPhoneView(APIView):
    """POST /api/auth/phone/ —— 绑定 / 换绑手机号

    手机号在本项目**仅作展示与联系方式**，不承担登录身份，因此：
    - 允许重复（不做唯一约束）；
    - 允许后续换绑；
    - 只接受微信 `getPhoneNumber` 的动态令牌换取的真实号码，不接受前端直接传号码
      （前端不是安全边界，直接传号码等于任何人都能伪造）。
    """

    # 每次调用都要去微信换 access_token + 消费一次性 code，会消耗接口额度
    throttle_scope = "phone"

    def post(self, request):
        code = (request.data.get("code") or "").strip()
        if not code:
            return Response(
                {"detail": "缺少手机号授权凭证 code"}, status=status.HTTP_400_BAD_REQUEST
            )
        try:
            phone = social.exchange_phone_number(code)
        except SocialError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        profile.phone = phone
        profile.phone_bound_at = timezone.now()
        profile.save(update_fields=["phone", "phone_bound_at", "updated_at"])

        user = (
            User.objects.filter(pk=request.user.pk).prefetch_related("social_accounts").first()
        ) or request.user
        return Response(UserSerializer(user).data)


# 头像上限。前端用 canvas 压到 200KB 以内再传，这里留一倍余量防止绕过前端。
AVATAR_MAX_BYTES = 400 * 1024
# 只收 dataURL 形式的图片与 http(s) 远程地址，杜绝 javascript: 之类被当成 URL 用
_AVATAR_DATA_URL_PREFIX = "data:image/"


def _validate_avatar(value: str) -> str:
    """校验并归一化头像值；不合法则抛 ValueError（由调用方转 400）。"""
    value = (value or "").strip()
    if not value:
        return ""
    if value.startswith(_AVATAR_DATA_URL_PREFIX):
        if ";base64," not in value:
            raise ValueError("头像 dataURL 必须是 base64 编码")
        # base64 约 4/3 膨胀，反推原始字节数做体积校验
        b64 = value.split(";base64,", 1)[1]
        if len(b64) * 3 // 4 > AVATAR_MAX_BYTES:
            raise ValueError("头像文件过大，请压缩后重试")
        return value
    if value.startswith("http://") or value.startswith("https://"):
        if len(value) > 2048:
            raise ValueError("头像链接过长")
        return value
    raise ValueError("头像格式不支持，仅接受图片 dataURL 或 http(s) 链接")


class UpdateProfileView(APIView):
    """PATCH /api/auth/profile/ —— 更新昵称 / 头像

    背景：微信自 2022-10-24 起收紧 `getUserProfile`，回调一律返回灰色默认头像
    与「微信用户」占位昵称，无法再一键授权拿到真实资料。官方替代方案是
    「头像昵称填写能力」——由用户主动选头像（`open-type="chooseAvatar"`）+
    填昵称（`<input type="nickname">`）。本接口承接其结果。

    昵称同时写入 `user.first_name` 与微信绑定的 `SocialAccount.nickname`，
    保证个人页、工作台、绑定列表三处显示一致。
    """

    throttle_scope = "profile"

    def patch(self, request):
        updates = {}
        if "nickname" in request.data:
            nickname = (request.data.get("nickname") or "").strip()
            if len(nickname) > 50:
                return Response(
                    {"detail": "昵称过长（最多 50 字）"}, status=status.HTTP_400_BAD_REQUEST
                )
            updates["nickname"] = nickname

        if "avatar" in request.data:
            try:
                updates["avatar"] = _validate_avatar(request.data.get("avatar"))
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        if not updates:
            return Response(
                {"detail": "没有需要更新的字段"}, status=status.HTTP_400_BAD_REQUEST
            )

        user = request.user
        if "nickname" in updates:
            nickname = updates["nickname"]
            user.first_name = nickname
            user.save(update_fields=["first_name"])
            # 同步到微信绑定，避免「个人页显示 A、绑定列表显示 B」
            user.social_accounts.filter(provider="wechat").update(nickname=nickname)

        if "avatar" in updates:
            profile, _ = UserProfile.objects.get_or_create(user=user)
            profile.avatar = updates["avatar"]
            profile.save(update_fields=["avatar", "updated_at"])

        full = (
            User.objects.filter(pk=user.pk).prefetch_related("social_accounts").first()
        ) or user
        return Response(UserSerializer(full).data)


# ---------------- 第三方快捷登录（微信 / QQ / 微博）----------------


class SocialProvidersView(APIView):
    """GET /api/auth/social/providers/ —— 可用快捷登录方式（含 oauth / mock 模式标记）

    可选 `?channel=web|miniprogram` 过滤：
    - `web`（默认行为）只返回网页端可用的方式
    - `miniprogram` 额外附上 `wechat_mp`（wx.login → code2session），仅供小程序端

    返回项均带 `channel` 字段，前端应据此渲染，不要硬编码平台 code。
    """

    permission_classes = [AllowAny]

    def get(self, request):
        channel = (request.query_params.get("channel") or "").strip().lower()
        is_mp = channel == "miniprogram"
        results = social.list_providers("" if is_mp else "web")
        if is_mp:
            # 微信小程序登录（wx.login → code2session）单独列出，供小程序端渲染一键登录按钮。
            # 默认（不传 channel）与 channel=web 都不下发，避免网页端渲染出不可用的按钮。
            results.append(
                {
                    "code": "wechat_mp",
                    "name": "微信一键登录",
                    "color": PROVIDER_META.get("wechat", {}).get("color", "#07C160"),
                    "icon": "wechat",
                    "enabled": social.miniprogram_enabled(),
                    "mode": "oauth" if social.miniprogram_enabled() else "mock",
                    "channel": "miniprogram",
                }
            )
        return Response({"results": results})


class SocialAuthorizeView(APIView):
    """GET /api/auth/social/{provider}/authorize/ —— 取授权地址（mock 模式无地址）"""

    permission_classes = [AllowAny]

    def get(self, request, provider):
        try:
            if not social.is_enabled(provider):
                return Response({"provider": provider, "mode": "mock"})
            state = secrets.token_urlsafe(16)
            request.session[f"social_state_{provider}"] = state
            return Response(
                {
                    "provider": provider,
                    "mode": "oauth",
                    "authorize_url": social.build_authorize_url(provider, state),
                }
            )
        except SocialError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


class SocialLoginView(APIView):
    """POST /api/auth/social/login/ —— 第三方登录/注册，直接返回 JWT

    - oauth 模式：传 {provider, code}，后端用 code 换 openid；
    - mock  模式：传 {provider, identity}，identity 为演示身份（昵称），无凭证也可完整体验。
    """

    permission_classes = [AllowAny]
    throttle_scope = "login"

    def post(self, request):
        provider = (request.data.get("provider") or "").strip()
        code = (request.data.get("code") or "").strip()
        identity = (request.data.get("identity") or "").strip()

        try:
            if social.is_enabled(provider):
                profile = social.exchange_profile(provider, code)
            else:
                profile = social.mock_profile(provider, identity or code or "骑行爱好者")
            user, created = social.get_or_create_user(provider, profile)
        except SocialError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:  # 网络异常 / 平台接口变更
            return Response({"detail": f"第三方登录失败：{exc}"}, status=status.HTTP_400_BAD_REQUEST)

        payload = _token_pair(user)
        payload["created"] = created
        payload["provider"] = provider
        return Response(payload, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class SocialCallbackView(APIView):
    """GET /api/auth/social/{provider}/callback/ —— 真实 OAuth 回调，签发 JWT 后回跳前端"""

    permission_classes = [AllowAny]

    def get(self, request, provider):
        frontend = settings.FRONTEND_URL.rstrip("/")
        code = request.query_params.get("code", "")
        try:
            profile = social.exchange_profile(provider, code)
            user, created = social.get_or_create_user(provider, profile)
            pair = _token_pair(user)
        except Exception as exc:
            return redirect(f"{frontend}/login?social_error={quote(str(exc))}")

        url = (
            f"{frontend}/auth/callback?access={pair['access']}&refresh={pair['refresh']}"
            f"&provider={provider}&created={int(created)}"
        )
        return redirect(url)


class WxMiniProgramLoginView(APIView):
    """微信小程序一键登录

    - GET  /api/auth/wx/miniprogram/  → 查询当前模式（oauth / mock），前端据此提示
    - POST /api/auth/wx/miniprogram/  → 请求体 { code, nickname?, avatar?, identity? }

    `code` 来自 wx.login()；未配置小程序 AppID/AppSecret 时用客户端稳定 device id
    （`identity`）派生演示 openid，保证本地无凭证也能跑通且账号稳定。
    """

    permission_classes = [AllowAny]
    throttle_scope = "login"

    def get(self, request):
        enabled = social.miniprogram_enabled()
        return Response({"enabled": enabled, "mode": "oauth" if enabled else "mock"})

    def post(self, request):
        code = (request.data.get("code") or "").strip()
        nickname = (request.data.get("nickname") or "").strip()
        avatar = (request.data.get("avatar") or "").strip()
        identity = (request.data.get("identity") or "").strip()
        try:
            profile = social.miniprogram_profile(code, nickname, avatar, identity)
            user, created = social.get_or_create_user("wechat", profile)
        except SocialError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:  # 网络异常 / 微信接口变更
            return Response(
                {"detail": f"微信小程序登录失败：{exc}"}, status=status.HTTP_400_BAD_REQUEST
            )

        payload = _token_pair(user)
        payload["created"] = created
        payload["provider"] = "wechat"
        payload["mode"] = "oauth" if social.miniprogram_enabled() else "mock"
        return Response(payload, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
