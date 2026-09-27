from django.contrib import admin

from .models import Platform, PlatformAccount


@admin.register(Platform)
class PlatformAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "auth_type", "is_active", "created_at")
    list_filter = ("auth_type", "is_active")
    search_fields = ("code", "name")


@admin.register(PlatformAccount)
class PlatformAccountAdmin(admin.ModelAdmin):
    list_display = ("user", "platform", "platform_user_id", "display_name", "status", "token_expires_at")
    list_filter = ("status", "platform")
    search_fields = ("user__username", "platform_user_id")
