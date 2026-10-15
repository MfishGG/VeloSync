"""账号模块回归测试。

覆盖两件此前完全没测、且一旦出错就是「用户数据没删干净」的事：

1. **注销账号的级联删除范围** —— 六张表挂 CASCADE 挂着 User，只要有一处
   `on_delete` 被改成 SET_NULL，数据就会静默留存，而用户以为自己已经删号了。
2. **手机号移除后接口不再泄漏字段** —— 字段删了但序列化器还返回，等于白删。

这两件都属于「错了也不报错、只是安静地做错事」的类别，只能靠测试守住。
"""

from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.activities.models import Activity
from apps.pipelines.models import Pipeline, PipelineRun
from apps.platforms.adapters import StravaAdapter
from apps.platforms.models import PlatformAccount
from apps.platforms.testing import make_platform
from apps.synclogs.models import SyncLog

from .models import SocialAccount, UserProfile

#: 与 views.DELETE_CONFIRM_PHRASE 一致。刻意写死而不是 import ——
#: 改掉确认词就该让测试挂，而不是让测试跟着一起改。
CONFIRM = "注销"

DELETE_URL = "/api/auth/me/"


class DeleteAccountTests(TestCase):
    """DELETE /api/auth/me/ —— 注销账号（不可逆）"""

    def setUp(self):
        self.user = User.objects.create_user(username="velo1", password="pw123456")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _seed_everything(self):
        """给该用户铺满各类关联数据，用于验证级联是否干净。"""
        SocialAccount.objects.create(user=self.user, provider="wechat", openid="o-1")
        UserProfile.objects.create(user=self.user, avatar="data:image/png;base64,AAA")
        platform = make_platform(code="mock")
        PlatformAccount.objects.create(
            user=self.user, platform=platform, platform_user_id="mock-1"
        )
        Activity.objects.create(
            user=self.user, start_timestamp=timezone.now(), source_platform="mock"
        )
        pipeline = Pipeline.objects.create(user=self.user, name="测试任务")
        PipelineRun.objects.create(pipeline=pipeline, status="success")
        SyncLog.objects.create(user=self.user, level="info", message="hi")

    def test_delete_removes_user_and_every_related_row(self):
        self._seed_everything()
        user_pk = self.user.pk

        resp = self.client.delete(DELETE_URL, {"confirm": CONFIRM}, format="json")

        self.assertEqual(resp.status_code, 200)
        self.assertFalse(User.objects.filter(pk=user_pk).exists())
        # 逐表确认 —— 漏掉一张就是「声称删了但没删」
        self.assertEqual(SocialAccount.objects.filter(user_id=user_pk).count(), 0)
        self.assertEqual(UserProfile.objects.filter(user_id=user_pk).count(), 0)
        self.assertEqual(PlatformAccount.objects.filter(user_id=user_pk).count(), 0)
        self.assertEqual(Activity.objects.filter(user_id=user_pk).count(), 0)
        self.assertEqual(Pipeline.objects.filter(user_id=user_pk).count(), 0)
        self.assertEqual(SyncLog.objects.filter(user_id=user_pk).count(), 0)
        # 管道的子表要跟着管道走（PipelineRun / PipelineNode 都挂在 Pipeline 上）
        self.assertEqual(PipelineRun.objects.count(), 0)

    def test_delete_without_confirm_is_rejected(self):
        resp = self.client.delete(DELETE_URL, {}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())

    def test_delete_with_wrong_confirm_is_rejected(self):
        resp = self.client.delete(DELETE_URL, {"confirm": "delete"}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())

    def test_delete_requires_authentication(self):
        resp = APIClient().delete(DELETE_URL, {"confirm": CONFIRM}, format="json")
        self.assertEqual(resp.status_code, 401)
        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())

    def test_delete_leaves_other_users_untouched(self):
        other = User.objects.create_user(username="velo2", password="pw123456")
        Pipeline.objects.create(user=other, name="别人的任务")

        self.client.delete(DELETE_URL, {"confirm": CONFIRM}, format="json")

        self.assertTrue(User.objects.filter(pk=other.pk).exists())
        self.assertEqual(Pipeline.objects.filter(user=other).count(), 1)

    def test_delete_notifies_real_platforms_before_deleting(self):
        """先撤销平台授权，再删本地记录。

        顺序反了就拿不到 token 了 —— 账号行一删，`revoke_token` 就没有凭据可用，
        平台侧的授权会一直留着，用户以为断开了其实没有。
        """
        platform = make_platform(code="strava", name="Strava", auth_type="oauth2")
        PlatformAccount.objects.create(
            user=self.user, platform=platform, platform_user_id="99887766"
        )

        with patch.object(StravaAdapter, "revoke_token", return_value=True) as mocked:
            resp = self.client.delete(DELETE_URL, {"confirm": CONFIRM}, format="json")

        self.assertEqual(resp.status_code, 200)
        mocked.assert_called_once()
        self.assertEqual(resp.json()["revoked_platforms"], 1)

    def test_demo_accounts_are_not_sent_to_the_platform(self):
        """演示身份（mock- / demo- 前缀）不该触发网络请求。"""
        PlatformAccount.objects.create(
            user=self.user, platform=make_platform(code="mock"), platform_user_id="demo-9"
        )

        with patch.object(StravaAdapter, "revoke_token", return_value=True) as mocked:
            resp = self.client.delete(DELETE_URL, {"confirm": CONFIRM}, format="json")

        self.assertEqual(resp.status_code, 200)
        mocked.assert_not_called()
        self.assertEqual(resp.json()["revoked_platforms"], 0)

    def test_platform_revocation_failure_does_not_block_deletion(self):
        """对方接口抽风不该把用户困在应用里 —— 与解绑同一口径。"""
        platform = make_platform(code="strava", name="Strava", auth_type="oauth2")
        PlatformAccount.objects.create(
            user=self.user, platform=platform, platform_user_id="99887766"
        )

        with patch.object(StravaAdapter, "revoke_token", side_effect=RuntimeError("boom")):
            resp = self.client.delete(DELETE_URL, {"confirm": CONFIRM}, format="json")

        self.assertEqual(resp.status_code, 200)
        self.assertFalse(User.objects.filter(pk=self.user.pk).exists())


class PhoneRemovalTests(TestCase):
    """手机号功能移除后，接口不应再出现任何相关字段"""

    def setUp(self):
        self.user = User.objects.create_user(username="velo3", password="pw123456")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_me_does_not_expose_phone_fields(self):
        data = self.client.get("/api/auth/me/").json()
        for key in ("phone", "phone_masked", "phone_bound"):
            self.assertNotIn(key, data)

    def test_phone_endpoint_is_gone(self):
        resp = self.client.post("/api/auth/phone/", {"code": "x"}, format="json")
        self.assertEqual(resp.status_code, 404)

    def test_userprofile_has_no_phone_column(self):
        """字段是真删了，不只是没暴露 —— 否则隐私指引的声明又得加回来。"""
        field_names = {f.name for f in UserProfile._meta.get_fields()}
        self.assertNotIn("phone", field_names)
        self.assertNotIn("phone_bound_at", field_names)
