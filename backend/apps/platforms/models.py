import logging
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

from .crypto import encrypt
from .fields import EncryptedTextField

logger = logging.getLogger(__name__)

#: Token 剩余有效期低于该秒数时，视为「即将过期」，使用前先刷新
TOKEN_REFRESH_MARGIN_SECONDS = 600


class Platform(models.Model):
    """运动平台定义（iGPSPORT / Garmin / Strava / COROS / Mock ...）"""

    # 原含 `("api_key", "API Key")`，但全项目没有任何 api_key 认证的实现或入口，
    # 属死枚举 —— 留着会让「这个系统支持三种认证」成为错误印象。
    # 真接入需要时再加回（加一个 choice 的迁移成本可以忽略）。
    AUTH_TYPES = [("oauth2", "OAuth 2.0"), ("mock", "演示")]

    code = models.CharField("标识", max_length=32, unique=True)
    name = models.CharField("名称", max_length=64)
    auth_type = models.CharField("认证方式", max_length=32, choices=AUTH_TYPES, default="oauth2")
    authorize_url = models.CharField(max_length=255, blank=True, default="")
    token_url = models.CharField(max_length=255, blank=True, default="")
    api_base = models.CharField(max_length=255, blank=True, default="")
    client_id = models.CharField(max_length=128, blank=True, default="")
    # 与用户 Token 同级敏感 —— 泄漏后可冒充本应用。加密存储，不用明文。
    client_secret = EncryptedTextField(blank=True, default="")
    scopes = models.JSONField("授权范围", default=list, blank=True)
    capabilities = models.JSONField(
        "能力（fetch/upload）", default=dict, blank=True
    )
    # ---- 移动端（小程序 → 官方 App）绑定渠道 ----
    miniprogram_appid = models.CharField(
        "官方微信小程序 AppID",
        max_length=64,
        blank=True,
        default="",
        help_text="小程序内用 wx.navigateToMiniProgram 跳转该平台官方小程序完成授权绑定",
    )
    app_scheme = models.CharField(
        "官方 App URL Scheme",
        max_length=128,
        blank=True,
        default="",
        help_text="跳官方小程序不可用时的兜底：复制该 scheme 到系统浏览器即可唤起官方 App",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "平台"
        verbose_name_plural = "平台"
        ordering = ["id"]

    #: 走真实 OAuth 时必须齐备的字段（按优先级列出，用于提示"还缺什么"）
    CREDENTIAL_FIELDS = ("authorize_url", "token_url", "client_id")

    #: 字段 → 中文说明，供前端与日志展示
    CREDENTIAL_LABELS = {
        "authorize_url": "授权地址 authorize_url",
        "token_url": "令牌地址 token_url",
        "client_id": "客户端 ID client_id",
    }

    def __str__(self):
        return self.name

    @property
    def oauth_missing(self) -> list[str]:
        """返回尚未配置的凭证字段；演示平台无需凭证，恒为空。"""
        if self.auth_type == "mock":
            return []
        return [f for f in self.CREDENTIAL_FIELDS if not getattr(self, f, "")]

    @property
    def oauth_ready(self) -> bool:
        """凭证是否齐备（齐备才允许跳转真实授权页）。"""
        return not self.oauth_missing

    @property
    def credential_hint(self) -> str:
        """给用户看的下一步提示。"""
        if self.auth_type == "mock":
            return "演示平台无需凭证，可直接绑定"
        if self.oauth_ready:
            return "凭证已配置，可跳转平台授权页"
        return "未配置 " + "、".join(self.CREDENTIAL_LABELS[f] for f in self.oauth_missing) + "，可先以演示身份绑定"

    @property
    def mobile_bind_channel(self) -> str:
        """移动端优先使用的绑定渠道。

        - `miniprogram`：已登记官方小程序 AppID，可小程序内直接跳转
        - `app`：只有 URL Scheme，需复制链接到浏览器唤起官方 App
        - `demo`：两者都缺，只能以演示身份绑定
        """
        if self.miniprogram_appid:
            return "miniprogram"
        if self.app_scheme:
            return "app"
        return "demo"


class PlatformAccount(models.Model):
    """用户绑定的平台账号（Token 加密存储）"""

    STATUS = [("active", "有效"), ("expired", "已过期"), ("revoked", "已撤销")]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="platform_accounts"
    )
    platform = models.ForeignKey(Platform, on_delete=models.CASCADE, related_name="accounts")
    platform_user_id = models.CharField("平台侧用户 ID", max_length=128)
    display_name = models.CharField("显示名称", max_length=128, blank=True, default="")
    access_token = models.TextField(blank=True, default="", help_text="Fernet 加密存储")
    refresh_token = models.TextField(blank=True, default="", help_text="Fernet 加密存储")
    token_expires_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField("状态", max_length=16, choices=STATUS, default="active")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "平台账号"
        verbose_name_plural = "平台账号"
        constraints = [
            models.UniqueConstraint(
                fields=["user", "platform", "platform_user_id"], name="uk_user_platform"
            )
        ]
        ordering = ["id"]

    def __str__(self):
        return f"{self.platform.name} · {self.display_name or self.platform_user_id}"

    @property
    def is_demo(self) -> bool:
        """是否为本地演示身份（未接入真实平台）。

        `mock-` 为演示平台账号，`demo-` 为未配置 OAuth 凭证时以演示身份绑定的账号，
        二者都拿不到真实的平台数据。
        """
        return self.platform_user_id.startswith(("mock-", "demo-"))

    # ---- Token 加密存取 ----
    def set_tokens(
        self,
        access: str,
        refresh: str = "",
        expires_in: int | None = None,
        expires_at=None,
    ) -> None:
        """写入 Token。

        `expires_in`（秒，OAuth 标准字段）或 `expires_at`（绝对时间）至少传一个 ——
        早先这两个值都没落库，`token_expires_at` 永远是 NULL，于是：
        - `status` 永远不会变成 `expired`，界面上所有 Token 都显示 `active`，
          包括早已死掉的；
        - 无法判断「是否需要刷新」，Token 刷新也就无从做起。
        """
        self.access_token = encrypt(access)
        if refresh:
            self.refresh_token = encrypt(refresh)
        if expires_at is not None:
            self.token_expires_at = expires_at
        elif expires_in is not None:
            self.token_expires_at = timezone.now() + timedelta(seconds=int(expires_in))
        self.status = "active"

    def get_access_token(self) -> str:
        return self._decrypt(self.access_token, "access token")

    def get_refresh_token(self) -> str:
        return self._decrypt(self.refresh_token, "refresh token")

    def _decrypt(self, ciphertext: str, label: str) -> str:
        """解密失败**不再静默返回空串**，而是记 error 日志。

        早先 `except Exception: return ""` 的写法会把「密钥换了」伪装成
        「用户未授权」，没人能联想到真正原因。这里记日志并把原因带到调用方。
        """
        from .crypto import TokenDecryptError, decrypt

        if not ciphertext:
            return ""
        try:
            return decrypt(ciphertext)
        except TokenDecryptError as exc:
            logger.error(
                "平台账号 %s 的 %s 无法解密：%s（多半是 TOKEN_ENCRYPTION_KEY 被更换）",
                self.pk,
                label,
                exc,
            )
            self._token_error = str(exc)
            return ""

    @property
    def token_error(self) -> str:
        """最近一次解密失败的原因（内存态，供调用方判断是否为密钥问题）。"""
        return getattr(self, "_token_error", "")

    @property
    def is_expiring(self) -> bool:
        """Token 是否已过期或即将过期（默认 10 分钟内视为即将过期）。

        `token_expires_at` 为空表示平台未返回有效期（如部分平台的长效 Token），
        此时无法判断，按「未过期」处理，避免把可用账号误判成失效。
        """
        if not self.token_expires_at:
            return False
        return self.token_expires_at <= timezone.now() + timedelta(
            seconds=TOKEN_REFRESH_MARGIN_SECONDS
        )

    def mark_expired(self, reason: str = "") -> None:
        self.status = "expired"
        self.save(update_fields=["status"])
        logger.warning("平台账号 %s 标记为 expired：%s", self.pk, reason)

    def mark_revoked(self, reason: str = "") -> None:
        self.status = "revoked"
        self.save(update_fields=["status"])
        logger.warning("平台账号 %s 标记为 revoked：%s", self.pk, reason)
