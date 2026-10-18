"""平台 Token 加密 / 刷新 / 撤销 的回归测试。

这几段逻辑此前完全没有测试，而它们恰好是审查中问题最集中的地方：
Token 从不刷新、解密的密钥可能退化成公开值、Strava 的用户 ID 被写成字典字符串。
"""
from datetime import timedelta
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

from django.contrib.auth.models import User
from django.core.cache import cache
from django.db import connection
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .crypto import (
    CURRENT_KEY_VERSION,
    TokenDecryptError,
    decrypt,
    encrypt,
    key_source,
)
from .models import Platform, PlatformAccount
from .testing import make_platform
from .tokens import TokenError, ensure_fresh_token, refresh_access_token


class CryptoTests(TestCase):
    def test_roundtrip(self):
        self.assertEqual(decrypt(encrypt("hello")), "hello")

    def test_ciphertext_carries_version_prefix(self):
        """密文必须带版本前缀，否则换密钥时无法分辨「旧密文」与「坏数据」。"""
        token = encrypt("hello")
        self.assertTrue(token.startswith(f"{CURRENT_KEY_VERSION}:"))

    def test_empty_value_is_empty_string(self):
        self.assertEqual(encrypt(""), "")
        self.assertEqual(decrypt(""), "")

    def test_legacy_ciphertext_without_prefix_still_decrypts(self):
        """历史数据没有前缀（早期版本就是当前密钥加密的），必须仍能解开。"""
        legacy = encrypt("hello").split(":", 1)[1]
        self.assertEqual(decrypt(legacy), "hello")

    @override_settings(TOKEN_ENCRYPTION_KEY="")
    def test_key_source_derived_when_unset(self):
        self.assertEqual(key_source(), "derived")

    def test_wrong_key_raises_instead_of_returning_empty(self):
        """解密失败必须抛异常。静默返回空串会把「换过密钥」伪装成「用户没授权」。"""
        import apps.platforms.crypto as crypto
        from cryptography.fernet import Fernet

        token = encrypt("secret-value")
        original = crypto._fernet_instance
        try:
            crypto._fernet_instance = Fernet(Fernet.generate_key())  # 模拟密钥被更换
            with self.assertRaises(TokenDecryptError):
                decrypt(token)
        finally:
            crypto._fernet_instance = original


class SeededPlatformsTests(TestCase):
    """迁移 0004_seed_platforms 必须把平台基础数据预置好。

    守的是一个具体的失败现场：平台此前唯一的创建途径是 seed_demo，而那个命令
    会造 admin/admin123456 弱口令、不能在生产跑 —— 于是线上库是空的，
    账号管理页「可绑定的平台」下面什么都没有，用户既绑不了也看不出原因。
    这条测试保证「迁移跑完就有平台可绑」。
    """

    def test_platforms_are_seeded(self):
        codes = set(Platform.objects.values_list("code", flat=True))
        self.assertTrue(
            {"mock", "igpsport", "garmin", "strava", "coros"} <= codes,
            f"预置平台缺失，当前只有：{sorted(codes)}",
        )

    def test_seeded_platforms_are_active(self):
        """接口走的是 filter(is_active=True)，预置数据必须落在可见的那一侧。"""
        self.assertEqual(
            Platform.objects.filter(is_active=True).count(),
            Platform.objects.count(),
            "预置平台必须 is_active=True，否则接口不返回、页面照样是空的",
        )


class CredentialReadinessTests(TestCase):
    """`oauth_ready` 必须把 client_secret 算进去。

    少了它会出现最难查的一种状态：界面显示「可以授权」，用户也真的走完了平台授权，
    但换 access_token 时被平台拒（invalid_client），而我们这边的日志只看到平台报错。
    所以这里锁死「缺 secret 就不许说 ready」。
    """

    def test_missing_client_secret_is_not_ready(self):
        platform = make_platform(
            code="strava",
            auth_type="oauth2",
            authorize_url="https://example.test/oauth/authorize",
            token_url="https://example.test/oauth/token",
            client_id="cid",
            client_secret="",
        )
        self.assertFalse(platform.oauth_ready)
        self.assertIn("client_secret", platform.oauth_missing)

    def test_all_four_present_is_ready(self):
        platform = make_platform(
            code="strava",
            auth_type="oauth2",
            authorize_url="https://example.test/oauth/authorize",
            token_url="https://example.test/oauth/token",
            client_id="cid",
            client_secret="secret",
        )
        self.assertTrue(platform.oauth_ready)
        self.assertEqual(platform.oauth_missing, [])

    def test_mock_platform_needs_nothing(self):
        platform = make_platform(code="mock", auth_type="mock")
        self.assertTrue(platform.oauth_ready)
        self.assertEqual(platform.oauth_missing, [])

    def test_mock_channel_is_demo_not_oauth(self):
        """演示平台不走 OAuth。它的 oauth_missing 恒空，容易被误判成 "oauth"。"""
        platform = make_platform(code="mock", auth_type="mock")
        self.assertEqual(platform.mobile_bind_channel, "demo")


