"""演示数据：单一构建入口。

为什么单独成模块：演示内容既要能由 `seed_demo_account`（线上 / 提审）产出，
也要能被 `seed_demo`（本地开发，附带 admin 弱口令）复用。两份拷贝漂移一次，
就会出现「本地看到的演示环境和审核员看到的不一样」—— 而演示环境恰恰是对外
展示的那一面，不一致会直接变成沟通成本。

与 `platforms/0004_seed_platforms` 的分工（两者都叫「预置」，但性质不同）：

  · 那份是**基础数据**（平台字典），没有它应用根本跑不起来 → 放进迁移，
    随 entrypoint 的 `migrate` 自动落库，任何人都不必记得手动执行；
  · 这里是**演示内容**，可选、可重置、由 `DEMO_MODE` 控制 → 走管理命令 +
    entrypoint，不进迁移。理由是它不属于 schema 演进：几十条活动与同步状态
    一旦进迁移，所有按行数断言的测试都得跟着改，而演示数据本就是「随时可以
    整个删掉重来」的东西。

口令：线上演示账号用 `set_unusable_password()`。它只该从演示入口
（`POST /api/auth/demo/`）进入 —— 若还留着 `demo123456` 这种口令，
`/api/auth/login/` 上就凭空多出一个可被撞库的弱口令账号。
本地开发由 `seed_demo` 显式传入口令，方便网页端直接账密登录。
"""
import hashlib
import random
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.utils import timezone

from apps.activities.models import Activity, ActivitySyncState
from apps.platforms.models import Platform, PlatformAccount
from apps.pipelines.models import Pipeline
from apps.synclogs.models import SyncLog

#: 演示账号用户名。放 settings 是为了让接口层与数据层读同一个值 ——
#: 两处各写一份字面量，改一处就会悄悄对不上。
DEMO_USERNAME = "demo"
DEMO_NICKNAME = "演示骑手"

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


class DemoDataError(Exception):
    """演示数据无法构建（例如平台基础数据缺失）。调用方负责转成可操作的提示。"""


def demo_username() -> str:
    return getattr(settings, "DEMO_USERNAME", DEMO_USERNAME)


def demo_user() -> User | None:
    return User.objects.filter(username=demo_username()).first()


def ensure_demo_user(password: str | None = None) -> tuple[User, bool]:
    """取或建演示账号。

    `password=None` 表示**不可登录的口令**（线上默认）。本地 `seed_demo` 会显式
    传一个口令，方便在网页端直接用账密登录调试。
    """
    user, created = User.objects.get_or_create(
        username=demo_username(),
        defaults={"email": "demo@velosync.local", "first_name": DEMO_NICKNAME},
    )
    if created:
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(update_fields=["password"])
    return user, created


def clear_demo_content(user: User) -> None:
    """清空演示账号的业务数据（账号本身保留）。"""
    Activity.objects.filter(user=user).delete()
    Pipeline.objects.filter(user=user).delete()
    SyncLog.objects.filter(user=user).delete()
    PlatformAccount.objects.filter(user=user).delete()


