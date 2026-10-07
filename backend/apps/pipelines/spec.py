"""同步任务规格注册表（数据来源 / 同步内容 / 时间范围 / 同步选项）。

这里是「同步任务」的唯一事实来源：后端引擎按此校验入参，前端向导按此渲染选项，
新增一种数据来源或同步内容只需在此登记，无需改动引擎与页面。
"""
from __future__ import annotations

# ---------------------------------------------------------------- 数据来源

SOURCE_SPECS: list[dict] = [
    {
        "code": "fit",
        "label": "FIT 文件 / 本地记录",
        "desc": "已在「FIT 解析」中导入的运动记录，按文件内记录的时间范围同步",
        "need_account": False,
        "kind": "file",
        "time_modes": ["file", "custom"],
        "time_note": "FIT 只能在其自身记录的时间范围内选择，超出部分会被自动夹紧",
    },
    {
        "code": "igpsport",
        "label": "iGPSPORT",
        "desc": "从 iGPSPORT 账号拉取骑行记录、课程与路线",
        "need_account": True,
        "kind": "platform",
        "time_modes": ["all", "recent", "custom"],
        "time_note": "可按最近 N 天或自定义区间拉取",
    },
    {
        "code": "garmin",
        "label": "Garmin 佳明",
        "desc": "从 Garmin Connect 拉取运动记录、体重、睡眠、训练课程与路线",
        "need_account": True,
        "kind": "platform",
        "time_modes": ["all", "recent", "custom"],
        "time_note": "可按最近 N 天或自定义区间拉取",
    },
    {
        "code": "strava",
        "label": "Strava",
        "desc": "从 Strava 拉取运动记录、路线、赛段与装备",
        "need_account": True,
        "kind": "platform",
        "time_modes": ["all", "recent", "custom"],
        "time_note": "可按最近 N 天或自定义区间拉取",
    },
    {
        "code": "coros",
        "label": "COROS 高驰",
        "desc": "从 COROS 账号拉取运动记录、训练计划、体重与睡眠",
        "need_account": True,
        "kind": "platform",
        "time_modes": ["all", "recent", "custom"],
        "time_note": "可按最近 N 天或自定义区间拉取",
    },
    {
        "code": "mock",
        "label": "演示账号",
        "desc": "内置伪随机数据，用于在没有真实凭证时完整跑通同步链路",
        "need_account": True,
        "kind": "platform",
        "time_modes": ["all", "recent", "custom"],
        "time_note": "可按最近 N 天或自定义区间拉取",
    },
]

SOURCE_CODES = [s["code"] for s in SOURCE_SPECS]
SOURCE_MAP = {s["code"]: s for s in SOURCE_SPECS}

# ---------------------------------------------------------------- 同步内容

#: 与运动记录无关、由账号直接同步的内容（个人资料 / 课程 / 路线 / 体重 / 睡眠 …）
NON_ACTIVITY_CONTENTS = {
    "profile",
    "course",
    "route",
    "weight",
    "sleep",
    "health",
    "gear",
    "workout",
    "segment",
    "pr",
}

