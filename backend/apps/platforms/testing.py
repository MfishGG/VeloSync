"""测试用的平台构造助手。

平台基础数据由迁移 `platforms/0004_seed_platforms` 预置
（mock / igpsport / garmin / strava / coros），而 `Platform.code` 唯一 ——
测试里若直接 `Platform.objects.create(code="strava")`，会撞上那条预置记录
（IntegrityError: Duplicate entry 'strava'）。所有测试统一走这里。

放在 `testing.py` 而不是 `tests.py`：测试发现器只收集 `tests.py` / `test_*.py`，
叫 testing 就不会被误当成测试模块。
"""
from apps.platforms.models import Platform

def make_platform(code="mock", **fields):
    """按 code 取或建平台，并保证它处于调用方期望的状态。

    用 `update_or_create` 而非 `get_or_create`：调用方传了字段就是要覆盖 ——
    例如测试 Strava 的刷新时要求 `auth_type="oauth2"` 且带 `token_url`，
    而预置的 strava 记录没有这些。
    """
    # 每次新建而非共享一个模块级 dict：capabilities 是可变对象，
    # 复用同一份会在测试之间留下耦合。
    spec = {
        "name": "平台",
        "auth_type": "oauth2",
        "capabilities": {"fetch": True, "upload": True},
        "app_scheme": "",
        "miniprogram_appid": "",
    }
    spec.update(fields)
    platform, _ = Platform.objects.update_or_create(code=code, defaults=spec)
    return platform
