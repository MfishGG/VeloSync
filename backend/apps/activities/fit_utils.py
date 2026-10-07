"""FIT 文件工具：完整解析（fitparse）、元数据提取、CRC 校验。

解析结果分四块：
- summary：活动汇总指标（距离 / 时长 / 爬升 / 心率 / 功率 / 踏频 / 速度…）
- samples：采样点序列（按时间降采样，供前端画曲线）
- track：GPS 轨迹（[经度, 纬度] 序列，供前端画路径）
- device：设备信息（file_id）

fitparse 为可选依赖；未安装时 parse_fit_file 抛出 FitParseUnavailable。
"""
from __future__ import annotations

import hashlib
import io
import logging
import math
from datetime import datetime

logger = logging.getLogger(__name__)

try:
    import fitparse  # type: ignore
except ImportError:  # pragma: no cover
    fitparse = None

# FIT sport -> 统一运动类型
SPORT_MAP = {
    "cycling": "cycling",
    "road_cycling": "cycling",
    "mountain_biking": "cycling",
    "biking": "cycling",
    "running": "running",
    "trail_running": "running",
    "treadmill_running": "running",
    "swimming": "swimming",
    "hiking": "hiking",
    "walking": "hiking",
}

SEMICIRCLE = 2**31 / 180.0  # FIT 坐标换算系数

MAX_SAMPLES = 30000  # 采样点上限（保留全部原始点；仅超长活动才抽稀，约 8 小时 1Hz 记录）
MAX_TRACK = 30000  # 轨迹点上限（与采样同源，独立保留含 GPS 的点）

# 各指标的合理区间，用于过滤无效值（FIT 用 0xFF / 0xFFFF 表示"无数据"）
RANGES = {
    "heart_rate": (20, 250),
    "power": (0, 3000),
    "cadence": (0, 250),
    "speed": (0, 100),  # m/s
    "altitude": (-1000, 10000),  # m
}

# FIT SDK 的 CRC 查表（反射 CRC-16，与 fitparse 一致）
_CRC_TABLE = (
    0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
    0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
)


class FitParseUnavailable(RuntimeError):
    """fitparse 未安装"""


def _clean(value, key: str):
    """过滤无效/越界数值"""
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    low, high = RANGES.get(key, (-1e9, 1e9))
    return None if number < low or number > high else number


def _to_degrees(semicircles):
    if semicircles is None:
        return None
    return round(semicircles / SEMICIRCLE, 6)


def _downsample(items: list, limit: int) -> list:
    """等间隔降采样，始终保留首尾两点"""
    if len(items) <= limit or limit <= 1:
        return items
    step = (len(items) - 1) / (limit - 1)
    picked = [items[round(i * step)] for i in range(limit)]
    return picked


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """两点球面距离（米）"""
    radius = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(a)))


def _fill_distance(samples: list[dict]) -> None:
    """补全累计距离（km，4 位小数 ≈ 0.1 m 精度）。

    优先采用设备记录的 distance（米）；缺失时用相邻 GPS 点球面距离累加，
    保证「按距离维度」画图时 X 轴始终有值且单调不减。
    """
    cumulative = 0.0
    prev = None
    for s in samples:
        raw = s.get("_raw_distance")
        if raw is not None:
            try:
                device_m = max(float(raw), 0.0)
            except (TypeError, ValueError):
                device_m = 0.0
            cumulative = max(cumulative, device_m)
        elif prev is not None and prev["lat"] is not None and s["lat"] is not None:
            cumulative += _haversine_m(prev["lat"], prev["lng"], s["lat"], s["lng"])
        s["distance_km"] = round(cumulative / 1000, 4)
        prev = s


def _normalized_power(powers: list[float]) -> float | None:
    """NP：30 秒移动平均功率的四次方均值再开四次方"""
    if len(powers) < 30:
        return None
    window = 30
    rolling = []
    for i in range(window, len(powers) + 1):
        chunk = powers[i - window : i]
        rolling.append(sum(chunk) / window)
    if not rolling:
        return None
    mean_4th = sum((p**4 for p in rolling)) / len(rolling)
    return round(mean_4th**0.25, 1)


