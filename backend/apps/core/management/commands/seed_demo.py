"""创建演示数据：python manage.py seed_demo

- 平台定义（mock / igpsport / garmin / strava / coros）
- 演示用户 demo / demo123456，管理员 admin / admin123456
- Mock 平台账号 + 30 条近 30 天活动 + 同步状态 + 日志
- 两条示例管道（真实目标 & Mock 回环）
"""
import hashlib
import random
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.activities.models import Activity, ActivitySyncState
from apps.platforms.models import Platform, PlatformAccount
from apps.pipelines.models import Pipeline, PipelineEdge, PipelineNode
from apps.synclogs.models import SyncLog

PLATFORMS = [
    {
        "code": "mock",
        "name": "演示平台 (Mock)",
        "auth_type": "mock",
        "capabilities": {"fetch": True, "upload": True},
    },
    {
        "code": "igpsport",
        "name": "iGPSPORT",
        "auth_type": "oauth2",
        "capabilities": {"fetch": True, "upload": False},
    },
    {
        "code": "garmin",
        "name": "Garmin Connect",
        "auth_type": "oauth2",
        "capabilities": {"fetch": True, "upload": True},
    },
    {
        "code": "strava",
        "name": "Strava",
        "auth_type": "oauth2",
        "capabilities": {"fetch": True, "upload": True},
    },
    {
        "code": "coros",
        "name": "COROS",
        "auth_type": "oauth2",
        "capabilities": {"fetch": True, "upload": True},
    },
]

CYCLING_NAMES = [
    "清晨骑行 · 滨江线",
    "夜骑 · 城市环线",
    "周末长骑 · 环湖",
    "通勤骑行 · 跨江线",
    "爬坡训练 · 西山",
    "间歇骑行 · 大学城",
    "休闲骑 · 湿地公园",
    "长途拉练 · 国道 G318 段",
]
RUNNING_NAMES = ["晨跑 · 体育场", "夜跑 · 江边步道", "长距离慢跑", "越野跑 · 郊野公园"]
HIKING_NAMES = ["徒步 · 徽杭古道", "登山 · 莫干山", "郊野徒步"]


