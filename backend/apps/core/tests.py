"""健康检查与 API 文档的暴露面测试（审查 P1-2 / P1-3）。"""
from django.contrib.auth.models import User
from django.test import Client, TestCase, override_settings


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