class EncryptedFieldTests(TestCase):
    def test_client_secret_is_encrypted_at_rest(self):
        platform = make_platform("strava", name="Strava", client_secret="s3cr3t")
        platform.refresh_from_db()
        # 通过 ORM 读出来是明文
        self.assertEqual(platform.client_secret, "s3cr3t")
        # 但库里存的必须是密文 —— 注意 `.values_list()` 也会走 from_db_value，
        # 所以这里必须绕过 ORM 直接读原始列，否则测的是解密结果而不是落盘内容。
        with connection.cursor() as cursor:
            cursor.execute("SELECT client_secret FROM platforms_platform WHERE id = %s", [platform.pk])
            raw = cursor.fetchone()[0]
        self.assertNotEqual(raw, "s3cr3t")
        self.assertNotIn("s3cr3t", raw)
        self.assertTrue(raw.startswith(f"{CURRENT_KEY_VERSION}:"))

    def test_legacy_plaintext_row_is_readable(self):
        """历史明文记录仍要能读出来（首次保存时自动转密文），否则升级即炸。"""
        platform = make_platform("garmin", name="Garmin", client_secret="")
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE platforms_platform SET client_secret = %s WHERE id = %s",
                ["legacy-plain", platform.pk],
            )
        platform.refresh_from_db()
        self.assertEqual(platform.client_secret, "legacy-plain")


class TokenRefreshTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("rider", password="x")
        self.platform = make_platform(
            "strava",
            name="Strava",
            auth_type="oauth2",
            token_url="https://example.test/oauth/token",
            client_id="cid",
            client_secret="secret",
        )
        self.account = PlatformAccount.objects.create(
            user=self.user, platform=self.platform, platform_user_id="12345"
        )
        self.account.set_tokens("old-access", "old-refresh", expires_in=21600)
        self.account.save()

    def test_set_tokens_records_expiry(self):
        """token_expires_at 必须落库，否则永远不知道何时该刷新。"""
        self.assertIsNotNone(self.account.token_expires_at)
        self.assertFalse(self.account.is_expiring)

    def test_expired_account_is_detected(self):
        self.account.token_expires_at = timezone.now() - timedelta(minutes=1)
        self.account.save(update_fields=["token_expires_at"])
        self.assertTrue(self.account.is_expiring)

    def test_refresh_rotates_refresh_token(self):
        """Strava 每次刷新都会轮换 refresh token，旧的立即失效 —— 必须写回。"""
        payload = {
            "access_token": "new-access",
            "refresh_token": "new-refresh",
            "expires_in": 21600,
        }
        with patch("apps.platforms.tokens.post_json", return_value=payload) as call:
            self.assertTrue(refresh_access_token(self.account))

        self.account.refresh_from_db()
        self.assertEqual(self.account.get_access_token(), "new-access")
        self.assertEqual(self.account.get_refresh_token(), "new-refresh")
        self.assertEqual(self.account.status, "active")
        self.assertIsNotNone(self.account.token_expires_at)
        self.assertIn("grant_type", call.call_args[0][1])
        self.assertEqual(call.call_args[0][1]["grant_type"], "refresh_token")

    def test_refresh_keeps_old_refresh_token_when_not_returned(self):
        payload = {"access_token": "new-access", "expires_in": 3600}
        with patch("apps.platforms.tokens.post_json", return_value=payload):
            refresh_access_token(self.account)
        self.account.refresh_from_db()
        self.assertEqual(self.account.get_refresh_token(), "old-refresh")

    def test_invalid_grant_marks_account_revoked(self):
        with patch(
            "apps.platforms.tokens.post_json",
            return_value={"error": "invalid_grant", "error_description": "expired"},
        ):
            with self.assertRaises(TokenError):
                refresh_access_token(self.account)
        self.account.refresh_from_db()
        self.assertEqual(self.account.status, "revoked")

    def test_missing_refresh_token_marks_expired(self):
        self.account.refresh_token = ""
        self.account.save(update_fields=["refresh_token"])
        with self.assertRaises(TokenError):
            refresh_access_token(self.account)
        self.account.refresh_from_db()
        self.assertEqual(self.account.status, "expired")

    def test_ensure_fresh_token_skips_when_not_expiring(self):
        with patch("apps.platforms.tokens.refresh_access_token") as refresh:
            ensure_fresh_token(self.account)
        refresh.assert_not_called()

    def test_ensure_fresh_token_refreshes_when_expiring(self):
        self.account.token_expires_at = timezone.now() - timedelta(minutes=1)
        self.account.save(update_fields=["token_expires_at"])
        with patch("apps.platforms.tokens.refresh_access_token") as refresh:
            ensure_fresh_token(self.account)
        refresh.assert_called_once()

    def test_demo_account_is_never_refreshed(self):
        """演示账号的 Token 由我们自己签发，没有刷新端点，硬刷只会报错。"""
        demo = PlatformAccount.objects.create(
            user=self.user,
            platform=self.platform,
            platform_user_id="demo-strava-1",
            token_expires_at=timezone.now() - timedelta(days=1),
        )
        with patch("apps.platforms.tokens.refresh_access_token") as refresh:
            ensure_fresh_token(demo)
        refresh.assert_not_called()