class Command(BaseCommand):
    help = "创建 VeloSync 演示数据（demo / demo123456）"

    def handle(self, *args, **options):
        rng = random.Random(42)

        # 1. 平台定义
        for spec in PLATFORMS:
            Platform.objects.update_or_create(code=spec["code"], defaults=spec)
        platforms = {p.code: p for p in Platform.objects.all()}
        self.stdout.write(f"平台定义就绪：{', '.join(platforms)}")

        # 2. 用户
        user, created = User.objects.get_or_create(
            username="demo", defaults={"email": "demo@velosync.local", "first_name": "演示骑手"}
        )
        if created:
            user.set_password("demo123456")
            user.save()
        admin, created = User.objects.get_or_create(
            username="admin",
            defaults={"email": "admin@velosync.local", "is_staff": True, "is_superuser": True},
        )
        if created:
            admin.set_password("admin123456")
            admin.save()

        # 3. 清理旧演示数据
        Activity.objects.filter(user=user).delete()
        Pipeline.objects.filter(user=user).delete()
        SyncLog.objects.filter(user=user).delete()
        PlatformAccount.objects.filter(user=user).delete()

        # 4. Mock 平台账号
        mock_acc = PlatformAccount.objects.create(
            user=user,
            platform=platforms["mock"],
            platform_user_id=f"mock-{user.id}",
            display_name="演示码表",
            status="active",
        )
        mock_acc.set_tokens("mock-access-token")
        mock_acc.save()

        # 5. 活动数据（近 30 天，60% 骑行）
        now = timezone.now()
        created_activities = []
        for i in range(30):
            days_ago = 30 - i
            start = now - timedelta(
                days=days_ago, hours=-rng.randint(0, 12), minutes=rng.randint(0, 59)
            )
            if start > now:
                start = now - timedelta(hours=rng.randint(1, 20))
            roll = rng.random()
            if roll < 0.6:
                activity_type = "cycling"
                name = CYCLING_NAMES[i % len(CYCLING_NAMES)]
                distance = round(15 + rng.random() * 65, 2)
                duration = int(distance / 25 * 3600) + rng.randint(-300, 600)
            elif roll < 0.85:
                activity_type = "running"
                name = RUNNING_NAMES[i % len(RUNNING_NAMES)]
                distance = round(4 + rng.random() * 12, 2)
                duration = int(distance / 10 * 3600) + rng.randint(-200, 400)
            else:
                activity_type = "hiking"
                name = HIKING_NAMES[i % len(HIKING_NAMES)]
                distance = round(5 + rng.random() * 10, 2)
                duration = int(distance / 4.5 * 3600) + rng.randint(-400, 800)
            fit_hash = hashlib.sha256(f"demo-{user.id}-{i}-{start.isoformat()}".encode()).hexdigest()
            activity = Activity.objects.create(
                user=user,
                name=name,
                start_timestamp=start,
                activity_type=activity_type,
                duration=max(600, duration),
                distance=distance,
                source_platform="mock",
                source_activity_id=f"mock-act-{user.id}-{i}",
                fit_hash=fit_hash,
            )
            created_activities.append(activity)

            # 6. 同步状态矩阵
            ActivitySyncState.objects.create(
                activity=activity,
                platform=platforms["mock"],
                status="synced",
                remote_activity_id=activity.source_activity_id,
                synced_at=start,
            )
            for code, weights in (
                ("garmin", (0.70, 0.85)),
                ("strava", (0.50, 0.80)),
                ("coros", (None, 0.20)),
            ):
                r = rng.random()
                if code == "coros":
                    status = "pending" if r < weights[1] else "na"
                    state_kwargs = {"status": status}
                else:
                    if r < weights[0]:
                        state_kwargs = {
                            "status": "synced",
                            "remote_activity_id": f"remote-{code}-{i}",
                            "synced_at": start + timedelta(minutes=5),
                        }
                    elif r < weights[1]:
                        state_kwargs = {"status": "pending"}
                    else:
                        state_kwargs = {
                            "status": "failed",
                            "error_message": "平台接口返回 503，稍后自动重试" if rng.random() < 0.5 else "Token 已过期，请重新授权",
                        }
                ActivitySyncState.objects.create(
                    activity=activity, platform=platforms[code], **state_kwargs
                )

        # 7. 日志
        for a in created_activities[:12]:
            SyncLog.objects.create(
                user=user,
                activity=a,
                level="info",
                message=f"拉取新活动「{a.name}」({a.activity_type}, {a.distance}km)",
                detail={"source": a.source_platform},
                created_at=a.start_timestamp,
            )
        for a in created_activities[:6]:
            SyncLog.objects.create(
                user=user,
                activity=a,
                level="success",
                message=f"已将「{a.name}」同步到 Garmin Connect",
                detail={"remote_id": f"remote-garmin-{a.id}"},
                created_at=a.start_timestamp + timedelta(minutes=5),
            )
        SyncLog.objects.create(
            user=user,
            level="error",
            message="同步「周末长骑 · 环湖」到 Strava 失败: 平台接口返回 503",
            created_at=now - timedelta(hours=3),
        )
        SyncLog.objects.create(
            user=user,
            level="warning",
            message="Garmin 账号 Token 即将过期（< 7 天），建议重新授权",
            created_at=now - timedelta(hours=8),
        )

        # 8. 示例管道
        p1 = Pipeline.objects.create(
            user=user,
            name="国内码表 → 国际平台",
            description="拉取演示码表全部活动，仅保留骑行，同步到 Strava 与 Garmin Connect",
            auto_run=False,
        )
        n_source = PipelineNode.objects.create(
            pipeline=p1, node_type="source", account=mock_acc,
            config={}, position_x=80, position_y=160,
        )
        n_filter = PipelineNode.objects.create(
            pipeline=p1, node_type="filter", account=None,
            config={"filter_type": "by_sport", "sport": "cycling"},
            position_x=360, position_y=160,
        )
        n_strava = PipelineNode.objects.create(
            pipeline=p1, node_type="target", account=None,
            config={}, position_x=640, position_y=80,
        )
        n_garmin = PipelineNode.objects.create(
            pipeline=p1, node_type="target", account=None,
            config={}, position_x=640, position_y=260,
        )
        PipelineEdge.objects.create(pipeline=p1, source_node=n_source, target_node=n_filter)
        PipelineEdge.objects.create(pipeline=p1, source_node=n_filter, target_node=n_strava)
        PipelineEdge.objects.create(pipeline=p1, source_node=n_filter, target_node=n_garmin)

        p2 = Pipeline.objects.create(
            user=user,
            name="演示回环（Mock 目标）",
            description="拉取演示码表活动，距离 ≥ 10km 的全部同步到 Mock 平台（可完整跑通）",
            auto_run=False,
        )
        m_source = PipelineNode.objects.create(
            pipeline=p2, node_type="source", account=mock_acc,
            config={}, position_x=100, position_y=140,
        )
        m_filter = PipelineNode.objects.create(
            pipeline=p2, node_type="filter", account=None,
            config={"filter_type": "by_distance", "min_distance": 10},
            position_x=380, position_y=140,
        )
        m_target = PipelineNode.objects.create(
            pipeline=p2, node_type="target", account=mock_acc,
            config={}, position_x=660, position_y=140,
        )
        PipelineEdge.objects.create(pipeline=p2, source_node=m_source, target_node=m_filter)
        PipelineEdge.objects.create(pipeline=p2, source_node=m_filter, target_node=m_target)

        self.stdout.write(self.style.SUCCESS("✅ 演示数据创建完成"))
        self.stdout.write("   登录账号: demo / demo123456（前台）  admin / admin123456（/admin/）")
