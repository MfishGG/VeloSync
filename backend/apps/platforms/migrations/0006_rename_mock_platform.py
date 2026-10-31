"""把演示平台的展示名里的「(Mock)」去掉。

`(Mock)` 是开发者口径，可它直接上了屏：活动矩阵的表头、仪表盘的「最近同步」、
账号管理页都会原样显示这个 `Platform.name`。对终端用户（以及提审时的审核员）
来说，它既解释不了任何东西，又暗示「这条数据是假的」—— 与本项目「开发者信息
一律不上屏」的原则相冲突。

只改「名字仍是 0004 里那串默认值」的那一条：运营若在 Admin 里改成过别的名字，
说明那是刻意为之，不该被一次部署覆盖回默认。反向迁移同理，只在名字仍是
「演示平台」时改回去。
"""
from django.db import migrations

DEFAULT_NAME = "演示平台 (Mock)"
CLEAN_NAME = "演示平台"


def strip_mock_suffix(apps, schema_editor):
    Platform = apps.get_model("platforms", "Platform")
    Platform.objects.filter(code="mock", name=DEFAULT_NAME).update(name=CLEAN_NAME)


def restore_mock_suffix(apps, schema_editor):
    Platform = apps.get_model("platforms", "Platform")
    Platform.objects.filter(code="mock", name=CLEAN_NAME).update(name=DEFAULT_NAME)


class Migration(migrations.Migration):
    dependencies = [
        ("platforms", "0005_platform_requires_pkce"),
    ]

    operations = [
        migrations.RunPython(strip_mock_suffix, restore_mock_suffix),
    ]
