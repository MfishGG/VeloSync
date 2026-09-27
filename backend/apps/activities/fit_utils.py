"""FIT 文件工具：元数据解析（fitparse）、字段补全、CRC 重算。

fitparse 为可选依赖，未安装时相关函数返回 None 并提示。
"""
from __future__ import annotations

import logging

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


def parse_fit_metadata(data: bytes) -> dict | None:
    """解析 FIT 元数据：开始时间 / 运动类型 / 距离 / 总时长 / 坐标点。"""
    if fitparse is None:
        logger.warning("fitparse 未安装，无法解析 FIT 文件（pip install fitparse）")
        return None
    try:
        fit = fitparse.FitFile(data)
        messages = list(fit.get_messages())
    except Exception as exc:  # noqa: BLE001
        logger.error("FIT 解析失败: %s", exc)
        return None

    result: dict = {"start_timestamp": None, "activity_type": None, "distance": None,
                    "duration": None, "coords": []}
    for msg in messages:
        if msg.name == "session":
            for field in msg.fields:
                if field.name == "start_time":
                    result["start_timestamp"] = field.value
                elif field.name == "sport":
                    result["activity_type"] = SPORT_MAP.get(str(field.value), str(field.value))
                elif field.name == "total_elapsed_time":
                    result["duration"] = int(field.value) if field.value else None
                elif field.name == "total_distance" and field.value:
                    result["distance"] = round(field.value / 1000, 2)  # m -> km
        elif msg.name == "record":
            values = msg.get_values()
            lat, lng = values.get("position_lat"), values.get("position_long")
            if lat is not None and lng is not None:
                # FIT 半圆坐标 -> 度
                result["coords"].append((lng * 180 / 2**31, lat * 180 / 2**31))

    return result if result["start_timestamp"] else None


def fit_crc(data: bytes) -> int:
    """FIT CRC16 校验值（CRC-CCITT）。"""
    crc = 0
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if (crc & 0x8000) else (crc << 1)
            crc &= 0xFFFF
    return crc
