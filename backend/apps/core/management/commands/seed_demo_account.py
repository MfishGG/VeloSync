"""预置演示账号：python manage.py seed_demo_account

用于线上 / 提审：让审核员或演示对象不必配置任何平台凭证，登录后就能看到完整的
活动、同步任务与日志。

与 `seed_demo` 的区别是**刻意的**：后者会创建 `admin / admin123456` 超级管理员
弱口令，因此绝不能在生产库执行。这条命令按构造就不含那一步 —— 不去依赖使用者
记得加某个 `--no-admin` 开关（那种约定迟早会被忘掉，而后果是生产库多个弱口令
管理员）。本地开发需要 admin 时，仍用 `seed_demo`。

数据由 `apps/core/demo.py` 统一产出，两条命令共用同一份构建逻辑。

    python manage.py seed_demo_account            # 缺失才建（entrypoint 自动调用）
    python manage.py seed_demo_account --reset    # 清空并重建，提审前跑一次
"""
from django.core.management.base import BaseCommand, CommandError

from apps.core import demo


class Command(BaseCommand):
    help = "预置演示账号与演示数据（不含 admin 弱口令，可安全用于线上）"

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="先清空演示账号的全部数据再重建（提审前跑一次，保证数据整洁）",
        )

    def handle(self, *args, **options):
        try:
            user, created, stats = demo.seed_demo_account(reset=options["reset"])
        except demo.DemoDataError as exc:
            # 用 CommandError 而不是静默返回：这一步失败时，页面会表现为
            # 「演示账号没数据」，与成功只差几十行日志，不显式报错根本看不出来。
            raise CommandError(str(exc)) from exc

        if not stats:
            self.stdout.write(
                self.style.WARNING(
                    f"演示数据已存在（账号 {user.username}，"
                    f"{user.activities.count()} 条活动），未做改动。"
                    "如需重建请加 --reset。"
                )
            )
            return

        verb = "创建" if created else "重建"
        self.stdout.write(self.style.SUCCESS(f"✅ 演示账号已{verb}：{user.username}"))
        self.stdout.write(
            "   "
            f"活动 {stats['activities']} · 同步状态 {stats['sync_states']} · "
            f"日志 {stats['logs']} · 任务 {stats['pipelines']} · 平台账号 {stats['accounts']}"
        )
        self.stdout.write(
            "   入口：POST /api/auth/demo/（需 DEMO_MODE=1）。"
            "该账号没有可用口令，只能从这个入口进入 —— 因此不存在可被撞库的弱口令。"
        )
