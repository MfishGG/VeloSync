from django.contrib import admin

from .models import SocialAccount


@admin.register(SocialAccount)
class SocialAccountAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "provider", "openid", "nickname", "created_at"]
    list_filter = ["provider"]
    search_fields = ["openid", "unionid", "nickname", "user__username"]
    readonly_fields = ["created_at", "updated_at"]
