"""健康检查与 API 文档的暴露面测试（审查 P1-2 / P1-3）。"""
from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import Client, TestCase, override_settings

from apps.activities.models import Activity
from apps.core import demo
from apps.platforms.models import Platform
from apps.pipelines.models import Pipeline


@override_settings(HEALTH_DETAIL_TOKEN="s3cret-health")
class HealthTests(TestCase):
    def test_anonymous_request_does_not_leak_infrastructure(self):
        """这个接口是匿名的，不该把内网 IP / 库名 / 账号 / 版本吐给任何人。"""
        res = self.client.get("/api/health/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"status": "ok", "database": "ok"})

    def test_wrong_token_does_not_unlock_details(self):
        res = self.client.get("/api/health/", HTTP_X_HEALTH_TOKEN="guess")
        self.assertNotIn("config", res.json())

    def test_correct_token_returns_details(self):
        res = self.client.get("/api/health/", HTTP_X_HEALTH_TOKEN="s3cret-health")
        self.assertIn("config", res.json())

    @override_settings(DEBUG=True)
    def test_debug_mode_allows_details(self):
        res = self.client.get("/api/health/")
        self.assertIn("config", res.json())

    @override_settings(DEBUG=False, HEALTH_DETAIL_TOKEN="")
    def test_no_token_configured_means_no_details(self):
        res = self.client.get("/api/health/")
        self.assertNotIn("config", res.json())


class ApiDocsExposureTests(TestCase):
    """drf-spectacular 的 Schema/Swagger 视图默认 AllowAny，会绕过全局 IsAuthenticated。"""

    def test_schema_requires_admin(self):
        self.assertIn(self.client.get("/api/schema/").status_code, (401, 403))

    def test_docs_requires_admin(self):
        self.assertIn(self.client.get("/api/docs/").status_code, (401, 403))

    def test_admin_user_can_read_schema(self):
        user = User.objects.create_superuser("boss", "boss@example.test", "pw-12345")
        client = Client()
        client.force_login(user)
        self.assertEqual(client.get("/api/schema/").status_code, 200)


class DemoModeTests(TestCase):
    """演示模式：提审 / 对外演示的一键入口。

    这些断言守的是「审核员点进去能看到东西」这件事 —— 失败时页面并不会报错，
    只会是空的，而那恰恰是要靠测试才能提前发现的一类问题。
    """

    def test_get_reports_enabled_state(self):
        res = self.client.get("/api/auth/demo/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["enabled"])

    @override_settings(DEMO_MODE=False)
    def test_get_reports_disabled_state(self):
        """关闭时也要能问出来 —— 否则前端只能靠「点了报错」推断，体验很差。"""
        res = self.client.get("/api/auth/demo/")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["enabled"])

    def test_post_returns_token_and_builds_demo_data(self):
        res = self.client.post("/api/auth/demo/")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body["demo"])
        self.assertTrue(body["access"])

        user = demo.demo_user()
        self.assertIsNotNone(user)
        # 三样都要有：审核员会分别打开工作台、活动列表、日志/矩阵页
        self.assertGreater(Activity.objects.filter(user=user).count(), 0)
        self.assertGreater(Pipeline.objects.filter(user=user).count(), 0)

    def test_demo_account_has_no_usable_password(self):
        """演示账号不能同时是一条账密登录路径。

        若它带着 `demo123456` 这种口令，`/api/auth/login/` 上就凭空多出一个
        可被撞库的弱口令账号 —— 演示入口没必要连带把这条门也打开。
        """
        self.client.post("/api/auth/demo/")
        self.assertFalse(demo.demo_user().has_usable_password())

        res = self.client.post(
            "/api/auth/login/",
            {"username": "demo", "password": "demo123456"},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 400)

    def test_second_login_does_not_duplicate_data(self):
        """入口不重置数据 —— 两位访客同时在线上时，重置会让对方页面突然变样。"""
        self.client.post("/api/auth/demo/")
        user = demo.demo_user()
        before = Activity.objects.filter(user=user).count()
        self.client.post("/api/auth/demo/")
        self.assertEqual(Activity.objects.filter(user=user).count(), before)

    @override_settings(DEMO_MODE=False)
    def test_disabled_mode_returns_404(self):
        self.assertEqual(self.client.post("/api/auth/demo/").status_code, 404)

    def test_missing_demo_account_is_recreated(self):
        """演示账号可能被误删（页面上就有「注销账号」入口），入口不能因此报错。"""
        self.client.post("/api/auth/demo/")
        User.objects.filter(username=demo.demo_username()).delete()
        self.assertIsNone(demo.demo_user())

        res = self.client.post("/api/auth/demo/")
        self.assertEqual(res.status_code, 200)
        recreated = demo.demo_user()
        self.assertIsNotNone(recreated)
        self.assertGreater(Activity.objects.filter(user=recreated).count(), 0)


class SeedDemoAccountCommandTests(TestCase):
    """`seed_demo_account` 是给线上 / 提审用的，它必须比 seed_demo 更保守。"""

    def test_command_is_idempotent(self):
        """entrypoint 每次容器启动都会调它，不能每次部署就重建一遍数据。"""
        call_command("seed_demo_account")
        user = demo.demo_user()
        count = Activity.objects.filter(user=user).count()
        call_command("seed_demo_account")
        self.assertEqual(Activity.objects.filter(user=user).count(), count)

    def test_command_never_creates_superuser(self):
        """按构造就不能造出 admin 弱口令 —— 不靠「记得别加某个开关」来保证。"""
        call_command("seed_demo_account")
        self.assertFalse(User.objects.filter(is_superuser=True).exists())

    def test_reset_rebuilds_content(self):
        call_command("seed_demo_account")
        user = demo.demo_user()
        Pipeline.objects.filter(user=user).delete()
        call_command("seed_demo_account", reset=True)
        self.assertGreater(Pipeline.objects.filter(user=user).count(), 0)

    def test_missing_platforms_raises_instead_of_silently_partial(self):
        """平台字典缺失时必须报错。安静地只建一部分，页面上只会显得「数据少」。"""
        Platform.objects.all().delete()
        with self.assertRaises(CommandError):
            call_command("seed_demo_account")
