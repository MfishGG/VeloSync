"""活动导出的回归测试（原始 FIT 下载）。"""
from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Activity, ActivityFitFile


class ExportFitTests(TestCase):
    """导出必须吐**原始字节**。

    用解析结果重建 TCX/GPX 是个看起来更「通用」的方案，但 track 没有时间戳、
    samples 是降采样的，重建出来的文件导回任何平台都基本不可用。所以这里锁死
    「内容与存入时逐字节相同」。
    """

    def setUp(self):
        self.user = User.objects.create_user("exporter", "e@example.test", "pw-12345")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.activity = Activity.objects.create(
            user=self.user,
            name="晨骑",
            start_timestamp=timezone.now(),
            source_platform="fit",
        )

    def _url(self):
        return f"/api/activities/{self.activity.id}/export-fit/"

    def test_returns_original_bytes(self):
        ActivityFitFile.objects.create(activity=self.activity, data=b"FIT-BYTES", size=9)

        resp = self.client.get(self._url())

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content, b"FIT-BYTES")
        self.assertIn("attachment", resp["Content-Disposition"])
        # 活动名可能是中文，必须走 RFC 5987 的 filename*
        self.assertIn("filename*=UTF-8''", resp["Content-Disposition"])

    def test_missing_file_is_explicit(self):
        resp = self.client.get(self._url())
        self.assertEqual(resp.status_code, 409)
        self.assertIn("原始 FIT", resp.json()["detail"])

    def test_other_users_activity_is_not_reachable(self):
        ActivityFitFile.objects.create(activity=self.activity, data=b"X", size=1)
        other = User.objects.create_user("other", "o@example.test", "pw-12345")
        c = APIClient()
        c.force_authenticate(user=other)

        self.assertEqual(c.get(self._url()).status_code, 404)
