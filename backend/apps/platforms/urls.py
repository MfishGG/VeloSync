from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import AuthorizeView, CallbackView, DemoBindView, PlatformAccountViewSet, PlatformViewSet

router = DefaultRouter()
router.register("platforms", PlatformViewSet, basename="platform")
router.register("accounts", PlatformAccountViewSet, basename="account")

urlpatterns = [
    path("accounts/<str:code>/authorize/", AuthorizeView.as_view(), name="account-authorize"),
    path("accounts/<str:code>/demo-bind/", DemoBindView.as_view(), name="account-demo-bind"),
    path("accounts/<str:code>/callback/", CallbackView.as_view(), name="account-callback"),
] + router.urls
