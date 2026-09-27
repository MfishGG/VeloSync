from django.contrib.auth.models import User
from rest_framework import serializers


class UserSerializer(serializers.ModelSerializer):
    nickname = serializers.CharField(source="first_name", required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ["id", "username", "email", "nickname", "date_joined"]


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(min_length=6, max_length=128)
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    nickname = serializers.CharField(required=False, allow_blank=True, default="", max_length=50)
