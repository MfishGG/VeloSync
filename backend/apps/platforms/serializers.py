from rest_framework import serializers

from .models import Platform, PlatformAccount


class PlatformSerializer(serializers.ModelSerializer):
    oauth_ready = serializers.BooleanField(read_only=True)
    oauth_missing = serializers.ListField(child=serializers.CharField(), read_only=True)
    credential_hint = serializers.CharField(read_only=True)
    mobile_bind_channel = serializers.CharField(read_only=True)

    class Meta:
        model = Platform
        fields = [
            "id", "code", "name", "auth_type", "api_base",
            "scopes", "capabilities", "is_active",
            "oauth_ready", "oauth_missing", "credential_hint",
            # 移动端绑定渠道：小程序内跳官方小程序 / 复制 scheme 唤起 App / 演示身份
            "miniprogram_appid", "app_scheme", "mobile_bind_channel",
        ]


class PlatformAccountSerializer(serializers.ModelSerializer):
    platform = PlatformSerializer(read_only=True)

    class Meta:
        model = PlatformAccount
        fields = [
            "id", "platform", "platform_user_id", "display_name",
            "status", "token_expires_at", "created_at",
        ]
