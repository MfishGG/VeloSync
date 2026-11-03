"""账号密码渠道：认证类型、会话凭据、MFA 中间态。

三件事一起做，因为它们互为前提：

1. `auth_type` 增加 `password`。Garmin Connect 的开放平台只对企业合作方开放，
   个人应用申请不下来（2026 年现状），但它自己的网页/App 登录是可用的 ——
   这也是「佳速通」这类产品绑定佳明时让用户直接填账号密码的原因。
2. `PlatformAccount.session_data`：佳明是「OAuth1 换 OAuth2」的两段式，OAuth2
   （真正调接口的 Bearer）只有 1 小时，刷新要拿 OAuth1 去签。所以 OAuth1 的
   token/secret 必须一起留下，否则一小时后必然失效、用户又得重填密码。
3. `PendingLogin`：开了两步验证的账号，第一次提交只会拿到「需要验证码」，
   验证码必须在**同一个登录会话**里提交 —— 会话要跨进程活在库里，不能放内存。
   （`OAuthState` 那条教训：LocMemCache 在两个 worker 下丢过 40% 的状态。）

迁移里顺手把佳明两区的认证方式改成 `password`，但**只在凭证从未配置过时**改：
运营若已经填了 authorize_url（意味着拿到了官方合作资质），那是刻意为之。
"""
import apps.platforms.fields
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

#: 佳明两区：没有官方个人开发者 OAuth，只能走账号密码
PASSWORD_PLATFORMS = ("garmin", "garmin_cn")


def use_password_auth(apps, schema_editor):
    Platform = apps.get_model("platforms", "Platform")
    for code in PASSWORD_PLATFORMS:
        platform = Platform.objects.filter(code=code).first()
        if platform is None:
            continue
        # 已经配了授权地址 = 拿到了官方 OAuth 资质，不要动它
        if platform.authorize_url:
            continue
        platform.auth_type = "password"
        platform.save(update_fields=["auth_type"])


def restore_oauth_auth(apps, schema_editor):
    Platform = apps.get_model("platforms", "Platform")
    Platform.objects.filter(code__in=PASSWORD_PLATFORMS, auth_type="password").update(
        auth_type="oauth2"
    )


class Migration(migrations.Migration):

    dependencies = [
        ("platforms", "0008_garmin_cn_platform"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="platformaccount",
            name="session_data",
            field=apps.platforms.fields.EncryptedTextField(
                blank=True,
                default="",
                help_text="Fernet 加密的 JSON",
                verbose_name="平台会话凭据",
            ),
        ),
        migrations.AlterField(
            model_name="platform",
            name="auth_type",
            field=models.CharField(
                choices=[
                    ("oauth2", "OAuth 2.0"),
                    ("password", "账号密码"),
                    ("mock", "演示"),
                ],
                default="oauth2",
                max_length=32,
                verbose_name="认证方式",
            ),
        ),
        migrations.CreateModel(
            name="PendingLogin",
            fields=[
                (
                    "id",
                    models.CharField(
                        max_length=40,
                        primary_key=True,
                        serialize=False,
                        verbose_name="标识",
                    ),
                ),
                ("username", models.CharField(max_length=160, verbose_name="登录名")),
                (
                    "state_data",
                    apps.platforms.fields.EncryptedTextField(
                        blank=True, default="", verbose_name="会话状态"
                    ),
                ),
                (
                    "mfa_method",
                    models.CharField(
                        blank=True, default="", max_length=32, verbose_name="验证方式"
                    ),
                ),
                (
                    "created_at",
                    models.DateTimeField(
                        auto_now_add=True, db_index=True, verbose_name="创建时间"
                    ),
                ),
                (
                    "platform",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pending_logins",
                        to="platforms.platform",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pending_logins",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "待验证的登录",
                "verbose_name_plural": "待验证的登录",
                "ordering": ["-created_at"],
            },
        ),
        migrations.RunPython(use_password_auth, restore_oauth_auth),
    ]
