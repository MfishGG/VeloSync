"""生成一个合规的样例 FIT 活动文件。

用途：手上没有真实码表/Garmin 导出的 .fit 时，用它造一份可解析的样本，
验证 FIT 解析链路与前端展示（数据为程序合成的模拟骑行）。

用法：
    python tools/make_sample_fit.py [输出路径] [采样点数]
默认输出 tools/sample_ride.fit，采样 120 点。
"""

from __future__ import annotations

import math
import struct
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fitparse.profile import MESSAGE_TYPES  # type: ignore

FIT_EPOCH = 631065600  # 1989-12-31 00:00:00 UTC
SEMICIRCLE = 2**31 / 180.0

RECORD_BASE_FIELDS = [
    "timestamp",
    "position_lat",
    "position_long",
    "altitude",
    "heart_rate",
    "cadence",
    "distance",
    "speed",
    "power",
]
# 以下为"预留模块"字段：真实设备未必全写，这里一并造出来供前端图表验证；
# with_extra=False 时只写基础字段，用于验证「无数据 → 空白图位」的表现
RECORD_EXTRA_FIELDS = [
    "grade",
    "calories",
    "left_torque_effectiveness",
    "combined_pedal_smoothness",
    "accumulated_power",
    "saturated_hemoglobin_percent",
    "vertical_oscillation",
    "stance_time",
    "step_length",
]

RECORD_FIELDS = RECORD_BASE_FIELDS + RECORD_EXTRA_FIELDS
SESSION_FIELDS = [
    "timestamp",
    "start_time",
    "sport",
    "total_elapsed_time",
    "total_timer_time",
    "total_distance",
    "total_cycles",
    "total_calories",
    "avg_speed",
    "max_speed",
    "avg_heart_rate",
    "max_heart_rate",
    "avg_cadence",
    "max_cadence",
    "avg_power",
    "max_power",
    "total_ascent",
    "total_descent",
]
FILE_ID_FIELDS = ["type", "manufacturer", "product", "serial_number", "time_created"]


def _fields(msg_num: int, names: list[str]) -> list[tuple[int, object]]:
    """返回 [(字段编号, Field)] —— FIT profile 里字段编号是 fields 字典的 key"""
    table = MESSAGE_TYPES[msg_num].fields
    lookup = {f.name: num for num, f in table.items()}
    return [(lookup[name], next(f for f in table.values() if f.name == name)) for name in names]


def _base(f):
    """字段的底层 BaseType：普通字段即本身，date_time 等特殊类型需取 base_type"""
    return getattr(f.type, "base_type", f.type)


def _definition(local_id: int, msg_num: int, fields) -> bytes:
    # 定义消息：header(1) + reserved(1) + architecture(1) + global_msg_num(2, LE) + 字段数(1)
    payload = struct.pack("<BBBHB", 0x40 | local_id, 0, 0, msg_num, len(fields))
    for num, f in fields:
        bt = _base(f)
        # 用 identifier（规范字节，如 date_time=0x86）而非内部编号
        payload += struct.pack("<BBB", num, bt.size, bt.identifier)
    return payload


def _data(local_id: int, fields, values: dict) -> bytes:
    payload = struct.pack("<B", local_id)
    for _num, f in fields:
        value = values.get(f.name, 0)
        bt = _base(f)
        try:
            payload += struct.pack("<" + bt.fmt, value)
        except struct.error as exc:
            raise ValueError(
                f"字段 {f.name} 值 {value} 超出类型 {bt.name}(fmt={bt.fmt}) 范围"
            ) from exc
    return payload


def _crc(data: bytes) -> int:
    """FIT 规范用的是反射 CRC-16（poly 0x8408），这里直接复用 fitparse 的实现确保一致"""
    from fitparse.records import Crc  # 局部导入：仅生成样例时使用

    return Crc(byte_arr=data).value


