from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AuthorizeView,
    CallbackView,
    DemoBindView,
    PasswordBindMfaView,
    PasswordBindView,
    PlatformAccountViewSet,
    PlatformViewSet,
)

router = DefaultRouter()
router.register("platforms", PlatformViewSet, basename="platform")
router.register("accounts", PlatformAccountViewSet, basename="account")

urlpatterns = [
    path("accounts/<str:code>/authorize/", AuthorizeView.as_view(), name="account-authorize"),
    path("accounts/<str:code>/demo-bind/", DemoBindView.as_view(), name="account-demo-bind"),
    # 账号密码渠道（Garmin）：没有授权页，两步完成 —— 提交密码 / 提交验证码
    path(
        "accounts/<str:code>/bind-password/",
        PasswordBindView.as_view(),
        name="account-bind-password",
    ),
    path(
        "accounts/<str:code>/bind-password/mfa/",
        PasswordBindMfaView.as_view(),
        name="account-bind-password-mfa",
    ),
    path("accounts/<str:code>/callback/", CallbackView.as_view(), name="account-callback"),
] + router.urls
