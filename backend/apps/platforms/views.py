import base64
import hashlib
import logging
import secrets
import uuid
from urllib.parse import quote as urlquote

from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.http import HttpResponse
from django.shortcuts import redirect
from django.utils.html import escape
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

#: PKCE code_verifier 的缓存键前缀（与 state 同寿命，回调时取用后立即删除）
_PKCE_KEY = "oauth_pkce:{}"


def _new_code_verifier() -> str:
    """RFC 7636 的 code_verifier：43~128 个 [A-Za-z0-9-._~]。"""
    return secrets.token_urlsafe(64)[:96]


def _code_challenge(verifier: str) -> str:
    """S256：base64url(sha256(verifier))，去掉 padding。"""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


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
    if base:
        return f"{base}{path}"

    # 没固定 base 时只能从请求头推导。走 callContainer 的请求（小程序正式环境）
    # 拿到的 Host 是容器内部名 / IP，推导出来是 `https://django-xu8d/...` 这类
    # 平台侧必然拒绝的地址 —— 对方只会回一句 redirect_uri invalid，从我们这边
    # 完全看不出是自己少配了一个环境变量。所以先把自己的日志说清楚。
    resolved = request.build_absolute_uri(path)
    if request.headers.get("X-WX-SERVICE"):
        logger.error(
            "callContainer 请求缺少 PLATFORM_REDIRECT_BASE_URL：OAuth 回调会被推导成"
            "内部地址 %s，平台将拒绝该 redirect_uri",
            resolved,
        )
    return resolved


# ---------------- OAuth 回调的落点 ----------------

