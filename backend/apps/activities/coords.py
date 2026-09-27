"""GCJ-02 ↔ WGS-84 坐标转换（火星坐标纠偏）。

标准偏移算法，误差约 1-2 米，满足轨迹纠偏需求。
国内骑行平台多用 GCJ-02，海外平台使用 WGS-84，上传前需转换。
"""
import math

PI = math.pi
A = 6378245.0  # 长半轴
EE = 0.00669342162296594323  # 扁率


def _transform_lat(x: float, y: float) -> float:
    ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * PI) + 20.0 * math.sin(2.0 * x * PI)) * 2.0 / 3.0
    ret += (20.0 * math.sin(y * PI) + 40.0 * math.sin(y / 3.0 * PI)) * 2.0 / 3.0
    ret += (160.0 * math.sin(y / 12.0 * PI) + 320 * math.sin(y * PI / 30.0)) * 2.0 / 3.0
    return ret


def _transform_lon(x: float, y: float) -> float:
    ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * PI) + 20.0 * math.sin(2.0 * x * PI)) * 2.0 / 3.0
    ret += (20.0 * math.sin(x * PI) + 40.0 * math.sin(x / 3.0 * PI)) * 2.0 / 3.0
    ret += (150.0 * math.sin(x / 12.0 * PI) + 300.0 * math.sin(x / 30.0 * PI)) * 2.0 / 3.0
    return ret


def out_of_china(lng: float, lat: float) -> bool:
    """粗略判断坐标是否在中国大陆范围外（范围外无需纠偏）。"""
    return not (73.66 < lng < 135.05 and 3.86 < lat < 53.55)


def wgs84_to_gcj02(lng: float, lat: float) -> tuple[float, float]:
    if out_of_china(lng, lat):
        return lng, lat
    dlat = _transform_lat(lng - 105.0, lat - 35.0)
    dlng = _transform_lon(lng - 105.0, lat - 35.0)
    radlat = lat / 180.0 * PI
    magic = math.sin(radlat)
    magic = 1 - EE * magic * magic
    sqrtmagic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((A * (1 - EE)) / (magic * sqrtmagic) * PI)
    dlng = (dlng * 180.0) / (A / sqrtmagic * math.cos(radlat) * PI)
    return lng + dlng, lat + dlat


def gcj02_to_wgs84(lng: float, lat: float) -> tuple[float, float]:
    """迭代法逆变换，精度更高。"""
    if out_of_china(lng, lat):
        return lng, lat
    gcj_lng, gcj_lat = lng, lat
    wgs_lng, wgs_lat = lng, lat
    for _ in range(3):
        tmp_lng, tmp_lat = wgs84_to_gcj02(wgs_lng, wgs_lat)
        wgs_lng += lng - tmp_lng
        wgs_lat += lat - tmp_lat
    return wgs_lng, wgs_lat
    # gcj_lng/gcj_lat 保留给调试断言使用