class PlatformUserIdTests(TestCase):
    """P2-1：Strava 的 athlete 是对象，不能直接 str() —— 那会存进一串 Python 字典字面量。"""

    def test_athlete_object_yields_id(self):
        from .views import _platform_user_id

        data = {
            "access_token": "a",
            "athlete": {"id": 12345678, "username": "rider", "firstname": "John"},
        }
        self.assertEqual(_platform_user_id(data, 1), "12345678")

    def test_flat_user_id_is_used(self):
        from .views import _platform_user_id

        self.assertEqual(_platform_user_id({"user_id": "u-9"}, 1), "u-9")

    def test_fallback_when_nothing_present(self):
        from .views import _platform_user_id

        self.assertEqual(_platform_user_id({}, 42), "oauth-42")


class _FakeResp:
    """最小化的响应对象：只需要 status_code / json() / text。"""

    def __init__(self, status_code, body=None, text=""):
        self.status_code = status_code
        self._body = body
        self.text = text

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body


class StravaUploadTests(TestCase):
    """Strava 的 uploads 是异步的：POST 拿 upload id，轮询才知道结果。

    这里锁住的关键点是「别把 upload id 当活动 ID 返回」—— 两个都是数字，
    看起来一样，但后者才是后续比对/引用要用的东西。
    """

    def setUp(self):
        self.user = User.objects.create_user("rider", "rider@example.test", "pw-12345")
        self.platform = make_platform(
            code="strava",
            auth_type="oauth2",
            api_base="https://www.strava.com/api/v3",
            authorize_url="https://example.test/oauth/authorize",
            token_url="https://example.test/oauth/token",
            client_id="cid",
            client_secret="secret",
        )
        self.account = PlatformAccount.objects.create(
            user=self.user, platform=self.platform, platform_user_id="12345678"
        )
        self.account.set_tokens("access-token")
        self.account.token_expires_at = timezone.now() + timedelta(hours=1)
        self.account.save()

    def _adapter(self):
        from .adapters import StravaAdapter

        return StravaAdapter(self.account)

    @patch("apps.platforms.adapters.requests.get")
    @patch("apps.platforms.adapters.requests.post")
    def test_returns_activity_id_not_upload_id(self, post, get):
        post.return_value = _FakeResp(201, {"id": 900, "activity_id": None})
        get.return_value = _FakeResp(200, {"id": 900, "activity_id": 555, "error": None})

        self.assertEqual(self._adapter().upload_fit(b"FITBYTES", name="晨骑"), "555")

    @patch("apps.platforms.adapters.requests.post")
    def test_parse_error_is_reported(self, post):
        from .adapters import AdapterError

        post.return_value = _FakeResp(201, {"id": 901, "errors": ["bad"]})
        with patch("apps.platforms.adapters.requests.get") as get:
            get.return_value = _FakeResp(200, {"id": 901, "error": "Bad file format"})
            with self.assertRaises(AdapterError) as ctx:
                self._adapter().upload_fit(b"NOTFIT")
        self.assertIn("解析 FIT 失败", str(ctx.exception))
        self.assertIn("Bad file format", str(ctx.exception))

    @patch("apps.platforms.adapters.requests.post")
    def test_forbidden_points_at_missing_scope(self, post):
        from .adapters import AdapterError

        post.return_value = _FakeResp(403, {"message": "Authorization Error"})
        with self.assertRaises(AdapterError) as ctx:
            self._adapter().upload_fit(b"FIT")
        self.assertIn("activity:write", str(ctx.exception))

    @patch("apps.platforms.adapters.requests.post")
    def test_html_error_page_does_not_crash(self, post):
        from .adapters import AdapterError

        post.return_value = _FakeResp(502, None, text="<html>Bad Gateway</html>")
        with self.assertRaises(AdapterError) as ctx:
            self._adapter().upload_fit(b"FIT")
        self.assertIn("502", str(ctx.exception))

    @patch("apps.platforms.adapters.requests.post")
    def test_poll_timeout_is_explicit(self, post):
        from .adapters import AdapterError

        post.return_value = _FakeResp(201, {"id": 902})
        with patch("apps.platforms.adapters.time.monotonic", side_effect=[0, 100]):
            with self.assertRaises(AdapterError) as ctx:
                self._adapter().upload_fit(b"FIT")
        self.assertIn("超时", str(ctx.exception))


