from rest_framework import viewsets
from rest_framework.pagination import PageNumberPagination

from .models import SyncLog
from .serializers import SyncLogSerializer


class LogPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


class SyncLogViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/logs/ —— 同步日志（按管道 / 级别 / 活动筛选）"""

    serializer_class = SyncLogSerializer
    pagination_class = LogPagination
    filterset_fields = {"level": ["exact"], "pipeline": ["exact"], "activity": ["exact"]}
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return SyncLog.objects.filter(user=self.request.user).select_related("pipeline", "activity")
