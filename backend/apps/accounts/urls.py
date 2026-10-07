from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    LoginView,
    MeView,
    RegisterView,
    SocialAuthorizeView,
    SocialCallbackView,
    SocialLoginView,
    SocialProvidersView,
    WxMiniProgramLoginView,
)

urlpatterns = [
    path("login/", LoginView.as_view(), name="auth-login"),
    path("refresh/", TokenRefreshView.as_view(), name="auth-refresh"),
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("me/", MeView.as_view(), name="auth-me"),
    # 微信小程序一键登录（wx.login → code2session）
    path("wx/miniprogram/", WxMiniProgramLoginView.as_view(), name="wx-miniprogram-login"),
    # 第三方快捷登录（微信 / QQ / 微博）
    path("social/providers/", SocialProvidersView.as_view(), name="social-providers"),
    path("social/login/", SocialLoginView.as_view(), name="social-login"),
    path("social/<str:provider>/authorize/", SocialAuthorizeView.as_view(), name="social-authorize"),
    path("social/<str:provider>/callback/", SocialCallbackView.as_view(), name="social-callback"),
]
