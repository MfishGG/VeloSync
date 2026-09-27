"""仪表盘统计：概览数字、平台分布、30 天趋势、最近同步。"""
from datetime import timedelta

from django.db.models import Count
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.activities.models import Activity, ActivitySyncState
from apps.platforms.models import Platform


class DashboardStatsView(APIView):
    """GET /api/dashboard/stats/"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        activities = Activity.objects.filter(user=user)
        states = ActivitySyncState.objects.filter(activity__user=user)

        synced = states.filter(status="synced").count()
        pending = states.filter(status="pending").count()
        failed = states.filter(status="failed").count()
        total = activities.count()
        syncable = synced + pending + failed
        rate = round(synced / syncable * 100, 1) if syncable else 0.0

        # 平台分布（按活动来源平台）
        name_by_code = {p.code: p.name for p in Platform.objects.filter(is_active=True)}
        distribution = (
            activities.values("source_platform").annotate(count=Count("id")).order_by("-count")
        )
        platform_distribution = [
            {
                "platform": name_by_code.get(d["source_platform"], d["source_platform"]),
                "count": d["count"],
            }
            for d in distribution
        ]

        # 近 30 天趋势（按活动开始日期）
        start = timezone.now() - timedelta(days=29)
        per_day = (
            activities.filter(start_timestamp__gte=start)
            .annotate(day=TruncDate("start_timestamp"))
            .values("day")
            .annotate(count=Count("id"))
        )
        count_by_day = {d["day"]: d["count"] for d in per_day}
        today = timezone.localdate()
        trend_30d = [
            {
                "date": (today - timedelta(days=29 - i)).isoformat(),
                "count": count_by_day.get(today - timedelta(days=29 - i), 0),
            }
            for i in range(30)
        ]

        # 最近同步
        recent_qs = (
            states.filter(status="synced", synced_at__isnull=False)
            .select_related("activity", "platform")
            .order_by("-synced_at")[:10]
        )
        recent_syncs = [
            {
                "activity_id": s.activity_id,
                "activity": s.activity.name,
                "platform": s.platform.name,
                "synced_at": s.synced_at,
            }
            for s in recent_qs
        ]

        return Response(
            {
                "total_activities": total,
                "synced": synced,
                "pending": pending,
                "failed": failed,
                "sync_rate": rate,
                "platform_distribution": platform_distribution,
                "trend_30d": trend_30d,
                "recent_syncs": recent_syncs,
            }
        )
