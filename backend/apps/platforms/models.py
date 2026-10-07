from django.conf import settings
from django.db import models


class Platform(models.Model):
    """运动平台定义（iGPSPORT / Garmin / Strava / COROS / Mock ...）"""

    AUTH_TYPES = [("oauth2", "OAuth 2.0"), ("mock", "演示"), ("api_key", "API Key")]

    code = models.CharField("标识", max_length=32, unique=True)
    name = models.CharField("名称", max_length=64)
    auth_type = models.CharField("认证方式", max_length=32, choices=AUTH_TYPES, default="oauth2")
    authorize_url = models.CharField(max_length=255, blank=True, default="")
    token_url = models.CharField(max_length=255, blank=True, default="")
    api_base = models.CharField(max_length=255, blank=True, default="")
    client_id = models.CharField(max_length=128, blank=True, default="")
    client_secret = models.CharField(max_length=256, blank=True, default="")
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
    def set_tokens(self, access: str, refresh: str = "") -> None:
        from .crypto import encrypt

        self.access_token = encrypt(access)
        if refresh:
            self.refresh_token = encrypt(refresh)

    def get_access_token(self) -> str:
        from .crypto import decrypt

        if not self.access_token:
            return ""
        try:
            return decrypt(self.access_token)
        except Exception:
            return ""
