from collections import defaultdict

from django.utils.dateparse import parse_date
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.activities.tasks import sync_activity_to_platform
from apps.platforms.models import Platform

from .models import Activity, ActivitySyncState
from .serializers import ActivitySerializer, ActivitySyncStateSerializer
from .tasks import sync_activity_task  # noqa: F401 （供 Celery 异步路径复用）


class ActivityPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


class ActivityViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """GET /api/activities/ · GET /api/activities/{id}/ · POST /api/activities/{id}/sync/"""

    serializer_class = ActivitySerializer
    pagination_class = ActivityPagination
    filterset_fields = {"activity_type": ["exact"], "source_platform": ["exact"]}
    ordering_fields = ["start_timestamp", "distance", "duration"]
    ordering = ["-start_timestamp"]

    def get_queryset(self):
        qs = Activity.objects.filter(user=self.request.user).prefetch_related(
            "sync_states__platform"
        )
        start_after = self.request.query_params.get("start_after")
        start_before = self.request.query_params.get("start_before")
        if start_after and parse_date(start_after):
            qs = qs.filter(start_timestamp__date__gte=parse_date(start_after))
        if start_before and parse_date(start_before):
            qs = qs.filter(start_timestamp__date__lte=parse_date(start_before))
        return qs

    @action(detail=True, methods=["post"])
    def sync(self, request, pk=None):
        """手动补同步到指定平台：{platform_id: number}"""
        platform_id = request.data.get("platform_id")
        if not platform_id:
            return Response({"detail": "缺少 platform_id"}, status=400)
        activity = self.get_object()
        state = sync_activity_to_platform(activity.id, int(platform_id))
        return Response(ActivitySyncStateSerializer(state).data)


class MatrixView(APIView):
    """GET /api/activities/matrix/ —— 活动矩阵：行 = 活动，列 = 平台"""

    def get(self, request):
        user = request.user
        platforms = Platform.objects.filter(is_active=True).order_by("id")
        # 先实体化 ID 列表：MySQL 不支持 "LIMIT & IN/ALL/ANY/SOME subquery"，
        # 直接把切片后的 queryset 用作 __in 子查询会报 NotSupportedError(1235)。
        activities = list(Activity.objects.filter(user=user).order_by("-start_timestamp")[:200])
        activity_ids = [a.id for a in activities]
        states = ActivitySyncState.objects.filter(activity_id__in=activity_ids).select_related("platform")

        by_activity: dict[int, dict[int, dict]] = defaultdict(dict)
        for s in states:
            by_activity[s.activity_id][s.platform_id] = {
                "status": s.status,
                "error_message": s.error_message,
                "remote_activity_id": s.remote_activity_id,
            }

        return Response(
            {
                "platforms": [{"id": p.id, "code": p.code, "name": p.name} for p in platforms],
                "activities": [
                    {
                        "id": a.id,
                        "name": a.name,
                        "start_timestamp": a.start_timestamp,
                        "activity_type": a.activity_type,
                        "duration": a.duration,
                        "distance": a.distance,
                        "source_platform": a.source_platform,
                        "states": by_activity.get(a.id, {}),
                    }
                    for a in activities
                ],
            }
        )
