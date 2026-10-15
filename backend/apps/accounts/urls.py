from django.urls import path

from .views import (
    DemoLoginView,
    LoginView,
    MeView,
    RegisterView,
    SocialAuthorizeView,
    SocialCallbackView,
    SocialLoginView,
    SocialProvidersView,
    ThrottledTokenRefreshView,
    UpdateProfileView,
    WxMiniProgramLoginView,
)

urlpatterns = [
    path("login/", LoginView.as_view(), name="auth-login"),
    path("refresh/", ThrottledTokenRefreshView.as_view(), name="auth-refresh"),
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("me/", MeView.as_view(), name="auth-me"),
    # 演示账号入口（提审 / 对外演示）。DEMO_MODE=0 时 POST 返回 404。
    path("demo/", DemoLoginView.as_view(), name="auth-demo"),
    # 更新昵称 / 头像（微信「头像昵称填写能力」的结果落到这里）
    path("profile/", UpdateProfileView.as_view(), name="auth-profile"),
    # 微信小程序一键登录（wx.login → code2session）
    path("wx/miniprogram/", WxMiniProgramLoginView.as_view(), name="wx-miniprogram-login"),
    # 第三方快捷登录（微信 / QQ / 微博）
    path("social/providers/", SocialProvidersView.as_view(), name="social-providers"),
    path("social/login/", SocialLoginView.as_view(), name="social-login"),
    path("social/<str:provider>/authorize/", SocialAuthorizeView.as_view(), name="social-authorize"),
    path("social/<str:provider>/callback/", SocialCallbackView.as_view(), name="social-callback"),
]
