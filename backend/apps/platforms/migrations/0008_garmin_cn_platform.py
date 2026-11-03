"""新增佳明中国区平台，并把国际区平台的默认名标上区域。

背景：Garmin 的国际区（connect.garmin.com）与中国区（connect.garmin.cn）是**两套
独立账号体系**，数据不互通（官方 FAQ：跨服务器账号无法互相访问）。只有一个
`garmin` 平台意味着两件事都做不到：界面无法让用户选区域，适配器也没有地方存放
另一套接口地址 —— 而两者的 API 域名不同。

为什么不给 `Platform` 加一个 `region` 字段：`Platform.code` 唯一，一个应用里只能有
一条 `garmin`，加字段也挡不住「同一平台两个域名」的需求。拆成两条平台记录与既有
架构一致（矩阵列、账号卡片、目标账号下拉全都由平台字典驱动），不需要改引擎。

取名规则沿用 0006：只改「名字仍是默认值」的那条，运营在 Admin 里改过的名字说明
是刻意为之，不该被部署覆盖。`api_base` 同理，只在为空时补。
"""
from django.db import migrations

#: 0004 里 garmin 的默认名
DEFAULT_GARMIN_NAME = "Garmin Connect"
GLOBAL_GARMIN_NAME = "Garmin Connect（国际区）"
GLOBAL_API_BASE = "https://connect.garmin.com"

CN_SPEC = {
    "code": "garmin_cn",
    "name": "Garmin Connect（中国区）",
    "auth_type": "oauth2",
    "capabilities": {"fetch": True, "upload": True},
    "app_scheme": "garminconnect://",
    "miniprogram_appid": "",
    # 中国区接口域名，与国际区完全独立
    "api_base": "https://connect.garmin.cn",
}


def add_cn_platform(apps, schema_editor):
    Platform = apps.get_model("platforms", "Platform")
    Platform.objects.get_or_create(code=CN_SPEC["code"], defaults=CN_SPEC)

    garmin = Platform.objects.filter(code="garmin").first()
    if garmin is None:
        return
    if garmin.name == DEFAULT_GARMIN_NAME:
        garmin.name = GLOBAL_GARMIN_NAME
    if not garmin.api_base:
        garmin.api_base = GLOBAL_API_BASE
    garmin.save(update_fields=["name", "api_base"])


def remove_cn_platform(apps, schema_editor):
    Platform = apps.get_model("platforms", "Platform")
    # 有账号绑定时不删：回滚一次迁移不该连同用户的账号一起清掉
    Platform.objects.filter(code=CN_SPEC["code"], accounts__isnull=True).delete()

    garmin = Platform.objects.filter(code="garmin", name=GLOBAL_GARMIN_NAME).first()
    if garmin is not None:
        garmin.name = DEFAULT_GARMIN_NAME
        # 只在仍是我们填的默认值时清空，运营改过就留着
        if garmin.api_base == GLOBAL_API_BASE:
            garmin.api_base = ""
        garmin.save(update_fields=["name", "api_base"])


class Migration(migrations.Migration):
    dependencies = [
        ("platforms", "0007_oauthstate"),
    ]

    operations = [
        migrations.RunPython(add_cn_platform, remove_cn_platform),
    ]