def _stats(values: list[float]) -> tuple[float | None, float | None]:
    clean = [v for v in values if v is not None]
    if not clean:
        return None, None
    return round(sum(clean) / len(clean), 1), round(max(clean), 1)


def parse_fit_file(data: bytes) -> dict:
    """完整解析 FIT 文件，返回 summary / samples / track / device / file。

    fitparse 已应用 scale/offset：时间为 datetime、时长为秒、海拔为米；
    但 **坐标仍是半圆值、距离是米、速度是 m/s**，需在此转换。
    """
    if fitparse is None:
        raise FitParseUnavailable("未安装 fitparse，无法解析 FIT（pip install fitparse）")

    fit = fitparse.FitFile(io.BytesIO(data))
    messages = list(fit.get_messages())

    session: dict = {}
    device: dict = {}
    records: list[dict] = []
    for msg in messages:
        if msg.name == "session" and not session:
            session = msg.get_values()
        elif msg.name == "file_id" and not device:
            device = msg.get_values()
        elif msg.name == "record":
            records.append(msg.get_values())

    if not records and not session:
        raise ValueError("FIT 文件中没有 record / session 数据，可能不是活动文件")

    # ---- 采样点（先全量保留，最后才按需抽稀） ----
    start_dt: datetime | None = None
    samples: list[dict] = []
    for raw in records:
        ts = raw.get("timestamp")
        if isinstance(ts, datetime) and start_dt is None:
            start_dt = ts
        lat = _to_degrees(raw.get("position_lat"))
        lng = _to_degrees(raw.get("position_long"))
        speed = _clean(raw.get("speed"), "speed")
        samples.append(
            {
                "t": int((ts - start_dt).total_seconds()) if isinstance(ts, datetime) and start_dt else None,
                "distance_km": 0.0,  # 下面统一补全
                "speed_kmh": round(speed * 3.6, 2) if speed is not None else None,
                "heart_rate": _clean(raw.get("heart_rate"), "heart_rate"),
                "power": _clean(raw.get("power"), "power"),
                "cadence": _clean(raw.get("cadence"), "cadence"),
                "altitude": _clean(raw.get("altitude"), "altitude"),
                "lat": lat,
                "lng": lng,
                "_raw_distance": raw.get("distance"),  # 临时字段，补全后移除
            }
        )
    raw_count = len(samples)
    _fill_distance(samples)

    # ---- 轨迹：优先取全量 GPS 点，尽量不丢点 ----
    track = [
        [round(s["lng"], 6), round(s["lat"], 6)]
        for s in samples
        if s["lat"] is not None and s["lng"] is not None
    ]
    raw_track_count = len(track)
    track = _downsample(track, MAX_TRACK)

    for s in samples:
        s.pop("_raw_distance", None)
    samples_downsampled = raw_count > MAX_SAMPLES
    samples = _downsample(samples, MAX_SAMPLES)

    # ---- 汇总 ----
    hearts = [s["heart_rate"] for s in samples]
    powers = [s["power"] for s in samples]
    cads = [s["cadence"] for s in samples]
    speeds = [s["speed_kmh"] for s in samples]
    alts = [s["altitude"] for s in samples]

    sport = str(session.get("sport") or "").lower()
    duration = session.get("total_timer_time") or session.get("total_elapsed_time")
    if not duration:
        times = [s["t"] for s in samples if s["t"] is not None]
        duration = (max(times) - min(times)) if times and len(times) > 1 else 0
    duration = int(duration or 0)

    distance_km = round((session.get("total_distance") or 0) / 1000, 2)
    if not distance_km:
        distance_km = round(max((s["distance_km"] for s in samples), default=0), 2)

    ascent = session.get("total_ascent")
    descent = session.get("total_descent")
    valid_alts = [a for a in alts if a is not None]
    if ascent is None and len(valid_alts) > 1:
        ascent = int(sum(max(valid_alts[i + 1] - valid_alts[i], 0) for i in range(len(valid_alts) - 1)))
    if descent is None and len(valid_alts) > 1:
        descent = int(sum(max(valid_alts[i] - valid_alts[i + 1], 0) for i in range(len(valid_alts) - 1)))

    if session.get("avg_heart_rate") is not None:
        avg_hr, max_hr = session["avg_heart_rate"], session.get("max_heart_rate")
    else:
        avg_hr, max_hr = _stats(hearts)
    if session.get("avg_power") is not None:
        avg_power, max_power = session["avg_power"], session.get("max_power")
    else:
        avg_power, max_power = _stats(powers)
    if session.get("avg_cadence") is not None:
        avg_cad, max_cad = session["avg_cadence"], session.get("max_cadence")
    else:
        avg_cad, max_cad = _stats(cads)

    avg_speed = session.get("avg_speed")
    max_speed = session.get("max_speed")
    if avg_speed is None:
        avg_speed, _ = _stats(speeds)
        max_speed = max((s for s in speeds if s is not None), default=None)
    else:
        avg_speed = round(avg_speed * 3.6, 2)
        max_speed = round(max_speed * 3.6, 2) if max_speed is not None else None

    if start_dt is None and isinstance(session.get("start_time"), datetime):
        start_dt = session["start_time"]

    summary = {
        "start_time": start_dt.isoformat() if isinstance(start_dt, datetime) else None,
        "sport": sport or None,
        "activity_type": SPORT_MAP.get(sport, sport or ""),
        "distance_km": distance_km,
        "duration": duration,
        "total_ascent": int(ascent) if ascent is not None else None,
        "total_descent": int(descent) if descent is not None else None,
        "calories": session.get("total_calories"),
        "avg_heart_rate": avg_hr,
        "max_heart_rate": max_hr,
        "avg_power": avg_power,
        "max_power": max_power,
        "normalized_power": _normalized_power([p for p in powers if p is not None]),
        "avg_cadence": avg_cad,
        "max_cadence": max_cad,
        "avg_speed_kmh": avg_speed,
        "max_speed_kmh": max_speed,
        "sample_count": len(samples),
        "raw_record_count": raw_count,
        "track_point_count": len(track),
        "raw_track_count": raw_track_count,
        "downsampled": samples_downsampled or raw_track_count > len(track),
        "has_gps": bool(track),
    }

    return {
        "summary": summary,
        "samples": samples,
        "track": track,
        "device": {
            "manufacturer": device.get("manufacturer"),
            "product": device.get("product"),
            "serial_number": device.get("serial_number"),
            "time_created": device.get("time_created").isoformat()
            if isinstance(device.get("time_created"), datetime)
            else None,
        },
        "file": {
            "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "message_count": len(messages),
        },
    }


