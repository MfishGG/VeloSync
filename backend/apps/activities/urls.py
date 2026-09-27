from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ActivityViewSet, MatrixView

router = DefaultRouter()
router.register("", ActivityViewSet, basename="activity")

urlpatterns = [
    path("matrix/", MatrixView.as_view(), name="activity-matrix"),
] + router.urls
