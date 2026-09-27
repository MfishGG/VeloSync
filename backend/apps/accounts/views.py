import secrets
from urllib.parse import quote

from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.shortcuts import redirect
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView  # noqa: F401 （路由复用）

from . import social
from .serializers import RegisterSerializer, UserSerializer
from .social import SocialError


def _token_pair(user) -> dict:
    refresh = RefreshToken.for_user(user)
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "user": UserSerializer(user).data,
    }


class LoginView(APIView):
    """POST /api/auth/login/ —— JWT 登录"""

    permission_classes = [AllowAny]

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
    """GET /api/auth/me/ —— 当前用户信息"""

    def get(self, request):
        return Response(UserSerializer(request.user).data)


# ---------------- 第三方快捷登录（微信 / QQ / 微博）----------------


class SocialProvidersView(APIView):
    """GET /api/auth/social/providers/ —— 可用快捷登录方式（含 oauth / mock 模式标记）"""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"results": social.list_providers()})


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