CONTENT_SPECS: dict[str, list[dict]] = {
    # ---------------- FIT 文件：可同步的就是文件里记录的各类数据 ----------------
    "fit": [
        {
            "key": "activity",
            "label": "运动记录",
            "desc": "活动主体：名称、类型、开始时间、时长、距离",
            "default": True,
            "implemented": True,
        },
        {
            "key": "summary",
            "label": "汇总指标",
            "desc": "平均/最大心率、功率、踏频、爬升、卡路里等 session 汇总",
            "default": True,
            "implemented": True,
        },
        {
            "key": "samples",
            "label": "采样点（曲线数据）",
            "desc": "逐秒采样序列：心率、功率、踏频、速度、海拔等全部指标",
            "default": True,
            "implemented": True,
        },
        {
            "key": "track",
            "label": "GPS 轨迹",
            "desc": "完整轨迹点位（受坐标纠偏选项影响）",
            "default": True,
            "implemented": True,
        },
        {
            "key": "device",
            "label": "设备信息",
            "desc": "码表/手表厂商、型号、序列号与固件时间",
            "default": False,
            "implemented": True,
        },
        {
            "key": "laps",
            "label": "分段 / 圈数据",
            "desc": "Lap 统计（预留，FIT 无 lap 消息时为空）",
            "default": False,
            "implemented": False,
        },
    ],
    # ---------------- 平台账号 ----------------
    "igpsport": [
        {"key": "activity", "label": "运动记录", "desc": "骑行/跑步等活动主体与 FIT 原始文件", "default": True},
        {"key": "profile", "label": "个人资料", "desc": "昵称、性别、生日、身高体重等基础档案", "default": False},
        {"key": "course", "label": "训练课程", "desc": "码表上可执行的训练课程（预留）", "default": False},
        {"key": "route", "label": "路线", "desc": "规划好的骑行路线与导航点（预留）", "default": False},
        {"key": "device", "label": "设备绑定", "desc": "已绑定的码表与传感器（预留）", "default": False},
        {"key": "gear", "label": "装备 / 车辆", "desc": "自行车与装备里程（预留）", "default": False},
    ],
    "garmin": [
        {"key": "activity", "label": "运动记录", "desc": "活动主体与 FIT 原始文件", "default": True},
        {"key": "profile", "label": "个人资料", "desc": "昵称、性别、身高、时区等基础档案", "default": False},
        {"key": "course", "label": "训练课程", "desc": "Garmin Connect 中的 Courses（预留）", "default": False},
        {"key": "route", "label": "路线", "desc": "Courses / Routes 路线数据（预留）", "default": False},
        {"key": "weight", "label": "体重", "desc": "体重秤/手动录入的体重时间序列", "default": False},
        {"key": "sleep", "label": "睡眠数据", "desc": "睡眠时长、深睡/浅睡/REM 分期", "default": False},
        {"key": "health", "label": "日常健康", "desc": "步数、静息心率、压力、血氧、呼吸（预留）", "default": False},
        {"key": "workout", "label": "训练计划", "desc": "Scheduled Workouts 训练日程（预留）", "default": False},
        {"key": "gear", "label": "装备 / 车辆", "desc": "Gear 与累计里程（预留）", "default": False},
        {"key": "pr", "label": "个人纪录", "desc": "Personal Records 最佳成绩（预留）", "default": False},
    ],
    "strava": [
        {"key": "activity", "label": "运动记录", "desc": "活动主体与 FIT/TCX 原始文件", "default": True},
        {"key": "profile", "label": "个人资料", "desc": "昵称、性别、体重、简介", "default": False},
        {"key": "route", "label": "路线", "desc": "Strava Routes 路线数据（预留）", "default": False},
        {"key": "segment", "label": "赛段", "desc": "Segments 与 starred segment（预留）", "default": False},
        {"key": "gear", "label": "装备 / 车辆", "desc": "Gear 与累计里程（预留）", "default": False},
    ],
    "coros": [
        {"key": "activity", "label": "运动记录", "desc": "活动主体与 FIT 原始文件", "default": True},
        {"key": "profile", "label": "个人资料", "desc": "昵称、性别、身高体重（预留）", "default": False},
        {"key": "course", "label": "训练课程", "desc": "训练课程与路线（预留）", "default": False},
        {"key": "route", "label": "路线", "desc": "导航路线（预留）", "default": False},
        {"key": "weight", "label": "体重", "desc": "体重记录（预留）", "default": False},
        {"key": "sleep", "label": "睡眠数据", "desc": "睡眠时长与分期（预留）", "default": False},
        {"key": "health", "label": "日常健康", "desc": "静息心率、步数、血氧（预留）", "default": False},
        {"key": "workout", "label": "训练计划", "desc": "训练日程（预留）", "default": False},
    ],
    "mock": [
        {"key": "activity", "label": "运动记录", "desc": "演示活动（伪随机生成）", "default": True},
        {"key": "profile", "label": "个人资料", "desc": "演示档案", "default": False},
        {"key": "course", "label": "训练课程", "desc": "演示课程", "default": False},
        {"key": "route", "label": "路线", "desc": "演示路线", "default": False},
        {"key": "weight", "label": "体重", "desc": "演示体重序列", "default": False},
        {"key": "sleep", "label": "睡眠数据", "desc": "演示睡眠分期", "default": False},
        {"key": "health", "label": "日常健康", "desc": "演示步数/静息心率", "default": False},
        {"key": "workout", "label": "训练计划", "desc": "演示训练日程", "default": False},
    ],
}

#: 未显式声明的项按「是否已实现」兜底：演示账号全支持，其余平台目前仅运动记录可跑通
for _src, _items in CONTENT_SPECS.items():
    for _c in _items:
        _c.setdefault("implemented", _src == "mock" or _c["key"] == "activity")

#: 内容 → 中文名（日志与展示用）
CONTENT_LABELS: dict[str, str] = {}
for _items in CONTENT_SPECS.values():
    for _c in _items:
        CONTENT_LABELS.setdefault(_c["key"], _c["label"])

# ---------------------------------------------------------------- 同步选项