#: 回调页（浏览器最后停的地方）的样式。内联，不依赖任何静态文件 ——
#: 这一页必须能独立打开，此时用户没有登录态、也没有前端资源可用。
_RESULT_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;
padding:32px 20px;background:#f4f5fb;color:#1f2430;
font:16px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.card{width:100%;max-width:420px;background:#fff;border-radius:20px;padding:32px 24px;
box-shadow:0 12px 32px rgba(31,36,48,.08);text-align:center}
.badge{width:64px;height:64px;margin:0 auto 20px;border-radius:50%;
display:flex;align-items:center;justify-content:center;font-size:34px;line-height:1}
.ok .badge{background:#e8f7ef;color:#0f9d58}
.err .badge{background:#fdecea;color:#d93025}
h1{font-size:20px;margin-bottom:12px;font-weight:600}
p{font-size:15px;color:#5b6275;word-break:break-word}
.reason{margin-top:14px;padding:12px 14px;border-radius:12px;background:#f6f7fb;
font-size:13px;color:#6b7280;text-align:left}
.tip{margin-top:22px;font-size:14px;color:#1f2430}
.link{display:inline-block;margin-top:22px;color:#3b5bdb;text-decoration:none;font-size:14px}
"""


def _result_page(ok: bool, msg: str = "", web_url: str = "") -> str:
    """回调结果页：面向「在浏览器里绑完、要回到小程序」的用户。

    刻意做成一整页而不是一句 "绑定成功"：用户是从微信跳出来、又要在浏览器里
    完成第三方登录的，中途切了好几次 App，最后必须有人明确告诉他「现在回哪儿」。
    """
    if ok:
        title = "绑定成功"
        text = "授权已完成，这个平台的账号已经和 VeloSync 关联好了。"
        tip = "请回到微信，在「我的 → 平台账号」下拉刷新，即可看到已绑定的账号。"
        badge = "✓"
    else:
        title = "绑定没有完成"
        text = "授权过程中出了问题，账号尚未绑定。"
        tip = "请回到小程序，在「我的 → 平台账号」重新点一次绑定。"
        badge = "!"

    reason = f'<div class="reason">{escape(msg)}</div>' if msg else ""
    link = f'<a class="link" href="{escape(web_url)}">前往 Web 工作台查看</a>' if web_url else ""
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{title} · VeloSync</title><style>{_RESULT_CSS}</style></head>
<body><div class="card {'ok' if ok else 'err'}">
<div class="badge">{badge}</div>
<h1>{title}</h1>
<p>{text}</p>
{reason}
<p class="tip">{tip}</p>
{link}
</div></body></html>"""


def _has_public_frontend() -> str:
    """Web 工作台的可用地址；没配或不指向公网时返回空串。

    `FRONTEND_URL` 默认值是 `http://localhost:5173`（前端 dev server）。生产上
    没配它，回调就会把手机浏览器扔到「localhost 拒绝连接」——用户看到的是
    「绑定失败」，实际是**绑成功了、只是落点错了**。
    """
    frontend = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
    if not frontend.startswith(("http://", "https://")):
        return ""
    if "//localhost" in frontend or "//127.0.0.1" in frontend:
        return ""
    return frontend


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

        # 发起方要进 state：回调是浏览器最后停的地方，小程序 / Web 两种客户端
        # 的落点完全不同（小程序要一张「回微信」的结果页，Web 要回工作台账号页）。
        # 不能靠 query 参数传 —— 回调的 URL 是平台按登记值原样跳回来的，
        # 我们无法在它上面追加任何东西。
        #
        # 不传 = 还没更新的老客户端，**不要**在这里替它猜成 "web"：那会让回调
        # 直接重定向到 FRONTEND_URL（生产上是 localhost）。留空，交给回调
        # 按「Web 工作台到底有没有上线」判断。
        client = request.query_params.get("client", "")
        if client not in ("web", "wx"):
            client = ""
        state = signing.dumps(
            {"user_id": request.user.id, "platform": code, "nonce": nonce, "client": client}
        )

        params = {
            "client_id": platform.client_id,
            "response_type": "code",
            "redirect_uri": _redirect_uri(request, code),
            "scope": " ".join(platform.scopes or []),
            "state": state,
        }

        # Garmin 这类平台强制 PKCE（官方规范：code_challenge_method=S256 required）。
        # verifier 不能只留在内存里 —— 授权页走一圈回来是**另一个请求**，
        # 所以和 nonce 一样存进缓存，回调时取出来交给 token 端点。
        if platform.requires_pkce:
            verifier = _new_code_verifier()
            cache.set(_PKCE_KEY.format(nonce), verifier, timeout=STATE_MAX_AGE)
            params["code_challenge"] = _code_challenge(verifier)
            params["code_challenge_method"] = "S256"

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
        # state 要在最前面解出来：失败分支也得知道「这是谁发起的」，否则
        # 一个 state 过期的手机用户会被扔到 Web 的账号页去。
        try:
            state = signing.loads(request.query_params.get("state", ""), max_age=STATE_MAX_AGE)
            state_bad = ""
        except Exception:
            state, state_bad = {}, "state 校验失败，请重新发起授权"

        frontend = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
        # 结果页里给 Web 用户一个入口 —— 只在 FRONTEND_URL 真的是公网地址时才给，
        # 否则那个链接点开还是打不开，等于再骗他一次。
        public_web = _has_public_frontend()

        # state 里没有 client 的只有两种情况：① 还没更新到新包的小程序（它不会传
        # `?client=wx`）；② Web。分不清时看「Web 工作台到底有没有上线」：没上线
        # 就只可能是 ①，这时给结果页远好于把用户扔去 localhost。
        # 这是给「后端已更新、小程序还没上传」那段窗口期的兜底 —— 少这一步，
        # 前后端版本稍微错开就又是一次「绑定失败」。
        client = state.get("client") or ("web" if (settings.DEBUG or public_web) else "wx")

        def back(ok: bool, msg: str = ""):
            if client == "wx" or not frontend:
                # 小程序：给一张结果页。浏览器里没有「回小程序」这种 API，
                # 只能把话说清楚（绑成功没有、现在该回哪儿）。
                return HttpResponse(
                    _result_page(ok, msg, web_url=public_web),
                    content_type="text/html; charset=utf-8",
                )
            suffix = f"?bind={'ok' if ok else 'error'}&msg={urlquote(msg)}"
            return redirect(f"{frontend}/accounts{suffix}")

        if state_bad:
            return back(False, state_bad)

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

        # PKCE：取回发起授权时生成的 verifier。取不到说明缓存已过期或链接被重放，
        # 这时交换 token 必然失败（平台会报 invalid_grant），不如直接说清楚。
        code_verifier = ""
        if platform.requires_pkce:
            code_verifier = cache.get(_PKCE_KEY.format(nonce)) or ""
            cache.delete(_PKCE_KEY.format(nonce))
            if not code_verifier:
                return back(False, "PKCE 校验参数已过期，请重新发起授权")

        try:
            if platform.auth_type == "mock":
                access, refresh = f"mock-token-{uuid.uuid4().hex[:12]}", ""
                platform_user_id = f"mock-{user_id}"
                expires_at = None
            else:
                auth_code = request.query_params.get("code", "")
                if not auth_code or not platform.token_url:
                    raise ValueError("缺少授权码或 token_url 未配置")
                token_payload = {
                    "grant_type": "authorization_code",
                    "code": auth_code,
                    "redirect_uri": _redirect_uri(request, code),
                    "client_id": platform.client_id,
                    "client_secret": platform.client_secret,
                }
                if code_verifier:
                    token_payload["code_verifier"] = code_verifier
                data = post_json(platform.token_url, token_payload)
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
            # 完整原因只进日志。这个分支里 `str(exc)` 是平台返回的原文，形如
            # `https://www.strava.com/oauth/token 返回 HTTP 400：{"message":...
            # —— 地址、HTTP 状态码、JSON 对终端用户没有任何用处，印在结果页上
            # 只会让他更慌，也让「绑定失败」显得像系统崩了。要排查请看
            # SyncLog（/api/logs/、Django Admin 都能查到原文）。
            SyncLog.objects.create(
                user_id=user_id,
                level="error",
                message=f"绑定 {platform.name} 失败: {exc}",
            )
            return back(
                False,
                f"没能完成与 {platform.name} 的授权。授权码可能已失效，或被你在"
                "平台上取消了。回到小程序重新点一次绑定即可。",
            )


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
