"""把已解析的采样点合成为 TCX 文件。

**为什么需要这一步**：Strava 的 API 不提供原始文件下载（api/v3 下没有
export_original / export_tcx，只有网页版才有），而 Garmin 只接受文件
（`upload-service` 收 fit / tcx / gpx），两边对不上。要让「Strava → 佳明」这条
链路成立，中间必须有人把数据流合成为文件。

**为什么是 TCX 而不是 FIT**：TCX 就是普通 XML，几十行即可生成，且能带心率、
踏频、功率；FIT 需要 field definition、CRC、profile 编码，为一个「只用于中转」
的文件引入整套 SDK 不值得。Garmin Connect 的导入同时接受 fit / tcx / gpx。

**它不等价于原始文件**：laps、设备信息、传感器原始字段、圈段都会丢，只有
Trackpoint 级别的数据。这是 Strava 源的天花板，不是实现取舍。
"""
from datetime import timedelta
from datetime import timezone as dt_timezone

from django.utils import timezone

#: TCX 的 Sport 只允许三个值（TrainingCenterDatabase v2），其余一律 Other
SPORT_MAP = {
    "cycling": "Biking",
    "running": "Running",
    "swimming": "Other",
    "hiking": "Other",
}

#: 单文件轨迹点上限。TCX 的每个点约 200 字节，1 万个点就是 2MB —
#: 超过这个量级 Garmin 的导入会明显变慢，而按 1Hz 记录 1 万秒已是近 3 小时。
MAX_POINTS = 12000