def parse_fit_metadata(data: bytes) -> dict | None:
    """解析 FIT 元数据（去重 / 入库用）：开始时间 / 类型 / 距离 / 时长 / 坐标点。"""
    try:
        parsed = parse_fit_file(data)
    except FitParseUnavailable:
        logger.warning("fitparse 未安装，无法解析 FIT 文件（pip install fitparse）")
        return None
    except Exception as exc:  # noqa: BLE001
        logger.error("FIT 解析失败: %s", exc)
        return None

    summary = parsed["summary"]
    if not summary["start_time"]:
        return None
    return {
        "start_timestamp": summary["start_time"],
        "activity_type": summary["activity_type"],
        "distance": summary["distance_km"],
        "duration": summary["duration"],
        "coords": [(lng, lat) for lng, lat in parsed["track"]],
    }


def fit_crc(data: bytes) -> int:
    """FIT CRC16（反射算法，与 FIT SDK / fitparse 一致）。"""
    crc = 0
    for byte in data:
        tmp = _CRC_TABLE[crc & 0xF]
        crc = (crc >> 4) & 0x0FFF
        crc = crc ^ tmp ^ _CRC_TABLE[byte & 0xF]
        tmp = _CRC_TABLE[crc & 0xF]
        crc = (crc >> 4) & 0x0FFF
        crc = crc ^ tmp ^ _CRC_TABLE[(byte >> 4) & 0xF]
    return crc
