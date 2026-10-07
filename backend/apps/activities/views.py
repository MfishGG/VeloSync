from collections import defaultdict
from datetime import timedelta, timezone as dt_timezone

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.activities.tasks import sync_activity_to_platform
from apps.platforms.models import Platform

from .fit_utils import FitParseUnavailable, parse_fit_file
from .models import Activity, ActivityFitDetail, ActivitySyncState
from .serializers import (
    ActivityFitDetailSerializer,
    ActivitySerializer,
    ActivitySyncStateSerializer,
    FitHistorySerializer,
)
from .tasks import sync_activity_task  # noqa: F401 （供 Celery 异步路径复用）

MAX_FIT_SIZE = 20 * 1024 * 1024  # 20MB
TYPE_LABEL = {"cycling": "骑行", "running": "跑步", "swimming": "游泳", "hiking": "徒步"}


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

    @action(detail=True, methods=["get", "delete"], url_path="fit")
    def fit_detail(self, request, pk=None):
        """GET /api/activities/{id}/fit/ —— 该活动的 FIT 解析详情

        DELETE /api/activities/{id}/fit/ —— 删除解析详情
        带 ?with_activity=1 时连活动记录一并删除（同步矩阵中的行也会消失）。
        """
        activity = self.get_object()

        if request.method.lower() == "delete":
            with_activity = request.query_params.get("with_activity", "") in ("1", "true", "True")
            detail = ActivityFitDetail.objects.filter(activity=activity).first()
            if detail is None:
                return Response({"detail": "该活动没有可删除的 FIT 解析详情"}, status=404)
            detail.delete()
            if with_activity:
                activity.delete()  # 级联删除 sync_states / fit_detail
            return Response(status=204)

        detail = ActivityFitDetail.objects.filter(activity=activity).first()
        if detail is None:
            return Response({"detail": "该活动尚无 FIT 解析详情"}, status=404)
        return Response(ActivityFitDetailSerializer(detail).data)


class FitUploadView(APIView):
    """POST /api/activities/upload-fit/ —— 上传 FIT 文件并解析入库

    匹配策略：先按文件 SHA256（fit_hash）查重，再按 ±5 秒开始时间窗查找；
    都没有则新建活动，并初始化各平台的同步状态（默认 pending）。
    """

    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"detail": "缺少 FIT 文件（表单字段名 file）"}, status=400)
        if upload.size > MAX_FIT_SIZE:
            return Response({"detail": "文件过大（上限 20MB）"}, status=400)

        data = upload.read()
        if not data:
            return Response({"detail": "文件为空"}, status=400)

        try:
            parsed = parse_fit_file(data)
        except FitParseUnavailable as exc:
            return Response({"detail": str(exc)}, status=500)
        except Exception as exc:  # noqa: BLE001 - 文件损坏或不是活动 FIT
            return Response({"detail": f"FIT 解析失败：{exc}"}, status=400)

        summary = parsed["summary"]
        file_hash = parsed["file"]["sha256"]

        start = parse_datetime(summary["start_time"]) if summary.get("start_time") else None
        if start is not None and timezone.is_naive(start):
            start = timezone.make_aware(start, dt_timezone.utc)

        activity = Activity.objects.filter(user=request.user, fit_hash=file_hash).first()
        if activity is None and start is not None:
            activity = Activity.objects.filter(
                user=request.user,
                start_timestamp__range=(start - timedelta(seconds=5), start + timedelta(seconds=5)),
            ).first()

        created = False
        if activity is None:
            activity_type = summary.get("activity_type") or ""
            label = TYPE_LABEL.get(activity_type, "运动")
            activity = Activity.objects.create(
                user=request.user,
                name=(request.data.get("name") or "").strip()
                or f"{label} · FIT 导入 {timezone.now():%m-%d %H:%M}",
                start_timestamp=start or timezone.now(),
                activity_type=activity_type,
                duration=summary.get("duration") or 0,
                distance=summary.get("distance_km") or 0,
                source_platform="fit",
                source_activity_id=file_hash[:16],
                fit_hash=file_hash,
            )
            created = True
            # 初始化同步矩阵：新导入的活动在各平台均待同步
            for platform in Platform.objects.filter(is_active=True):
                ActivitySyncState.objects.get_or_create(
                    activity=activity, platform=platform, defaults={"status": "pending"}
                )
        elif not activity.fit_hash:
            activity.fit_hash = file_hash
            activity.save(update_fields=["fit_hash"])

        detail, _ = ActivityFitDetail.objects.update_or_create(
            activity=activity,
            defaults={
                "file_name": upload.name,
                "file_size": len(data),
                "file_hash": file_hash,
                "device": parsed.get("device", {}),
                "summary": summary,
                "samples": parsed.get("samples", []),
                "track": parsed.get("track", []),
            },
        )

        return Response(
            {
                "created": created,
                "activity": ActivitySerializer(activity).data,
                "detail": ActivityFitDetailSerializer(detail).data,
            },
            status=201 if created else 200,
        )


class FitHistoryView(APIView):
    """GET /api/activities/fit-history/ —— 当前用户的 FIT 导入历史（按解析时间倒序）"""

    def get(self, request):
        queryset = (
            ActivityFitDetail.objects.filter(activity__user=request.user)
            .select_related("activity")
            .order_by("-parsed_at")
        )
        return Response(FitHistorySerializer(queryset, many=True).data)


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