def _iso_z(value) -> str:
    """TCX 要求 UTC 且带 Z；naive 时间按 UTC 处理（FIT/Strava 都是 UTC 语义）。"""
    if timezone.is_naive(value):
        value = timezone.make_aware(value, dt_timezone.utc)
    return value.astimezone(dt_timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _num(value, digits=1):
    """数值格式化：None 返回 None（调用方据此决定是否输出该标签）。"""
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if digits == 0:
        return str(int(round(number)))
    return f"{number:.{digits}f}".rstrip("0").rstrip(".")


def _split_evenly(items: list, limit: int) -> list:
    """等距抽稀，始终保留首尾点（与 fit_utils._downsample 同规则）。"""
    if len(items) <= limit or limit <= 1:
        return items
    step = (len(items) - 1) / (limit - 1)
    return [items[round(i * step)] for i in range(limit)]


def build_tcx(activity, detail) -> str:
    """按活动与解析详情生成 TCX 文本。

    只用 samples（含相对秒数 `t`）—— track 里没有时间戳，单靠它生成的 TCX
    在 Garmin 上会是一条「所有点时间相同」的无效轨迹。
    """
    samples = [s for s in (detail.samples or []) if s.get("t") is not None]
    if not samples:
        raise ValueError("该活动没有带时间戳的采样点，无法生成 TCX")

    summary = detail.summary or {}
    start = activity.start_timestamp
    sport = SPORT_MAP.get((activity.activity_type or "").lower(), "Other")

    samples = _split_evenly(samples, MAX_POINTS)

    # ---- Lap 汇总值 ----
    duration = int(summary.get("duration") or 0)
    if not duration:
        duration = int(max(s["t"] for s in samples))
    distance_m = float(summary.get("distance_km") or 0) * 1000
    if not distance_m:
        distance_m = float(max((s.get("distance_km") or 0) for s in samples)) * 1000

    parts: list[str] = []
    add = parts.append

    add('<?xml version="1.0" encoding="UTF-8"?>')
    add(
        '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"'
        ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
        ' xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"'
        ' xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2'
        ' http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">'
    )
    add("<Activities>")
    add(f'<Activity Sport="{sport}">')
    add(f"<Id>{_iso_z(start)}</Id>")
    add(f'<Lap StartTime="{_iso_z(start)}">')
    add(f"<TotalTimeSeconds>{duration}</TotalTimeSeconds>")
    add(f"<DistanceMeters>{_num(distance_m, 2)}</DistanceMeters>")

    max_speed = summary.get("max_speed_kmh")
    if max_speed:
        add(f"<MaximumSpeed>{_num(float(max_speed) / 3.6, 2)}</MaximumSpeed>")
    if summary.get("calories"):
        add(f"<Calories>{int(summary['calories'])}</Calories>")
    if summary.get("avg_heart_rate"):
        add(f"<AverageHeartRateBpm><Value>{int(summary['avg_heart_rate'])}</Value></AverageHeartRateBpm>")
    if summary.get("max_heart_rate"):
        add(f"<MaximumHeartRateBpm><Value>{int(summary['max_heart_rate'])}</Value></MaximumHeartRateBpm>")

    add("<Intensity>Active</Intensity>")
    if summary.get("avg_cadence"):
        add(f"<Cadence>{int(summary['avg_cadence'])}</Cadence>")
    add("<TriggerMethod>Manual</TriggerMethod>")
    add("<Track>")

    for sample in samples:
        point = _trackpoint(start, sample)
        if point:
            add(point)

    add("</Track>")
    add("</Lap>")
    add(
        '<Creator xsi:type="Device_t"><Name>VeloSync</Name><UnitId>0</UnitId>'
        "<ProductID>0</ProductID><Version><VersionMajor>1</VersionMajor>"
        "<VersionMinor>0</VersionMinor></Version></Creator>"
    )
    add("</Activity>")
    add("</Activities>")
    add("</TrainingCenterDatabase>")
    return "\n".join(parts)


def _trackpoint(start, sample: dict) -> str:
    """单个轨迹点。子元素顺序由 TCX schema 固定，调换会通不过校验。"""
    when = start + timedelta(seconds=int(sample["t"]))
    chunks = [f"<Trackpoint><Time>{_iso_z(when)}</Time>"]

    lat, lng = sample.get("lat"), sample.get("lng")
    if lat is not None and lng is not None:
        chunks.append(
            "<Position>"
            f"<LatitudeDegrees>{float(lat):.7f}</LatitudeDegrees>"
            f"<LongitudeDegrees>{float(lng):.7f}</LongitudeDegrees>"
            "</Position>"
        )

    altitude = _num(sample.get("altitude"), 1)
    if altitude is not None:
        chunks.append(f"<AltitudeMeters>{altitude}</AltitudeMeters>")

    distance = _num(float(sample.get("distance_km") or 0) * 1000, 1)
    if distance is not None:
        chunks.append(f"<DistanceMeters>{distance}</DistanceMeters>")

    heart = sample.get("heart_rate")
    if heart is not None:
        chunks.append(f"<HeartRateBpm><Value>{int(heart)}</Value></HeartRateBpm>")

    cadence = sample.get("cadence")
    if cadence is not None:
        chunks.append(f"<Cadence>{int(cadence)}</Cadence>")

    # 速度与功率只能放在 ActivityExtension 里；Garmin 读的是 TPX 下的 Speed(m/s)/Watts
    speed = sample.get("speed_kmh")
    power = sample.get("power")
    if speed is not None or power is not None:
        ext = ["<Extensions><ns3:TPX>"]
        if speed is not None:
            ext.append(f"<ns3:Speed>{_num(float(speed) / 3.6, 3)}</ns3:Speed>")
        if power is not None:
            ext.append(f"<ns3:Watts>{int(power)}</ns3:Watts>")
        ext.append("</ns3:TPX></Extensions>")
        chunks.append("".join(ext))

    chunks.append("</Trackpoint>")
    return "".join(chunks)


def tcx_filename(name: str) -> str:
    """文件名去掉换行与引号 —— 它们会破坏 Content-Disposition 头。

    这里**不做 XML 转义**：`&` 会变成 `&amp;` 印在用户看到的文件名上。
    """
    cleaned = (name or "").strip()[:60]
    return "".join(ch for ch in cleaned if ch not in '\r\n"\\/' and ch.isprintable()) or "activity"
