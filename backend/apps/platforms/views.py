import logging
import uuid
from urllib.parse import quote as urlquote

from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.shortcuts import redirect
from rest_framework import viewsets
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.synclogs.models import SyncLog

from .adapters import get_adapter
from .models import Platform, PlatformAccount
from .serializers import PlatformAccountSerializer, PlatformSerializer
from .tokens import TokenError, post_json, resolve_expiry

logger = logging.getLogger(__name__)

#: OAuth state 的有效期（秒）。签名有效期与一次性 nonce 的缓存 TTL 保持一致。
STATE_MAX_AGE = 600

#: 一次性 nonce 的缓存键前缀
_STATE_KEY = "oauth_state:{}"


def _redirect_uri(request, code: str) -> str:
    """OAuth 回调地址。

    优先用 `PLATFORM_REDIRECT_BASE_URL`（各平台要求 redirect_uri 与后台登记值
    **逐字匹配**，写死一个值比每次靠请求头推导更可靠）；未配置时用
    `build_absolute_uri()` —— 它现在能拿到 https，因为 settings 里声明了
    `SECURE_PROXY_SSL_HEADER`。此前没声明时这里恒为 `http://`，
    而平台都要求 HTTPS，真实 OAuth 必然在授权页报 redirect_uri 不匹配。
    """
    path = f"/api/accounts/{code}/callback/"
    base = getattr(settings, "PLATFORM_REDIRECT_BASE_URL", "").rstrip("/")
    return f"{base}{path}" if base else request.build_absolute_uri(path)


class PlatformViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/platforms/ —— 支持的平台列表"""

    queryset = Platform.objects.filter(is_active=True)
    serializer_class = PlatformSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None


class PlatformAccountViewSet(viewsets.ModelViewSet):
    """GET /api/accounts/ · DELETE /api/accounts/{id}/ —— 已绑定账号管理"""

    serializer_class = PlatformAccountSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "delete", "head", "options"]
    pagination_class = None

    def get_queryset(self):
        return (
            PlatformAccount.objects.filter(user=self.request.user)
            .select_related("platform")
            .order_by("id")
        )

    def perform_destroy(self, instance):
        """解绑：先通知平台撤销授权，再删本地记录。

        此前只删了本地记录，平台侧授权仍然有效 —— 用户以为已断开、实际没有，
        Strava 的开发者协议明确要求应用支持 deauthorize。撤销失败也要继续本地解绑
        （否则用户会被一条删不掉的记录困住），但记 warning 以便排查。
        """
        revoked = False
        if not instance.is_demo:
            try:
                revoked = get_adapter(instance).revoke_token()
            except Exception as exc:  # noqa: BLE001 —— 平台侧失败不应阻断本地解绑
                logger.warning("撤销 %s 授权失败：%s", instance.platform.code, exc)

        SyncLog.objects.create(
            user=self.request.user,
            level="warning",
            message=(
                f"解绑平台账号 {instance.platform.name} · "
                f"{instance.display_name or instance.platform_user_id}"
                + ("（已通知平台撤销授权）" if revoked else "（未能通知平台撤销授权，平台侧授权可能仍然有效）")
            ),
        )
        instance.delete()


def demo_bind(platform: Platform, user) -> tuple[PlatformAccount, bool]:
    """未配置 OAuth 凭证时的**本地演示绑定**。

    真实接入需要去各平台开放平台申请应用（client_id / client_secret），
    在拿到凭证之前，用这个入口签发一个演示 Token，让「绑定 → 建同步任务 → 运行 → 看日志」
    的整条链路可以完整跑通（平台侧不会收到真实请求）。
    """
    account, created = PlatformAccount.objects.update_or_create(
        user=user,
        platform=platform,
        platform_user_id=f"demo-{platform.code}-{user.id}",
        defaults={"status": "active", "display_name": f"{platform.name} 演示账号"},
    )
    account.set_tokens(f"demo-token-{uuid.uuid4().hex[:12]}")
    account.save()
    SyncLog.objects.create(
        user=user,
        level="warning",
        message=(
            f"{platform.name} 未配置 OAuth 凭证，已按【演示身份】绑定（仅用于本地体验，"
            f"无法真实拉取/上传数据）"
        ),
    )
    return account, created


class AuthorizeView(APIView):
    """GET /api/accounts/{platform}/authorize/ —— 获取 OAuth 授权 URL"""

    permission_classes = [IsAuthenticated]

    def get(self, request, code: str):
        platform = Platform.objects.filter(code=code, is_active=True).first()
        if platform is None:
            return Response({"detail": f"平台 {code} 不存在"}, status=400)

        # 演示平台：直接创建账号，无需跳转
        if platform.auth_type == "mock":
            account, _ = PlatformAccount.objects.get_or_create(
                user=request.user,
                platform=platform,
                platform_user_id=f"mock-{request.user.id}",
                defaults={"display_name": "演示账号", "status": "active"},
            )
            if not account.access_token:
                account.set_tokens(f"mock-token-{uuid.uuid4().hex[:12]}")
                account.save()
            return Response({"authorize_url": None, "mock": True, "account_id": account.id})

        # 凭证不齐：返回结构化错误，前端据此引导「以演示身份绑定」
        if not platform.oauth_ready:
            return Response(
                {
                    "code": "oauth_not_configured",
                    "detail": (
                        f"{platform.name} 尚未配置 OAuth 凭证（"
                        + "、".join(platform.oauth_missing)
                        + "），请在平台数据中补充，或先以演示身份绑定"
                    ),
                    "platform": platform.code,
                    "platform_name": platform.name,
                    "missing": platform.oauth_missing,
                    "missing_labels": [
                        Platform.CREDENTIAL_LABELS[f] for f in platform.oauth_missing
                    ],
                    "can_demo_bind": True,
                },
                status=400,
            )

        # 签名里带上 nonce，并把它记进缓存 —— 回调时消费掉。
        # 只靠签名的话 state 在 10 分钟内**可以重复使用**（无 nonce、无一次性消费），
        # 一次授权码被重放就能反复创建绑定。
        nonce = uuid.uuid4().hex
        cache.set(_STATE_KEY.format(nonce), code, timeout=STATE_MAX_AGE)
        state = signing.dumps({"user_id": request.user.id, "platform": code, "nonce": nonce})

        params = {
            "client_id": platform.client_id,
            "response_type": "code",
            "redirect_uri": _redirect_uri(request, code),
            "scope": " ".join(platform.scopes or []),
            "state": state,
        }
        query = "&".join(f"{k}={urlquote(str(v))}" for k, v in params.items())
        return Response({"authorize_url": f"{platform.authorize_url}?{query}", "state": state})


class DemoBindView(APIView):
    """POST /api/accounts/{platform}/demo-bind/ —— 未配置凭证时以演示身份绑定"""

    permission_classes = [IsAuthenticated]

    def post(self, request, code: str):
        platform = Platform.objects.filter(code=code, is_active=True).first()
        if platform is None:
            return Response({"detail": f"平台 {code} 不存在"}, status=400)
        if platform.auth_type == "mock":
            return Response({"detail": f"{platform.name} 是演示平台，直接点「绑定账号」即可"}, status=400)
        if platform.oauth_ready:
            return Response(
                {"detail": f"{platform.name} 已配置 OAuth 凭证，请走正常授权流程"},
                status=400,
            )
        account, created = demo_bind(platform, request.user)
        return Response(
            {
                "account_id": account.id,
                "created": created,
                "demo": True,
                "detail": f"已以演示身份绑定 {platform.name}（本地体验用）",
            },
            status=201 if created else 200,
        )


class CallbackView(APIView):
    """GET /api/accounts/{platform}/callback/ —— OAuth 回调：交换并加密存储 Token"""

    permission_classes = [AllowAny]  # 由平台重定向回来，无 JWT

    def get(self, request, code: str):
        frontend = settings.FRONTEND_URL.rstrip("/")

        def back(ok: bool, msg: str = ""):
            suffix = f"?bind={'ok' if ok else 'error'}&msg={urlquote(msg)}"
            return redirect(f"{frontend}/accounts{suffix}")

        try:
            state = signing.loads(request.query_params.get("state", ""), max_age=STATE_MAX_AGE)
        except Exception:
            return back(False, "state 校验失败，请重新发起授权")

        user_id = state.get("user_id")
        platform = Platform.objects.filter(code=code, is_active=True).first()
        if user_id is None or platform is None:
            return back(False, "授权参数无效")

        # ① state 必须是为**这个平台**签发的。此前只校验了 user_id，
        #    于是给平台 A 签发的 state 可以拿去平台 B 的 callback 用。
        if state.get("platform") != code:
            return back(False, "state 与当前平台不匹配，请重新发起授权")

        # ② state 只能消费一次。缺失说明被重放或已过期。
        nonce = state.get("nonce") or ""
        if not nonce or cache.get(_STATE_KEY.format(nonce)) is None:
            return back(False, "该授权链接已被使用或已过期，请重新发起授权")
        cache.delete(_STATE_KEY.format(nonce))

        try:
            if platform.auth_type == "mock":
                access, refresh = f"mock-token-{uuid.uuid4().hex[:12]}", ""
                platform_user_id = f"mock-{user_id}"
                expires_at = None
            else:
                auth_code = request.query_params.get("code", "")
                if not auth_code or not platform.token_url:
                    raise ValueError("缺少授权码或 token_url 未配置")
                data = post_json(
                    platform.token_url,
                    {
                        "grant_type": "authorization_code",
                        "code": auth_code,
                        "redirect_uri": _redirect_uri(request, code),
                        "client_id": platform.client_id,
                        "client_secret": platform.client_secret,
                    },
                )
                access = data.get("access_token", "")
                refresh = data.get("refresh_token", "")
                if not access:
                    raise ValueError(
                        "Token 交换失败: "
                        f"{data.get('error_description') or data.get('error') or data}"
                    )
                platform_user_id = _platform_user_id(data, user_id)
                # 关键：把有效期落库。此前连响应里现成的 expires_in / expires_at
                # 都没读，token_expires_at 永远是 NULL —— 界面上所有 Token 都显示
                # active，包括早已死掉的，也就无从判断何时该刷新。
                expires_at = resolve_expiry(data)

            account, created = PlatformAccount.objects.update_or_create(
                user_id=user_id,
                platform=platform,
                platform_user_id=platform_user_id,
                defaults={"status": "active", "display_name": platform.name},
            )
            account.set_tokens(access, refresh, expires_at=expires_at)
            account.save()
            SyncLog.objects.create(
                user_id=user_id,
                level="success",
                message=f"{'绑定' if created else '重新授权'} {platform.name} 账号成功",
            )
            return back(True)
        except Exception as exc:  # noqa: BLE001
            SyncLog.objects.create(
                user_id=user_id,
                level="error",
                message=f"绑定 {platform.name} 失败: {exc}",
            )
            return back(False, str(exc)[:200])


def _platform_user_id(data: dict, user_id: int) -> str:
    """从 Token 响应里取出「平台侧用户 ID」。

    ⚠️ Strava 的 token 响应里 `athlete` 是一个 **JSON 对象**
    （`{"id": 12345678, "username": "...", "firstname": "John", ...}`），
    早先直接 `str(data.get("athlete"))` 会把整串 Python 字典字面量
    （`{'id': 12345678, 'username': ...}`）当成用户 ID 存库：
    它会写进 `platform_user_id`（唯一约束的一部分）、显示在「账号管理」列表里、
    还会参与 `is_demo` 判断。必须取对象里的 `id`。
    """
    athlete = data.get("athlete")
    if isinstance(athlete, dict):
        candidate = athlete.get("id") or athlete.get("user_id") or athlete.get("username")
        if candidate:
            return str(candidate)
    elif athlete:
        return str(athlete)

    for key in ("user_id", "uid", "openid", "id"):
        if data.get(key):
            return str(data[key])

    return f"oauth-{user_id}"
