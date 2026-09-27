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
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "平台"
        verbose_name_plural = "平台"
        ordering = ["id"]

    def __str__(self):
        return self.name


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
