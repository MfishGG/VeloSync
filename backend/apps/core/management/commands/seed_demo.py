"""创建本地演示数据：python manage.py seed_demo

⚠️ 本命令会创建 `admin / admin123456` 超级管理员弱口令，**只用于本地开发**。
线上 / 提审请用 `seed_demo_account` —— 同样的演示内容，但没有 admin 弱口令。

平台基础数据（mock / igpsport / garmin / strava / coros）**不在本命令里** ——
它在迁移 `platforms/0004_seed_platforms` 中预置，`migrate` 时自动写入。
本命令只负责演示内容，逻辑与 `seed_demo_account` 共用 `apps/core/demo.py`：

- 演示用户 demo / demo123456，管理员 admin / admin123456
- Mock 平台账号 + 30 条近 30 天活动 + 同步状态 + 日志 + 3 条示例任务
"""
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError

from apps.core import demo

#: 本地专用口令。线上演示账号走不可登录口令（见 apps/core/demo.py 的说明）。
LOCAL_DEMO_PASSWORD = "demo123456"
LOCAL_ADMIN_PASSWORD = "admin123456"


class Command(BaseCommand):
    help = "创建 VeloSync 本地演示数据（demo / demo123456，含 admin 弱口令）"

    def handle(self, *args, **options):
        # reset=True：本地反复执行时总是回到一份干净的演示数据
        try:
            user, _created, stats = demo.seed_demo_account(
                password=LOCAL_DEMO_PASSWORD, reset=True
            )
        except demo.DemoDataError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(f"平台就绪，演示数据：{stats}")

        admin, created = User.objects.get_or_create(
            username="admin",
            defaults={"email": "admin@velosync.local", "is_staff": True, "is_superuser": True},
        )
        if created:
            admin.set_password(LOCAL_ADMIN_PASSWORD)
            admin.save()

        self.stdout.write(self.style.SUCCESS("✅ 演示数据创建完成"))
        self.stdout.write(
            f"   登录账号: {user.username} / {LOCAL_DEMO_PASSWORD}（前台）  "
            f"admin / {LOCAL_ADMIN_PASSWORD}（/admin/）"
        )
        self.stdout.write(
            "   本命令含弱口令管理员，**不要在生产库执行**；线上请用 seed_demo_account。"
        )
