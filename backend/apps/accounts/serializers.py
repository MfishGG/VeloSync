from django.contrib.auth.models import User
from rest_framework import serializers


class SocialBindingSerializer(serializers.Serializer):
    """第三方绑定摘要（供小程序个人信息页展示微信头像 / OpenID）"""

    provider = serializers.CharField()
    provider_name = serializers.CharField()
    openid = serializers.CharField()
    unionid = serializers.CharField()
    nickname = serializers.CharField()
    avatar_url = serializers.CharField()
    bound_at = serializers.DateTimeField()


class UserSerializer(serializers.ModelSerializer):
    nickname = serializers.CharField(source="first_name", required=False, allow_blank=True)
    # 主头像：取第一个有头像的第三方绑定；无绑定则为空串，前端自行回退
    avatar = serializers.SerializerMethodField()
    social = serializers.SerializerMethodField()
    # 手机号仅作展示 / 联系方式，不承担登录身份。同时返回脱敏值供列表场景直接使用。
    phone = serializers.SerializerMethodField()
    phone_masked = serializers.SerializerMethodField()
    phone_bound = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "nickname",
            "avatar",
            "social",
            "phone",
            "phone_masked",
            "phone_bound",
            "date_joined",
        ]

    def _profile(self, obj):
        return getattr(obj, "profile", None)

    def get_phone(self, obj) -> str:
        profile = self._profile(obj)
        return (profile.phone if profile else "") or ""

    def get_phone_masked(self, obj) -> str:
        profile = self._profile(obj)
        return profile.phone_masked if profile else ""

    def get_phone_bound(self, obj) -> bool:
        profile = self._profile(obj)
        return bool(profile and profile.phone)

    def _bindings(self, obj):
        # 预取避免 N+1；未预取时按需查询
        cached = getattr(obj, "_prefetched_objects_cache", {}).get("social_accounts")
        return cached if cached is not None else list(obj.social_accounts.all())

    def get_avatar(self, obj) -> str:
        # 用户自设头像优先于第三方头像：前者是明确意图，后者只是兜底。
        # 微信回调的头像 URL 会过期，用户主动设置的不会。
        profile = self._profile(obj)
        if profile and profile.avatar:
            return profile.avatar
        for acc in self._bindings(obj):
            if acc.avatar_url:
                return acc.avatar_url
        return ""

    def get_social(self, obj) -> list:
        from .social import PROVIDER_META

        return [
            {
                "provider": acc.provider,
                "provider_name": PROVIDER_META.get(acc.provider, {}).get("name", acc.provider),
                "openid": acc.openid,
                "unionid": acc.unionid,
                "nickname": acc.nickname,
                "avatar_url": acc.avatar_url,
                "bound_at": acc.created_at,
            }
            for acc in self._bindings(obj)
        ]


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(min_length=6, max_length=128)
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    nickname = serializers.CharField(required=False, allow_blank=True, default="", max_length=50)
