"""预置平台基础数据。

为什么写在迁移里而不是 management command：
`Platform` 是平台字典，属于系统基础数据。没有它，账号管理页就是一片空白 ——
「可绑定的平台」标题底下什么都没有，用户既不知道能不能绑、也不知道该点哪里。
而此前唯一创建它的途径是 `seed_demo`，那个命令同时会造出
`admin / admin123456` 超级管理员弱口令，**不该在生产库跑**。
于是生产环境的必然结果是：库是空的，页面是空的。

放迁移里的好处是容器启动会自动执行（entrypoint 里有 `migrate --noinput`），
部署完平台就位，不依赖任何人记得手动跑一条命令。

幂等：用 `get_or_create`，**不覆盖**已存在的平台 —— 运营在 Admin 里填过的
client_id / miniprogram_appid 不会被后续每次部署冲掉。

注意这里内联了平台定义而没有 import 应用代码：迁移必须自包含。应用里的
常量会随时间变化，旧迁移若跟着变，就再也无法在历史状态上正确重放。
"""
from django.db import migrations

PLATFORMS = [
    {
        "code": "mock",
        "name": "演示平台 (Mock)",
        "auth_type": "mock",
        "capabilities": {"fetch": True, "upload": True},
        "app_scheme": "",
        "miniprogram_appid": "",
    },
    {
        "code": "igpsport",
        "name": "iGPSPORT",
        "auth_type": "oauth2",
        "capabilities": {"fetch": True, "upload": False},
        # 移动端绑定兜底：把该 scheme 复制到系统浏览器可唤起官方 App
        "app_scheme": "igpsport://",
        # 拿到 iGPSPORT 官方小程序 AppID 后由运营在 Admin 里补填
        "miniprogram_appid": "",
    },
    {
        "code": "garmin",
        "name": "Garmin Connect",
        "auth_type": "oauth2",
        "capabilities": {"fetch": True, "upload": True},
        "app_scheme": "garminconnect://",
        "miniprogram_appid": "",
    },
    {
        "code": "strava",
        "name": "Strava",
        "auth_type": "oauth2",
        "capabilities": {"fetch": True, "upload": True},
        "app_scheme": "strava://",
        "miniprogram_appid": "",
    },
    {
        "code": "coros",
        "name": "COROS",
        "auth_type": "oauth2",
        "capabilities": {"fetch": True, "upload": True},
        "app_scheme": "coros://",
        "miniprogram_appid": "",
    },
]


def create_platforms(apps, schema_editor):
    Platform = apps.get_model("platforms", "Platform")
    for spec in PLATFORMS:
        Platform.objects.get_or_create(code=spec["code"], defaults=spec)


def remove_platforms(apps, schema_editor):
    """回滚时只删「没有任何账号绑定」的预置平台。

    已被用户绑定的平台不删 —— 回滚一次迁移不该顺手删掉用户的账号数据。
    """
    Platform = apps.get_model("platforms", "Platform")
    for spec in PLATFORMS:
        Platform.objects.filter(code=spec["code"], accounts__isnull=True).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("platforms", "0003_alter_platform_auth_type_and_more"),
    ]

    operations = [
        migrations.RunPython(create_platforms, remove_platforms),
    ]
