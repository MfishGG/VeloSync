import uuid

import requests
from django.conf import settings
from django.core import signing
from django.shortcuts import redirect
from rest_framework import viewsets
from rest_framework.decorators import action  # noqa: F401
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.synclogs.models import SyncLog

from .crypto import encrypt
from .models import Platform, PlatformAccount
from .serializers import PlatformAccountSerializer, PlatformSerializer


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
        SyncLog.objects.create(
            user=self.request.user,
            level="warning",
            message=f"解绑平台账号 {instance.platform.name} · {instance.display_name or instance.platform_user_id}",
        )
        instance.delete()


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

        if not platform.authorize_url or not platform.client_id:
            return Response(
                {"detail": f"{platform.name} 尚未配置 OAuth 凭证（authorize_url / client_id），请在平台数据中补充"},
                status=400,
            )

        state = signing.dumps({"user_id": request.user.id, "platform": code})
        redirect_uri = request.build_absolute_uri(f"/api/accounts/{code}/callback/")
        params = {
            "client_id": platform.client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "scope": " ".join(platform.scopes or []),
            "state": state,
        }
        query = "&".join(f"{k}={requests.utils.quote(str(v))}" for k, v in params.items())
        return Response({"authorize_url": f"{platform.authorize_url}?{query}", "state": state})


class CallbackView(APIView):
    """GET /api/accounts/{platform}/callback/ —— OAuth 回调：交换并加密存储 Token"""

    permission_classes = [AllowAny]  # 由平台重定向回来，无 JWT

    def get(self, request, code: str):
        frontend = settings.FRONTEND_URL.rstrip("/")

        def back(ok: bool, msg: str = ""):
            suffix = f"?bind={'ok' if ok else 'error'}&msg={requests.utils.quote(msg)}"
            return redirect(f"{frontend}/accounts{suffix}")

        try:
            state = signing.loads(request.query_params.get("state", ""), max_age=600)
        except Exception:
            return back(False, "state 校验失败，请重新发起授权")

        user_id = state.get("user_id")
        platform = Platform.objects.filter(code=code, is_active=True).first()
        if user_id is None or platform is None:
            return back(False, "授权参数无效")

        try:
            if platform.auth_type == "mock":
                access, refresh = f"mock-token-{uuid.uuid4().hex[:12]}", ""
                platform_user_id = f"mock-{user_id}"
            else:
                auth_code = request.query_params.get("code", "")
                if not auth_code or not platform.token_url:
                    raise ValueError("缺少授权码或 token_url 未配置")
                resp = requests.post(
                    platform.token_url,
                    data={
                        "grant_type": "authorization_code",
                        "code": auth_code,
                        "redirect_uri": request.build_absolute_uri(f"/api/accounts/{code}/callback/"),
                        "client_id": platform.client_id,
                        "client_secret": platform.client_secret,
                    },
                    timeout=15,
                )
                data = resp.json()
                access = data.get("access_token", "")
                refresh = data.get("refresh_token", "")
                if not access:
                    raise ValueError(f"Token 交换失败: {data.get('error_description') or data.get('error') or resp.status_code}")
                platform_user_id = str(data.get("athlete") or data.get("user_id") or f"oauth-{user_id}")

            account, created = PlatformAccount.objects.update_or_create(
                user_id=user_id,
                platform=platform,
                platform_user_id=platform_user_id,
                defaults={"status": "active", "display_name": platform.name},
            )
            account.set_tokens(access, refresh)
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