OPTION_SPECS: list[dict] = [
    {
        "key": "coord_fix",
        "label": "坐标纠偏（WGS-84 → GCJ-02）",
        "desc": "FIT 记录的是 WGS-84 原始坐标，国内平台/地图使用 GCJ-02，同步前自动纠偏",
        "type": "bool",
        "default": True,
        "applies_to": ["track"],
    },
    {
        "key": "dedup",
        "label": "智能去重",
        "desc": "按开始时间 ±5s 窗口与 FIT 文件哈希识别重复记录，避免同一条运动重复同步",
        "type": "bool",
        "default": True,
        "applies_to": ["activity"],
    },
    {
        "key": "conflict",
        "label": "冲突策略",
        "desc": "目标账号已存在同一条记录时的处理方式",
        "type": "choice",
        "choices": [
            {"value": "skip", "label": "跳过（保留目标侧已有数据）"},
            {"value": "overwrite", "label": "覆盖（以本次来源为准）"},
            {"value": "duplicate", "label": "仍然创建副本"},
        ],
        "default": "skip",
        "applies_to": ["activity"],
    },
    {
        "key": "only_gps",
        "label": "仅同步含 GPS 的记录",
        "desc": "过滤掉没有轨迹点的室内/台骑行记录",
        "type": "bool",
        "default": False,
        "applies_to": ["activity"],
    },
    {
        "key": "max_track_points",
        "label": "轨迹点上限",
        "desc": "单条记录的轨迹点数上限，超出后按等距抽稀（与 FIT 解析一致，最大 30000）",
        "type": "int",
        "default": 30000,
        "min": 500,
        "max": 30000,
        "applies_to": ["track"],
    },
    {
        "key": "write_back",
        "label": "回填远端 ID 并更新同步矩阵",
        "desc": "同步成功后把目标平台返回的活动 ID 写回，矩阵单元格转为「已同步」",
        "type": "bool",
        "default": True,
        "applies_to": ["activity"],
    },
    {
        "key": "stop_on_error",
        "label": "遇到失败立即中止",
        "desc": "默认跳过失败项继续执行其余内容，勾选后首个错误即终止任务",
        "type": "bool",
        "default": False,
        "applies_to": ["*"],
    },
    {
        "key": "dry_run",
        "label": "试运行（只预览不写入）",
        "desc": "统计将要同步的内容与数量，不向目标账号写入任何数据",
        "type": "bool",
        "default": False,
        "applies_to": ["*"],
    },
]

OPTION_MAP = {o["key"]: o for o in OPTION_SPECS}

#: 时间范围模式
TIME_MODE_SPECS = [
    {"code": "file", "label": "文件完整范围", "desc": "使用 FIT 文件自身记录的起止时间"},
    {"code": "all", "label": "全部时间", "desc": "不限时间，同步账号内所有数据"},
    {"code": "recent", "label": "最近 N 天", "desc": "相对当前时间向前回溯 N 天"},
    {"code": "custom", "label": "自定义区间", "desc": "手动指定开始与结束时间"},
]

DEFAULT_TIME_RANGE = {"mode": "file", "start": None, "end": None, "days": 30}


def default_contents(source_type: str) -> list[str]:
    """某来源默认勾选的同步内容。"""
    items = CONTENT_SPECS.get(source_type) or CONTENT_SPECS["mock"]
    return [c["key"] for c in items if c.get("default")]


def default_options() -> dict:
    return {o["key"]: o["default"] for o in OPTION_SPECS}


def normalize_contents(source_type: str, contents: list[str] | None) -> list[str]:
    """过滤掉该来源不支持的内容键，保持注册表顺序。"""
    allowed = [c["key"] for c in (CONTENT_SPECS.get(source_type) or [])]
    if not contents:
        return default_contents(source_type)
    return [k for k in allowed if k in set(contents)] or default_contents(source_type)


def normalize_options(options: dict | None) -> dict:
    """用缺省值补全未提供的选项，并剔除未知键。"""
    base = default_options()
    for key, value in (options or {}).items():
        if key in base:
            base[key] = value
    return base


def normalize_time_range(source_type: str, time_range: dict | None) -> dict:
    """按来源类型校正时间范围模式：FIT 只允许 file / custom。"""
    spec = SOURCE_MAP.get(source_type) or SOURCE_MAP["fit"]
    merged = dict(DEFAULT_TIME_RANGE)
    merged.update({k: v for k, v in (time_range or {}).items() if k in merged})
    if merged["mode"] not in spec["time_modes"]:
        merged["mode"] = spec["time_modes"][0]
    if merged["mode"] == "recent":
        try:
            merged["days"] = max(1, min(3650, int(merged.get("days") or 30)))
        except (TypeError, ValueError):
            merged["days"] = 30
    return merged


def option_applies(option_key: str, contents: list[str]) -> bool:
    """选项是否与当前勾选的内容相关（用于前端置灰无关选项）。"""
    spec = OPTION_MAP.get(option_key)
    if not spec:
        return False
    applies = spec.get("applies_to") or ["*"]
    if "*" in applies:
        return True
    return any(c in applies for c in contents)


def content_label(key: str) -> str:
    return CONTENT_LABELS.get(key, key)


def source_label(code: str) -> str:
    spec = SOURCE_MAP.get(code)
    return spec["label"] if spec else code
