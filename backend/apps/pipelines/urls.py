from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import PipelineViewSet

router = DefaultRouter()
router.register("", PipelineViewSet, basename="pipeline")

urlpatterns = router.urls
