"""账号相关的辅助模型

1. `SocialAccount` —— 第三方快捷登录账号绑定关系：
   一个 Django User 可以绑定多个第三方身份（微信 / QQ / 微博…），
   同一 provider 下的 openid 全局唯一。

2. `UserProfile` —— 用户资料补充字段（手机号等）：
   Django 内置 User 没有手机号字段。手机号在本项目**仅作展示 / 联系方式**，
   不承担登录身份（登录一律走微信），因此独立成表而不影响认证逻辑。
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


class UserProfile(models.Model):
    """用户资料补充（头像）

    独立成表是为了让 User 保持轻量：头像以 base64 dataURL 存储（项目未接入
    对象存储），直接挂在内置 User 上会拖慢每一次用户查询。
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
        verbose_name="用户",
    )
    # 用户自设头像。微信「头像昵称填写能力」给的是本地临时文件，前端读成
    # dataURL 提交；项目未引入对象存储 SDK，而头像压缩后 ≤ 200KB，直接入库
    # 可省掉一整套基础设施。字段给足余量，避免 base64 膨胀后溢出。
    avatar = models.TextField("头像", blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "用户资料"
        verbose_name_plural = "用户资料"

    def __str__(self):
        return f"{self.user.username} 的资料"
