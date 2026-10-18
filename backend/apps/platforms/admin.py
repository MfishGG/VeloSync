from django.contrib import admin

from .models import Platform, PlatformAccount


@admin.register(Platform)
class PlatformAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "auth_type", "credential_state", "is_active", "created_at")
    list_filter = ("auth_type", "is_active")
    search_fields = ("code", "name")
    fieldsets = (
        ("基本信息", {"fields": ("code", "name", "auth_type", "is_active")}),
        (
            "OAuth 凭证（去平台开放平台申请后填这里；留空则只能以演示身份绑定）",
            {
                "fields": (
                    "authorize_url",
                    "token_url",
                    "api_base",
                    "client_id",
                    "client_secret",
                    "scopes",
                ),
                "description": (
                    "auth_type=mock 的平台无需填写。凭证齐备（authorize_url / token_url / client_id）"
                    "后，「账号管理」页的绑定按钮才会跳转真实授权页。"
                    "也可以用命令批量填写：python manage.py set_platform_oauth <code> ..."
                ),
            },
        ),
        ("能力", {"fields": ("capabilities",)}),
        (
            "移动端绑定渠道（微信小程序 / App）",
            {
                "fields": ("miniprogram_appid", "app_scheme"),
                "description": (
                    "微信不允许小程序直接唤起第三方 App。绑定优先级："
                    "① 填了「官方微信小程序 AppID」→ 小程序内 navigateToMiniProgram 跳转官方小程序授权；"
                    "② 凭证齐全 → 复制平台授权页链接（https），在系统浏览器里登录并同意授权；"
                    "③ 都不满足 → 只能以演示身份绑定。"
                    "「App URL Scheme」字段保留但不参与渠道判定 —— iOS 浏览器地址栏"
                    "不接受自定义 scheme，复制过去是个打不开的链接。"
                ),
            },
        ),
    )

    @admin.display(description="凭证状态")
    def credential_state(self, obj: Platform) -> str:
        if obj.auth_type == "mock":
            return "演示（无需凭证）"
        return "已配置" if obj.oauth_ready else "未配置：" + "、".join(obj.oauth_missing)


@admin.register(PlatformAccount)
class PlatformAccountAdmin(admin.ModelAdmin):
    list_display = ("user", "platform", "platform_user_id", "display_name", "status", "token_expires_at")
    list_filter = ("status", "platform")
    search_fields = ("user__username", "platform_user_id")
