from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ActivityViewSet, FitHistoryView, FitUploadView, MatrixView

router = DefaultRouter()
router.register("", ActivityViewSet, basename="activity")

# 注意：这些具体路径必须排在 router.urls 之前，否则会被 {pk} 路由吃掉
urlpatterns = [
    path("matrix/", MatrixView.as_view(), name="activity-matrix"),
    path("upload-fit/", FitUploadView.as_view(), name="activity-upload-fit"),
    path("fit-history/", FitHistoryView.as_view(), name="activity-fit-history"),
] + router.urls
