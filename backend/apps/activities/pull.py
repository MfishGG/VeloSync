"""从平台账号拉取活动并落库（Strava 这类只提供数据流、不提供文件的来源）。

**为什么单独一套，而不是复用 pipelines 引擎**：引擎的同步语义是「源 → 目标」，
中途一律要原始文件（`download_fit` → `upload_fit`）。而 Strava 的 API 不提供活动
文件下载，`download_fit` 对它永远拿不到东西。所以「把 Strava 的记录读进来」只能是
独立的一条只读通道：数据流 → 采样点 → 本地活动，之后能看曲线、能导出 TCX。

**限流决定了必须「按需」**：每条活动的详情是一次 API 调用，而 Strava 新应用的读
配额是每 15 分钟 100 次、每天 1000 次。所以列表全量入库，详情只给最近 N 条。
"""
import logging
from datetime import timedelta

from django.utils import timezone

from apps.platforms.adapters import AdapterError, get_adapter
from apps.platforms.models import Platform

from .dedup import find_duplicate
from .fit_utils import summarize_samples
from .models import Activity, ActivityFitDetail, ActivitySyncState

logger = logging.getLogger(__name__)

#: 单次拉取最多取多少条详情。10 条约占「每 15 分钟 100 次读」的 10%，
#: 连点几次也不会立刻触发限流；再多就该等下一轮而不是一次拉满。
DEFAULT_DETAIL_LIMIT = 10

#: 拉取天数上限，避免有人一次要看五年
MAX_DAYS = 365


def _as_int(value):
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _as_float(value, digits: int):
    try:
        return round(float(value), digits)
    except (TypeError, ValueError):
        return None


def streams_to_detail(streams: dict, meta: dict) -> dict:
    """Strava streams → 与 FIT 解析结果同构的 {summary, samples, track, device}。

    纯函数，便于单测：不碰网络也不碰数据库。

    两个容易错的地方：
    - `latlng` 的元素顺序是 **[纬度, 纬度... 实际是 lat, lng]**，而本项目的 track
      约定是 `[lng, lat]`（与 GeoJSON 一致），必须换序；
    - `velocity_smooth` 是 m/s，而 samples 里的 `speed_kmh` 是 km/h。
    """
    times = streams.get("time") or []
    latlng = streams.get("latlng") or []
    distances = streams.get("distance") or []
    altitudes = streams.get("altitude") or []
    speeds = streams.get("velocity_smooth") or []
    hearts = streams.get("heartrate") or []
    cads = streams.get("cadence") or []
    watts = streams.get("watts") or []
    temps = streams.get("temp") or []

    def at(seq, index):
        return seq[index] if index < len(seq) else None

    samples: list[dict] = []
    track: list[list[float]] = []
    for index, seconds in enumerate(times):
        if seconds is None:
            continue
        point = at(latlng, index)
        lat = lng = None
        if isinstance(point, (list, tuple)) and len(point) >= 2:
            lat, lng = point[0], point[1]

        speed = at(speeds, index)
        samples.append(
            {
                "t": int(seconds),
                "distance_km": round((at(distances, index) or 0) / 1000, 3),
                "lat": _as_float(lat, 7),
                "lng": _as_float(lng, 7),
                "heart_rate": _as_int(at(hearts, index)),
                "power": _as_int(at(watts, index)),
                "cadence": _as_int(at(cads, index)),
                "speed_kmh": _as_float(float(speed) * 3.6, 2) if speed is not None else None,
                "altitude": _as_float(at(altitudes, index), 1),
                "temperature": _as_float(at(temps, index), 1),
            }
        )
        if lat is not None and lng is not None:
            track.append([round(float(lng), 6), round(float(lat), 6)])

    summary, _ = summarize_samples(
        samples,
        track,
        start_dt=meta.get("start_timestamp"),
        sport=meta.get("activity_type") or "",
        distance_km=meta.get("distance") or 0,
        duration=meta.get("duration") or 0,
        raw_count=len(times),
        raw_track_count=len(track),
    )
    return {
        "summary": summary,
        "samples": samples,
        "track": track,
        "device": {"manufacturer": meta.get("device_name") or ""},
    }


def _init_sync_states(activity: Activity, source_platform) -> None:
    """新活动的同步矩阵单元格：源平台视为已同步，其余待同步。"""
    for platform in Platform.objects.filter(is_active=True):
        ActivitySyncState.objects.get_or_create(
            activity=activity,
            platform=platform,
            defaults={"status": "synced" if platform.id == source_platform.id else "pending"},
        )


