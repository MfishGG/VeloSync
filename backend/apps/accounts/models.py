"""第三方快捷登录账号绑定关系

一个 Django User 可以绑定多个第三方身份（微信 / QQ / 微博…），
同一 provider 下的 openid 全局唯一。
"""

from django.conf import settings
from django.db import models

PROVIDER_CHOICES = [
    ("wechat", "微信"),
    ("qq", "QQ"),
    ("weibo", "微博"),
]


class SocialAccount(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="social_accounts",
        verbose_name="用户",
    )
    provider = models.CharField("平台", max_length=32, choices=PROVIDER_CHOICES)
    openid = models.CharField("OpenID", max_length=128)
    unionid = models.CharField("UnionID", max_length=128, blank=True, default="")
    nickname = models.CharField("昵称", max_length=64, blank=True, default="")
    avatar_url = models.URLField("头像", blank=True, default="")
    raw = models.JSONField("原始资料", default=dict, blank=True)
    created_at = models.DateTimeField("绑定时间", auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "第三方账号"
        verbose_name_plural = "第三方账号"
        constraints = [
            models.UniqueConstraint(fields=["provider", "openid"], name="uk_social_provider_openid")
        ]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_provider_display()}:{self.openid}"
