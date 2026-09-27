from rest_framework import serializers

from .models import Platform, PlatformAccount


class PlatformSerializer(serializers.ModelSerializer):
    class Meta:
        model = Platform
        fields = [
            "id", "code", "name", "auth_type", "api_base",
            "scopes", "capabilities", "is_active",
        ]


class PlatformAccountSerializer(serializers.ModelSerializer):
    platform = PlatformSerializer(read_only=True)

    class Meta:
        model = PlatformAccount
        fields = [
            "id", "platform", "platform_user_id", "display_name",
            "status", "token_expires_at", "created_at",
        ]