def detail_exists(activity) -> bool:
    return ActivityFitDetail.objects.filter(activity=activity).exists()


def import_detail(account, item: dict, activity) -> None:
    """拉一条活动的 streams 并写成解析详情。

    与 `pull_from_account` 分开是因为同步任务引擎也要用它 —— 引擎从平台来源
    拉活动时早先只建了活动行、不拉曲线，于是「Strava → 佳明」在合成 TCX 那一
    步必然没有采样点可用，报的却是「没有原始文件」，完全指不回真正原因。
    """
    adapter = get_adapter(account)
    streams = adapter.fetch_activity_streams(item["remote_id"])
    payload = streams_to_detail(streams, item)
    ActivityFitDetail.objects.update_or_create(
        activity=activity,
        defaults={
            # 没有文件可指，就用平台侧标识占位：列表页要显示「数据来自哪里」
            "file_name": f"{account.platform.name} · {item['remote_id']}"[:255],
            "file_size": 0,
            "file_hash": "",
            "device": payload["device"],
            "summary": payload["summary"],
            "samples": payload["samples"],
            "track": payload["track"],
        },
    )


def pull_from_account(
    account,
    *,
    days: int = 30,
    detail_limit: int = DEFAULT_DETAIL_LIMIT,
    with_detail: bool = True,
) -> dict:
    """拉取该账号最近 `days` 天的活动；最近的 `detail_limit` 条一并取详情。

    `with_detail=False` 只入列表（一条 API 调用），适合只想先看有哪些活动的场景。
    """
    days = max(1, min(int(days or 30), MAX_DAYS))
    detail_limit = max(0, int(detail_limit))
    since = timezone.now() - timedelta(days=days)

    adapter = get_adapter(account)
    stats = {
        "fetched": 0,
        "imported": 0,
        "duplicate": 0,
        "detail_imported": 0,
        "detail_skipped": 0,
        "detail_failed": 0,
        "errors": [],
    }

    items = adapter.fetch_activities(since=since) or []
    stats["fetched"] = len(items)

    # 详情只给最近的几条：新活动才是用户当下要看的东西，也是限流能覆盖的量
    items.sort(key=lambda item: item["start_timestamp"], reverse=True)
    can_stream = callable(getattr(adapter, "fetch_activity_streams", None))

    for index, item in enumerate(items):
        activity = _upsert_activity(account, item, stats)
        if activity is None:
            continue
        if not with_detail or not can_stream:
            continue
        if index >= detail_limit:
            stats["detail_skipped"] += 1
            continue
        if detail_exists(activity):
            stats["detail_skipped"] += 1
            continue

        try:
            import_detail(account, item, activity)
            stats["detail_imported"] += 1
        except AdapterError as exc:
            # 单条失败不中断整批：限流是 429、个别活动可能被设为私密
            stats["detail_failed"] += 1
            stats["errors"].append(str(exc)[:200])
        except Exception as exc:  # noqa: BLE001 - 数据形状意外时保住整批
            logger.exception("导入 Strava 活动 %s 的详情失败", item.get("remote_id"))
            stats["detail_failed"] += 1
            stats["errors"].append(f"{type(exc).__name__}: {exc}"[:200])

    return stats


def _upsert_activity(account, item: dict, stats: dict):
    """按「平台内 ID → 时间窗去重」的顺序写入活动，返回已存在的也照常返回。"""
    user = account.user
    remote_id = item.get("remote_id") or ""

    existing = None
    if remote_id:
        existing = Activity.objects.filter(
            user=user,
            source_platform=account.platform.code,
            source_activity_id=remote_id,
        ).first()
    if existing is None:
        # 同一场骑行可能已从 FIT 导入过：这里靠时间窗认得出来，不再重复记一条
        existing = find_duplicate(user, item["start_timestamp"], item.get("fit_hash") or "")
    if existing is not None:
        stats["duplicate"] += 1
        return existing

    activity = Activity.objects.create(
        user=user,
        name=item.get("name") or "未命名活动",
        start_timestamp=item["start_timestamp"],
        activity_type=item.get("activity_type") or "",
        duration=item.get("duration") or 0,
        distance=item.get("distance") or 0,
        source_platform=account.platform.code,
        source_activity_id=remote_id,
        fit_hash=item.get("fit_hash") or "",
    )
    _init_sync_states(activity, account.platform)
    stats["imported"] += 1
    return activity