def build_sample(count: int = 120, start: datetime | None = None, with_extra: bool = True) -> bytes:
    """合成一段模拟骑行：心率 / 功率 / 踏频 / 速度 / 海拔 / GPS 均随时间变化"""
    start = start or datetime(2026, 10, 7, 6, 30, tzinfo=timezone.utc)
    start_fit = int(start.timestamp()) - FIT_EPOCH

    rec_fields = _fields(20, RECORD_FIELDS if with_extra else RECORD_BASE_FIELDS)
    ses_fields = _fields(18, SESSION_FIELDS)
    fid_fields = _fields(0, FILE_ID_FIELDS)

    body = _definition(0, 0, fid_fields)
    body += _data(
        0,
        fid_fields,
        {"type": 4, "manufacturer": 1, "product": 3113, "serial_number": 3412345678, "time_created": start_fit},
    )

    body += _definition(1, 20, rec_fields)

    lat0, lng0 = 30.2500, 120.1500
    distance_m = 0.0
    altitude = 12.0
    hearts, powers, cads, speeds, alts = [], [], [], [], []

    for i in range(count):
        t = i
        # 速度 8~11 m/s 波动，心率随强度爬升，功率与速度相关
        speed = 9.5 + 1.5 * math.sin(i / 9.0) + 0.3 * math.sin(i / 2.3)
        heart = 118 + int(34 * (i / max(count - 1, 1))) + int(4 * math.sin(i / 3.0))
        power = max(60, 150 + int(90 * (speed - 8.0)) + int(18 * math.sin(i / 5.0)))
        cadence = 78 + int(8 * math.sin(i / 4.0))
        distance_m += speed
        altitude += 0.35 * math.sin(i / 11.0) + 0.05

        lat = lat0 + i * 0.00012
        lng = lng0 + i * 0.00016 + 0.00004 * math.sin(i / 7.0)

        hearts.append(heart)
        powers.append(power)
        cads.append(cadence)
        speeds.append(speed)
        alts.append(altitude)

        # 进阶指标：温度随爬升略降、坡度取海拔变化率、扭矩效率/平顺度小幅波动
        temperature = 24 + int(3 * math.sin(i / 17.0))
        grade_pct = 6.0 * math.sin(i / 11.0)
        calories = int(i * 0.16)
        torque_eff = int(min(99, 62 + 6 * math.sin(i / 6.0)))
        smoothness = int(min(99, 28 + 5 * math.sin(i / 8.0)))
        smo2 = int(min(99, 68 + 7 * math.sin(i / 13.0)))

        body += _data(
            1,
            rec_fields,
            {
                "timestamp": start_fit + t,
                "position_lat": int(round(lat * SEMICIRCLE)),
                "position_long": int(round(lng * SEMICIRCLE)),
                "altitude": int(round((altitude + 500) * 5)),
                "heart_rate": heart,
                "cadence": cadence,
                "distance": int(round(distance_m * 100)),
                "speed": int(round(speed * 1000)),
                "power": power,
                "temperature": temperature,
                "grade": int(round(grade_pct * 100)),  # scale 100
                "calories": calories,
                "left_torque_effectiveness": int(round(torque_eff * 2)),  # scale 2
                "combined_pedal_smoothness": int(round(smoothness * 2)),  # scale 2
                "accumulated_power": int(power * (i + 1)),
                "saturated_hemoglobin_percent": int(round(smo2 * 10)),  # scale 10
                "vertical_oscillation": int(round((7.5 + 0.4 * math.sin(i / 5.0)) * 10)),  # mm, scale 10
                "stance_time": int(round((240 + 8 * math.sin(i / 7.0)) * 10)),  # ms, scale 10
                "step_length": int(round((950 + 20 * math.sin(i / 9.0)) * 10)),  # mm, scale 10
            },
        )

    body += _definition(2, 18, ses_fields)
    ascent = int(sum(max(alts[i + 1] - alts[i], 0) for i in range(len(alts) - 1)))
    descent = int(sum(max(alts[i] - alts[i + 1], 0) for i in range(len(alts) - 1)))
    body += _data(
        2,
        ses_fields,
        {
            "timestamp": start_fit + count,
            "start_time": start_fit,
            "sport": 2,  # cycling
            "total_elapsed_time": int(count * 1000),
            "total_timer_time": int(count * 1000),
            "total_distance": int(round(distance_m * 100)),
            "total_cycles": int(sum(cads) / 60),
            "total_calories": int(count * 11.5),
            "avg_speed": int(round(sum(speeds) / len(speeds) * 1000)),
            "max_speed": int(round(max(speeds) * 1000)),
            "avg_heart_rate": int(sum(hearts) / len(hearts)),
            "max_heart_rate": max(hearts),
            "avg_cadence": int(sum(cads) / len(cads)),
            "max_cadence": max(cads),
            "avg_power": int(sum(powers) / len(powers)),
            "max_power": max(powers),
            "total_ascent": ascent,
            "total_descent": descent,
        },
    )

    # ".FIT" 在小端 uint32 中写作 0x5449462E
    header_wo_crc = struct.pack("<BBHII", 14, 0x10, 0x0804, len(body), 0x5449462E)
    header_crc = _crc(header_wo_crc)
    header = header_wo_crc + struct.pack("<H", header_crc)
    blob = header + body
    return blob + struct.pack("<H", _crc(blob))


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("sample_ride.fit")
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 120
    with_extra = not (len(sys.argv) > 3 and sys.argv[3] == "basic")
    data = build_sample(count, with_extra=with_extra)
    out.write_bytes(data)
    kind = "含全部预留字段" if with_extra else "仅基础字段"
    print(f"已生成 {out}（{len(data)} 字节，{count} 个采样点，{kind}）")


if __name__ == "__main__":
    main()