class PkceFlowTests(TestCase):
    """Garmin 强制 PKCE：授权要带 code_challenge，换 token 要带 code_verifier。

    这两半必须成对 —— 只改一半的表现是「授权页正常，回调时报 invalid_grant」，
    而 invalid_grant 通常被当成「授权码过期」，排查方向直接跑偏。
    """

    def setUp(self):
        self.user = User.objects.create_user("pkce", "pkce@example.test", "pw-12345")
        self.platform = make_platform(
            code="garmin",
            auth_type="oauth2",
            requires_pkce=True,
            authorize_url="https://connect.garmin.com/oauth2Confirm",
            token_url="https://diauth.garmin.com/di-oauth2-service/oauth/token",
            api_base="https://apis.garmin.com/wellness-api/rest",
            client_id="cid",
            client_secret="secret",
            scopes=["ACTIVITY_EXPORT"],
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _start_auth(self, code="garmin"):
        resp = self.client.get(f"/api/accounts/{code}/authorize/")
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        url = resp.json()["authorize_url"]
        return parse_qs(urlparse(url).query)

    def test_authorize_includes_s256_challenge(self):
        q = self._start_auth()
        self.assertEqual(q["code_challenge_method"][0], "S256")
        challenge = q["code_challenge"][0]
        # RFC 7636 的 base64url(sha256(...)) 是 43 个字符且无 padding
        self.assertEqual(len(challenge), 43)
        self.assertNotIn("=", challenge)

    def test_callback_sends_matching_verifier(self):
        from .views import _code_challenge

        q = self._start_auth()
        with patch("apps.platforms.views.post_json") as post_json:
            post_json.return_value = {
                "access_token": "at",
                "refresh_token": "rt",
                "expires_in": 3600,
                "user_id": "garmin-user",
            }
            resp = self.client.get(
                f"/api/accounts/garmin/callback/?code=auth-code&state={q['state'][0]}"
            )
        self.assertEqual(resp.status_code, 302)

        payload = post_json.call_args[0][1]
        # 用同一算法复算，必须与发起授权时给出的 challenge 完全一致
        self.assertEqual(_code_challenge(payload["code_verifier"]), q["code_challenge"][0])

    def test_missing_verifier_is_reported_not_swallowed(self):
        from django.core import signing

        from .views import _PKCE_KEY

        q = self._start_auth()
        nonce = signing.loads(q["state"][0])["nonce"]
        cache.delete(_PKCE_KEY.format(nonce))  # 模拟缓存过期 / 被清

        resp = self.client.get(
            f"/api/accounts/garmin/callback/?code=auth-code&state={q['state'][0]}"
        )
        self.assertEqual(resp.status_code, 302)
        self.assertIn("PKCE", resp["Location"])

    def test_platform_without_pkce_has_no_challenge(self):
        make_platform(
            code="strava",
            auth_type="oauth2",
            requires_pkce=False,
            authorize_url="https://www.strava.com/oauth/authorize",
            token_url="https://www.strava.com/oauth/token",
            api_base="https://www.strava.com/api/v3",
            client_id="cid",
            client_secret="secret",
        )
        q = self._start_auth("strava")
        self.assertNotIn("code_challenge", q)
        self.assertNotIn("code_challenge_method", q)