def build_demo_content(user: User) -> dict:
    """写入演示内容：平台账号 / 活动 / 同步状态矩阵 / 日志 / 示例任务。

    前置条件是平台字典已存在（迁移 `platforms/0004_seed_platforms` 预置）。
    缺了就直接报错 —— 而不是安静地少建几条数据：凭空的「部分成功」会让
    页面看起来只是「数据少」，排查时要从头猜起。
    """
    platforms = {p.code: p for p in Platform.objects.all()}
    if not platforms:
        raise DemoDataError(
            "平台基础数据缺失，请先执行 `python manage.py migrate`"
            "（平台字典在迁移 platforms/0004_seed_platforms 里）"
        )

    rng = random.Random(42)
    stats = {"accounts": 0, "activities": 0, "sync_states": 0, "logs": 0, "pipelines": 0}

    # ---- 演示平台账号 ----
    mock_acc = PlatformAccount.objects.create(
        user=user,
        platform=platforms["mock"],
        platform_user_id=f"mock-{user.id}",
        display_name="演示码表",
        status="active",
    )
    mock_acc.set_tokens("mock-access-token")
    mock_acc.save()
    stats["accounts"] += 1

    # ---- 活动（近 30 天，60% 骑行）----
    now = timezone.now()
    created_activities = []
    for i in range(30):
        days_ago = 30 - i
        start = now - timedelta(days=days_ago, hours=-rng.randint(0, 12), minutes=rng.randint(0, 59))
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
        stats["activities"] += 1

        # ---- 同步状态矩阵（让「矩阵」页有内容可看）----
        ActivitySyncState.objects.create(
            activity=activity,
            platform=platforms["mock"],
            status="synced",
            remote_activity_id=activity.source_activity_id,
            synced_at=start,
        )
        stats["sync_states"] += 1
        for code, weights in (
            ("garmin", (0.70, 0.85)),
            ("strava", (0.50, 0.80)),
            ("coros", (None, 0.20)),
        ):
            r = rng.random()
            if code == "coros":
                state_kwargs = {"status": "pending" if r < weights[1] else "na"}
            elif r < weights[0]:
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
                    "error_message": "平台接口返回 503，稍后自动重试"
                    if rng.random() < 0.5
                    else "Token 已过期，请重新授权",
                }
            ActivitySyncState.objects.create(
                activity=activity, platform=platforms[code], **state_kwargs
            )
            stats["sync_states"] += 1

    # ---- 日志（四种级别都覆盖，方便看列表样式）----
    for a in created_activities[:12]:
        SyncLog.objects.create(
            user=user,
            activity=a,
            level="info",
            message=f"拉取新活动「{a.name}」({a.activity_type}, {a.distance}km)",
            detail={"source": a.source_platform},
            created_at=a.start_timestamp,
        )
        stats["logs"] += 1
    for a in created_activities[:6]:
        SyncLog.objects.create(
            user=user,
            activity=a,
            level="success",
            message=f"已将「{a.name}」同步到 Garmin Connect",
            detail={"remote_id": f"remote-garmin-{a.id}"},
            created_at=a.start_timestamp + timedelta(minutes=5),
        )
        stats["logs"] += 1
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
    stats["logs"] += 2

    # ---- 示例同步任务（结构化配置 → 自动展开执行图）----
    garmin_acc = PlatformAccount.objects.create(
        user=user,
        platform=platforms["garmin"],
        platform_user_id=f"garmin-{user.id}",
        display_name="佳明 955",
        status="active",
    )
    garmin_acc.set_tokens("garmin-demo-token")
    garmin_acc.save()
    stats["accounts"] += 1

    for spec in (
        {
            "name": "演示码表 → 演示平台（全量内容）",
            "description": "拉取演示码表最近 30 天活动，并把个人资料 / 体重 / 睡眠一并同步（可完整跑通）",
            "source_type": "mock",
            "source_account": mock_acc,
            "sync_content": ["activity", "profile", "weight", "sleep"],
            "time_range": {"mode": "recent", "start": None, "end": None, "days": 30},
            "targets": [mock_acc],
        },
        {
            "name": "FIT 记录 → 演示平台",
            "description": "把本地导入的 FIT 记录（含采样点与 GPS 轨迹）同步出去，默认开启坐标纠偏与智能去重",
            "source_type": "fit",
            "source_account": None,
            "source_fit_detail": None,
            "sync_content": ["activity", "summary", "samples", "track"],
            "time_range": {"mode": "file", "start": None, "end": None, "days": 30},
            "targets": [mock_acc],
        },
        {
            "name": "演示码表 → 佳明（含睡眠/体重）",
            "description": "跨平台示例：佳明接口按官方文档适配后即可跑通；未实现的内容会记为「预留」并跳过",
            "source_type": "mock",
            "source_account": mock_acc,
            "sync_content": ["activity", "profile", "sleep", "weight"],
            "time_range": {"mode": "recent", "start": None, "end": None, "days": 7},
            "targets": [garmin_acc],
        },
    ):
        targets = spec.pop("targets")
        pipeline = Pipeline.objects.create(user=user, auto_run=False, **spec)
        pipeline.target_accounts.set(targets)
        pipeline.ensure_defaults()
        pipeline.save()
        pipeline.rebuild_graph()
        stats["pipelines"] += 1

    return stats


def seed_demo_account(password: str | None = None, reset: bool = False) -> tuple[User, bool, dict]:
    """确保演示账号与演示数据就位。返回 `(user, created, stats)`。

    幂等语义（entrypoint 每次容器启动都会调它，必须便宜且不破坏已有数据）：
      · 账号不存在 → 建账号 + 建内容；
      · 账号在、但一条活动都没有 → 只补内容（例如演示账号被清空过）；
      · 账号在、已有活动 → 什么都不做，直接返回（stats 为空字典）。
    要「保证提审前数据整洁」用 `reset=True`，它会先清后建。
    """
    user, created = ensure_demo_user(password=password)
    if not created and not reset and Activity.objects.filter(user=user).exists():
        return user, created, {}

    clear_demo_content(user)
    stats = build_demo_content(user)
    return user, created, stats
