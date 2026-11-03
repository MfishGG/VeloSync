"""平台 Token 加密 / 刷新 / 撤销 的回归测试。

这几段逻辑此前完全没有测试，而它们恰好是审查中问题最集中的地方：
Token 从不刷新、解密的密钥可能退化成公开值、Strava 的用户 ID 被写成字典字符串。
"""
from datetime import timedelta
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, unquote, urlparse

from django.contrib.auth.models import User
from django.core import signing
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
from .models import OAuthState, Platform, PlatformAccount
from .testing import make_platform
from .tokens import TokenError, ensure_fresh_token, refresh_access_token
from .views import STATE_MAX_AGE


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

    def test_oauth_wins_over_miniprogram(self):
        """凭证齐备时必须走 OAuth。

        跳官方小程序没有回调、拿不到 token，一行都不会落库 —— 它不是绑定。
        此前 appid 优先：凭证刚配好、顺手又填了 appid 的平台会静默退化成
        「点一下就被跳走、什么也没发生」。
        """
        platform = make_platform(
            code="garmin",
            auth_type="oauth2",
            authorize_url="https://example.test/oauth/authorize",
            token_url="https://example.test/oauth/token",
            client_id="cid",
            client_secret="secret",
            miniprogram_appid="wx1234567890abcdef",
        )
        self.assertEqual(platform.mobile_bind_channel, "oauth")

    def test_miniprogram_is_fallback_without_credentials(self):
        platform = make_platform(
            code="garmin",
            auth_type="oauth2",
            miniprogram_appid="wx1234567890abcdef",
        )
        self.assertEqual(platform.mobile_bind_channel, "miniprogram")

    def test_no_credentials_and_no_appid_is_demo(self):
        platform = make_platform(code="garmin", auth_type="oauth2")
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
    """最小化的响应对象：只需要 status_code / json() / text / headers。"""

    def __init__(self, status_code, body=None, text="", headers=None):
        self.status_code = status_code
        self._body = body
        self.text = text
        self.headers = headers or {}

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


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
        # 走小程序发起方：回调直接给结果页（200 + HTML），断言不依赖落点判断。
        # 用 client=web 的话，`back()` 会在「FRONTEND_URL 未配」时改成结果页，
        # 落点规则一变这些与落点无关的用例就得跟着改 —— 别把它们耦合进去。
        resp = self.client.get(f"/api/accounts/{code}/authorize/?client=wx")
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
        self.assertEqual(resp.status_code, 200)
        self.assertIn("绑定成功", resp.content.decode())

        payload = post_json.call_args[0][1]
        # 用同一算法复算，必须与发起授权时给出的 challenge 完全一致
        self.assertEqual(_code_challenge(payload["code_verifier"]), q["code_challenge"][0])

    def test_missing_verifier_is_reported_not_swallowed(self):
        q = self._start_auth()
        nonce = signing.loads(q["state"][0])["nonce"]
        # 只抹掉 verifier，保留那条记录：整条删掉会被「一次性」校验先拦下，
        # 报「已被使用或已过期」，根本走不到 PKCE 这一支。
        OAuthState.objects.filter(nonce=nonce).update(code_verifier="")

        resp = self.client.get(
            f"/api/accounts/garmin/callback/?code=auth-code&state={q['state'][0]}"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("PKCE", resp.content.decode())

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


class OAuthStateOnceOnlyTests(TestCase):
    """state 的一次性由数据库里那一行保证，不再依赖 cache。

    此前 nonce / PKCE verifier 存在 `cache` 里，而默认后端是 LocMemCache ——
    **进程内**缓存，配 gunicorn 多 worker 时「写发生在 A 进程、回调落到 B 进程」
    就读不到，用户看到「该授权链接已被使用或已过期」，看起来像他手慢。
    线上实测 10 次里丢 4 次（40%）。

    换成一张表之后，判断标准只有一个：`DELETE ... WHERE nonce=?` 影响了几行。
    """

    def setUp(self):
        self.user = User.objects.create_user("once", "once@example.test", "pw-12345")
        self.platform = make_platform(
            code="strava",
            auth_type="oauth2",
            authorize_url="https://www.strava.com/oauth/authorize",
            token_url="https://www.strava.com/oauth/token",
            api_base="https://www.strava.com/api/v3",
            client_id="cid",
            client_secret="secret",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _start(self) -> str:
        # 用小程序发起方：回调直接返回结果页，本类验证的是「一次性」，
        # 不该被 back() 的落点规则牵着走。
        resp = self.client.get("/api/accounts/strava/authorize/?client=wx")
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        return resp.json()["state"]

    def _callback(self, state: str):
        return self.client.get(f"/api/accounts/strava/callback/?code=auth-code&state={state}")

    def test_authorize_persists_state_row(self):
        state = self._start()
        nonce = signing.loads(state)["nonce"]
        row = OAuthState.objects.get(nonce=nonce)
        self.assertEqual(row.user_id, self.user.id)
        self.assertEqual(row.platform.code, "strava")
        self.assertEqual(row.client, "wx")

    def test_state_can_only_be_used_once(self):
        state = self._start()
        with patch("apps.platforms.views.post_json") as post_json:
            post_json.return_value = {
                "access_token": "at",
                "expires_in": 3600,
                "athlete": {"id": 902},
            }
            first = self._callback(state)
            second = self._callback(state)

        self.assertEqual(first.status_code, 200)
        self.assertIn("绑定成功", first.content.decode())
        # 重放：同一个 state 不能换出第二个绑定
        self.assertIn("已被使用", second.content.decode())
        self.assertEqual(PlatformAccount.objects.count(), 1)
        self.assertFalse(OAuthState.objects.exists())

    def test_expired_state_is_rejected_even_if_signature_is_fresh(self):
        state = self._start()
        nonce = signing.loads(state)["nonce"]
        OAuthState.objects.filter(nonce=nonce).update(
            created_at=timezone.now() - timedelta(seconds=STATE_MAX_AGE + 60)
        )

        resp = self._callback(state)
        self.assertIn("已过期", resp.content.decode())
        self.assertFalse(PlatformAccount.objects.exists())

    def test_row_decides_which_user_gets_bound(self):
        """签名只证明「是我们签的」；绑给谁以库里的行为准。

        否则一个被拿到手的 state 只要改不了签名就没事，但一旦签名密钥泄漏
        （或同一 key 被别的代码复用），user_id 就成了攻击者可控字段。
        """
        other = User.objects.create_user("other", "other@example.test", "pw-12345")
        OAuthState.objects.create(
            nonce="n-forged", user=other, platform=self.platform, client="web"
        )
        forged = signing.dumps(
            {
                "user_id": self.user.id,
                "platform": "strava",
                "nonce": "n-forged",
                "client": "web",
            }
        )

        resp = self._callback(forged)
        self.assertIn("授权参数无效", resp.content.decode())
        self.assertFalse(PlatformAccount.objects.exists())

    def test_authorize_purges_expired_rows(self):
        OAuthState.objects.create(nonce="stale-row", user=self.user, platform=self.platform)
        OAuthState.objects.filter(nonce="stale-row").update(
            created_at=timezone.now() - timedelta(seconds=STATE_MAX_AGE + 60)
        )

        self._start()

        self.assertFalse(OAuthState.objects.filter(nonce="stale-row").exists())


class CallbackLandingTests(TestCase):
    """OAuth 回调最后停在哪 —— 小程序和 Web 的答案不一样。

    手机上的绑定是「复制链接 → 系统浏览器 → 第三方登录 → 回调」，回调是
    **浏览器**里的最后一页。此前这里无条件重定向到 `FRONTEND_URL`，而它的默认值
    是 `http://localhost:5173`：用户绑成功后浏览器跳去 localhost，看到「拒绝连接」，
    结论是「绑定失败」。账号其实已经绑上了 —— 只是落点错了，且小程序无从得知。
    """

    def setUp(self):
        self.user = User.objects.create_user("landing", "landing@example.test", "pw-12345")
        self.platform = make_platform(
            code="strava",
            auth_type="oauth2",
            authorize_url="https://www.strava.com/oauth/authorize",
            token_url="https://www.strava.com/oauth/token",
            api_base="https://www.strava.com/api/v3",
            client_id="cid",
            client_secret="secret",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _start(self, query=""):
        resp = self.client.get(f"/api/accounts/strava/authorize/{query}")
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        url = resp.json()["authorize_url"]
        return parse_qs(urlparse(url).query)

    def test_client_is_signed_into_state(self):
        from django.core import signing

        q = self._start("?client=wx")
        self.assertEqual(signing.loads(q["state"][0])["client"], "wx")

    def test_invalid_client_is_left_unset(self):
        """非法值不签进 state —— 回调会按环境自行判断，而不是盲信一个乱码。"""
        from django.core import signing

        q = self._start("?client=../evil")
        self.assertEqual(signing.loads(q["state"][0])["client"], "")

    def test_miniprogram_callback_returns_result_page_not_redirect(self):
        q = self._start("?client=wx")
        with patch("apps.platforms.views.post_json") as post_json:
            post_json.return_value = {
                "access_token": "at",
                "refresh_token": "rt",
                "expires_in": 3600,
                "athlete": {"id": 12345678},
            }
            resp = self.client.get(
                f"/api/accounts/strava/callback/?code=auth-code&state={q['state'][0]}"
            )

        # 关键：不是 302。浏览器里没有能回小程序的跳转，只能把结果说清楚。
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/html", resp["Content-Type"])
        body = resp.content.decode()
        self.assertIn("绑定成功", body)
        self.assertIn("回到微信", body)

    @override_settings(DEBUG=True)
    def test_web_callback_still_redirects_to_frontend(self):
        """本机开发：Web 工作台跑在 vite dev server 上，必须跳回 localhost:5173。"""
        q = self._start("?client=web")
        with patch("apps.platforms.views.post_json") as post_json:
            post_json.return_value = {
                "access_token": "at",
                "refresh_token": "rt",
                "expires_in": 3600,
                "athlete": {"id": 12345678},
            }
            resp = self.client.get(
                f"/api/accounts/strava/callback/?code=auth-code&state={q['state'][0]}"
            )
        self.assertEqual(resp.status_code, 302)
        self.assertIn("/accounts?bind=ok", resp["Location"])

    @override_settings(DEBUG=False, FRONTEND_URL="http://localhost:5173")
    def test_web_callback_without_public_frontend_stops_at_result_page(self):
        """生产上 `FRONTEND_URL` 没配时就停在结果页，不要把人扔去 localhost。

        它的默认值就是 `http://localhost:5173`，而 Web 工作台目前没有公网部署。
        302 过去只有一个结果：浏览器「拒绝连接」，用户以为绑定失败 —— 实际账号
        已经绑上了。宁可少一个跳转，也不要给出一个确定打不开的地址。
        """
        q = self._start("?client=web")
        with patch("apps.platforms.views.post_json") as post_json:
            post_json.return_value = {
                "access_token": "at",
                "refresh_token": "rt",
                "expires_in": 3600,
                "athlete": {"id": 12345678},
            }
            resp = self.client.get(
                f"/api/accounts/strava/callback/?code=auth-code&state={q['state'][0]}"
            )

        self.assertEqual(resp.status_code, 200)
        body = resp.content.decode()
        self.assertIn("绑定成功", body)
        # 提示语要按「Web 发起方」写，不能叫一个在电脑前的人「回到微信」
        self.assertIn("工作台", body)
        self.assertNotIn("回到微信", body)

    @override_settings(DEBUG=False, FRONTEND_URL="http://localhost:5173")
    def test_legacy_miniprogram_build_still_gets_result_page(self):
        """后端新、小程序旧（不会传 `?client=wx`）时也不能跳 localhost。

        这是升级窗口期：后端先部署，手机上的小程序还是老包。老包不带 client，
        而生产环境 Web 工作台并没有上线 —— 唯一可能的发起方就是小程序。
        """
        q = self._start()  # 老包的调用方式：不带 client
        with patch("apps.platforms.views.post_json") as post_json:
            post_json.return_value = {
                "access_token": "at",
                "refresh_token": "rt",
                "expires_in": 3600,
                "athlete": {"id": 12345678},
            }
            resp = self.client.get(
                f"/api/accounts/strava/callback/?code=auth-code&state={q['state'][0]}"
            )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("绑定成功", resp.content.decode())

    def test_bad_state_explains_itself_on_result_page(self):
        resp = self.client.get("/api/accounts/strava/callback/?code=x&state=broken")
        # 没有可用的 state 时按 Web 处理（本机开发就是这条路径），
        # 但错误原因必须进 Location，不能被吞掉。
        self.assertIn(resp.status_code, (200, 302))
        text = resp.content.decode() if resp.status_code == 200 else unquote(resp["Location"])
        self.assertIn("state", text.lower())

    def test_technical_failure_detail_goes_to_log_not_to_page(self):
        """结果页是给终端用户看的，平台返回的 URL / HTTP 码 / JSON 不该上屏。"""
        from apps.synclogs.models import SyncLog

        q = self._start("?client=wx")
        raw = 'https://www.strava.com/oauth/token 返回 HTTP 400：{"message":"Bad Request"}'
        with patch("apps.platforms.views.post_json", side_effect=ValueError(raw)):
            resp = self.client.get(
                f"/api/accounts/strava/callback/?code=auth-code&state={q['state'][0]}"
            )

        self.assertEqual(resp.status_code, 200)
        body = resp.content.decode()
        self.assertIn(f"没能完成与 {self.platform.name} 的授权", body)
        self.assertNotIn("oauth/token", body)
        self.assertNotIn("Bad Request", body)

        # 原文必须留在日志里，否则问题就真的查不出来了
        self.assertTrue(
            SyncLog.objects.filter(message__contains="oauth/token").exists(),
            "技术原因被丢掉了：结果页不展示是对的，但日志里必须留着",
        )


# ============ 佳明账号密码渠道 ============
#
# 这条链路完全依赖佳明自家的移动端登录接口（非公开），所以测试的重点不是
# 「佳明现在返回什么」，而是我们这一侧的契约：
#   - 每一步失败都要能指出卡在哪；
#   - 密码绝不落库、不进日志、不进异常信息；
#   - 二次验证的中间态必须能跨请求续上（库里，不是内存）。

import re

from . import garmin_sso
from .adapters import ActivityExists, AdapterError, GarminAdapter
from .models import PendingLogin


class _FakeSsoSession:
    """假装是 requests.Session：login/verify_mfa 只用到 cookies / get / post。"""

    def __init__(self, get_responses=None, post_responses=None):
        from requests.utils import cookiejar_from_dict

        self.cookies = cookiejar_from_dict({})
        self.get_responses = list(get_responses or [])
        self.post_responses = list(post_responses or [])
        self.get_calls = []
        self.post_calls = []

    def get(self, url, **kwargs):
        self.get_calls.append((url, kwargs))
        return self.get_responses.pop(0)

    def post(self, url, **kwargs):
        self.post_calls.append((url, kwargs))
        return self.post_responses.pop(0)


OAUTH1_OK = _FakeResp(200, None, text="oauth_token=ot&oauth_token_secret=os")
OAUTH2_OK = _FakeResp(
    200, {"access_token": "at", "refresh_token": "rt", "expires_in": 3600}
)


class GarminSsoTests(TestCase):
    def test_successful_login_returns_both_tokens(self):
        session = _FakeSsoSession(
            get_responses=[_FakeResp(200), OAUTH1_OK],
            post_responses=[
                _FakeResp(
                    200,
                    {"responseStatus": {"type": "SUCCESSFUL"}, "serviceTicketId": "ST-1"},
                )
            ],
        )
        with patch("apps.platforms.garmin_sso._consumer", return_value=("ck", "cs")):
            with patch(
                "apps.platforms.garmin_sso.requests.post", return_value=OAUTH2_OK
            ) as post:
                oauth1, oauth2 = garmin_sso.login("a@b.c", "pw-123", "garmin.com", session)

        self.assertEqual(oauth1["oauth_token"], "ot")
        self.assertEqual(oauth1["domain"], "garmin.com")
        self.assertEqual(oauth2["access_token"], "at")
        # 首次登录必须带 audience，刷新时不能带 —— 带错只会得到 401
        self.assertEqual(post.call_args.kwargs["data"]["audience"], "GARMIN_CONNECT_MOBILE_ANDROID_DI")

    def test_mfa_required_hands_back_state_for_second_step(self):
        session = _FakeSsoSession(
            get_responses=[_FakeResp(200)],
            post_responses=[
                _FakeResp(
                    200,
                    {
                        "responseStatus": {"type": "MFA_REQUIRED"},
                        "customerMfaInfo": {"mfaLastMethodUsed": "sms"},
                    },
                )
            ],
        )
        with self.assertRaises(garmin_sso.MfaRequired) as ctx:
            garmin_sso.login("a@b.c", "pw-123", "garmin.com", session)

        self.assertEqual(ctx.exception.method, "sms")
        state = ctx.exception.state
        self.assertEqual(state["domain"], "garmin.com")
        self.assertIn("login_params", state)
        self.assertIn("cookies", state, "没有 cookie，验证码那一步就续不上同一个会话")

    def test_verify_mfa_finishes_login(self):
        session = _FakeSsoSession(
            get_responses=[OAUTH1_OK],
            post_responses=[
                _FakeResp(
                    200,
                    {"responseStatus": {"type": "SUCCESSFUL"}, "serviceTicketId": "ST-2"},
                )
            ],
        )
        state = {"domain": "garmin.com", "login_params": {}, "cookies": {}, "mfa_method": "sms"}
        with patch("apps.platforms.garmin_sso._session_with_cookies", return_value=session):
            with patch("apps.platforms.garmin_sso._consumer", return_value=("ck", "cs")):
                with patch("apps.platforms.garmin_sso.requests.post", return_value=OAUTH2_OK):
                    _, oauth2 = garmin_sso.verify_mfa(state, "123456")

        self.assertEqual(oauth2["access_token"], "at")
        self.assertEqual(session.post_calls[0][1]["json"]["mfaMethod"], "sms")

    def test_wrong_password_message_is_actionable(self):
        session = _FakeSsoSession(
            get_responses=[_FakeResp(200)],
            post_responses=[
                _FakeResp(
                    200,
                    {"responseStatus": {"type": "INCORRECT_CREDENTIALS", "message": "bad"}},
                )
            ],
        )
        with self.assertRaises(garmin_sso.GarminError) as ctx:
            garmin_sso.login("a@b.c", "pw-123", "garmin.com", session)

        self.assertEqual(ctx.exception.step, "login")
        self.assertIn("账号和密码", str(ctx.exception))
        self.assertNotIn("pw-123", str(ctx.exception), "密码绝不能进异常信息")

    def test_rate_limit_explains_waiting(self):
        session = _FakeSsoSession(get_responses=[_FakeResp(200)], post_responses=[_FakeResp(429)])
        with self.assertRaises(garmin_sso.GarminError) as ctx:
            garmin_sso.login("a@b.c", "pw-123", "garmin.com", session)
        self.assertIn("限流", str(ctx.exception))
        self.assertIn("1 小时", str(ctx.exception))

    def test_html_response_is_reported_as_risk_control(self):
        session = _FakeSsoSession(
            get_responses=[_FakeResp(200)],
            post_responses=[_FakeResp(200, None, text="<html>blocked</html>")],
        )
        with self.assertRaises(garmin_sso.GarminError) as ctx:
            garmin_sso.login("a@b.c", "pw-123", "garmin.com", session)
        self.assertIn("网页", str(ctx.exception))

    def test_china_domain_is_used_end_to_end(self):
        session = _FakeSsoSession(
            get_responses=[_FakeResp(200), OAUTH1_OK],
            post_responses=[
                _FakeResp(
                    200,
                    {"responseStatus": {"type": "SUCCESSFUL"}, "serviceTicketId": "ST-3"},
                )
            ],
        )
        with patch("apps.platforms.garmin_sso._consumer", return_value=("ck", "cs")):
            with patch("apps.platforms.garmin_sso.requests.post", return_value=OAUTH2_OK):
                oauth1, _ = garmin_sso.login("a@b.cn", "pw", "garmin.cn", session)

        self.assertEqual(oauth1["domain"], "garmin.cn")
        self.assertIn("sso.garmin.cn", session.post_calls[0][0])


class OAuth1SignatureTests(TestCase):
    URL = "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0"

    def _header(self, body):
        with patch("apps.platforms.garmin_sso._consumer", return_value=("ck", "cs")):
            with patch("apps.platforms.garmin_sso.time.time", return_value=1700000000):
                with patch("apps.platforms.garmin_sso.secrets.token_hex", return_value="n0nce"):
                    return garmin_sso._oauth1_header(
                        "POST", self.URL, token="ot", token_secret="os", body=body
                    )

    def test_header_shape(self):
        header = self._header({"audience": "GARMIN_CONNECT_MOBILE_ANDROID_DI"})
        self.assertTrue(header.startswith("OAuth "))
        self.assertIn('oauth_signature_method="HMAC-SHA1"', header)
        self.assertIn('oauth_token="ot"', header)
        self.assertIn("oauth_signature=", header)

    def test_body_params_are_part_of_the_signature(self):
        """表单体参数不进签名基串的话，佳明会回 401，而错误完全指不回这里。"""
        with_audience = self._header({"audience": "X"})
        without = self._header({})
        self.assertNotEqual(
            re.search(r'oauth_signature="([^"]+)"', with_audience).group(1),
            re.search(r'oauth_signature="([^"]+)"', without).group(1),
        )


class GarminUploadTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("rider9", "r9@example.test", "pw-12345")
        self.platform = make_platform(
            "garmin",
            name="Garmin Connect（国际区）",
            auth_type="password",
            api_base="https://connect.garmin.com",
        )
        self.account = PlatformAccount.objects.create(
            user=self.user, platform=self.platform, platform_user_id="42"
        )
        self.account.set_tokens("at-1", "", expires_in=3600)
        self.account.set_session(
            {"oauth1": {"oauth_token": "ot", "oauth_token_secret": "os", "domain": "garmin.com"}}
        )
        self.account.save()

    def _adapter(self):
        return GarminAdapter(self.account)

    def _ok(self, internal_id=987):
        return _FakeResp(
            200,
            {"detailedImportResult": {"successes": [{"internalId": internal_id}], "failures": []}},
        )

    @patch("apps.platforms.adapters.requests.post")
    def test_tcx_is_uploaded_with_tcx_extension(self, post):
        post.return_value = self._ok()
        xml = '<?xml version="1.0"?><TrainingCenterDatabase></TrainingCenterDatabase>'.encode()

        self.assertEqual(self._adapter().upload_fit(xml, name="晨骑"), "987")
        filename = post.call_args.kwargs["files"]["file"][0]
        # 后缀决定了佳明按哪种格式解析：TCX 被当成 fit 只会得到一句「格式不支持」
        self.assertTrue(filename.endswith(".tcx"), filename)

    @patch("apps.platforms.adapters.requests.post")
    def test_fit_keeps_fit_extension(self, post):
        post.return_value = self._ok(555)
        self.assertEqual(self._adapter().upload_fit(b"\x0e\x10\xd9\x07FIT", name="ride"), "555")
        self.assertTrue(post.call_args.kwargs["files"]["file"][0].endswith(".fit"))

    @patch("apps.platforms.adapters.requests.post")
    def test_duplicate_is_not_a_failure(self, post):
        post.return_value = _FakeResp(409, {"error": "Duplicate activity"})
        with self.assertRaises(ActivityExists):
            self._adapter().upload_fit(b"\x0e\x10FIT")

    @patch("apps.platforms.adapters.requests.post")
    def test_401_refreshes_with_oauth1_and_retries(self, post):
        post.side_effect = [_FakeResp(401), self._ok(777)]
        with patch(
            "apps.platforms.adapters.garmin_sso.refresh",
            return_value={"access_token": "at-2", "expires_in": 3600},
        ) as refresh:
            self.assertEqual(self._adapter().upload_fit(b"\x0e\x10FIT"), "777")

        refresh.assert_called_once()
        self.assertEqual(post.call_count, 2)
        self.account.refresh_from_db()
        self.assertEqual(self.account.get_access_token(), "at-2", "刷新后的令牌必须落库")

    def test_missing_session_credential_is_explicit(self):
        self.account.set_tokens("", "", expires_in=0)
        self.account.clear_session()
        self.account.token_expires_at = timezone.now() - timedelta(hours=1)
        self.account.save()

        with self.assertRaises(AdapterError) as ctx:
            self._adapter().upload_fit(b"\x0e\x10FIT")
        self.assertIn("重新绑定", str(ctx.exception))

    def test_failure_message_from_garmin_is_surfaced(self):
        with patch("apps.platforms.adapters.requests.post") as post:
            post.return_value = _FakeResp(
                200,
                {
                    "detailedImportResult": {
                        "successes": [],
                        "failures": [
                            {"messages": [{"content": "The file is not a valid activity file."}]}
                        ],
                    }
                },
            )
            with self.assertRaises(AdapterError) as ctx:
                self._adapter().upload_fit(b"\x0e\x10FIT")
        self.assertIn("not a valid activity file", str(ctx.exception))


class PasswordBindTests(TestCase):
    TOKENS = (
        {"oauth_token": "ot", "oauth_token_secret": "os", "domain": "garmin.com"},
        {"access_token": "at", "refresh_token": "rt", "expires_in": 3600},
    )

    def setUp(self):
        self.user = User.objects.create_user("rider7", "r7@example.test", "pw-12345")
        self.platform = make_platform(
            "garmin",
            name="Garmin Connect（国际区）",
            auth_type="password",
            api_base="https://connect.garmin.com",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    @patch("apps.platforms.views.garmin_sso.profile", return_value={"profileId": 42, "displayName": "小鱼"})
    @patch("apps.platforms.views.garmin_sso.login", return_value=TOKENS)
    def test_bind_creates_account_and_drops_password(self, login, profile):
        res = self.client.post(
            "/api/accounts/garmin/bind-password/",
            {"username": "a@b.c", "password": "secret-pw"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)

        account = PlatformAccount.objects.get(user=self.user, platform=self.platform)
        self.assertEqual(account.platform_user_id, "42")
        self.assertEqual(account.display_name, "小鱼")
        self.assertEqual(account.get_access_token(), "at")
        self.assertEqual(account.get_session()["oauth1"]["oauth_token"], "ot")

        # 密码只在请求里出现这一次：不入库、不进会话字段
        self.assertNotIn("secret-pw", account.session_data)
        self.assertNotIn("password", account.get_session())

    @patch("apps.platforms.views.garmin_sso.profile", return_value={"profileId": 42})
    @patch("apps.platforms.views.garmin_sso.login")
    def test_mfa_is_a_two_step_bind(self, login, profile):
        login.side_effect = garmin_sso.MfaRequired(
            {"domain": "garmin.com", "login_params": {}, "cookies": {"SESSION": "x"}}, "email"
        )
        res = self.client.post(
            "/api/accounts/garmin/bind-password/",
            {"username": "a@b.c", "password": "pw"},
            format="json",
        )
        self.assertEqual(res.status_code, 202, res.data)
        self.assertTrue(res.data["needs_mfa"])
        pending_id = res.data["pending_id"]
        self.assertTrue(PendingLogin.objects.filter(id=pending_id).exists())

        with patch(
            "apps.platforms.views.garmin_sso.verify_mfa", return_value=self.TOKENS
        ) as verify:
            res = self.client.post(
                "/api/accounts/garmin/bind-password/mfa/",
                {"pending_id": pending_id, "code": "123456"},
                format="json",
            )
        self.assertEqual(res.status_code, 201, res.data)
        verify.assert_called_once()
        self.assertFalse(PendingLogin.objects.filter(id=pending_id).exists(), "用完必须删掉")
        self.assertTrue(
            PlatformAccount.objects.filter(user=self.user, platform=self.platform).exists()
        )

    @patch("apps.platforms.views.garmin_sso.login")
    def test_wrong_code_keeps_pending_for_retry(self, login):
        login.side_effect = garmin_sso.MfaRequired(
            {"domain": "garmin.com", "login_params": {}, "cookies": {}}, "email"
        )
        res = self.client.post(
            "/api/accounts/garmin/bind-password/", {"username": "a@b.c", "password": "pw"}, format="json"
        )
        pending_id = res.data["pending_id"]

        with patch(
            "apps.platforms.views.garmin_sso.verify_mfa",
            side_effect=garmin_sso.GarminError("mfa", "验证码不正确或已过期，请重新获取后再试"),
        ):
            res = self.client.post(
                "/api/accounts/garmin/bind-password/mfa/",
                {"pending_id": pending_id, "code": "000000"},
                format="json",
            )
        self.assertEqual(res.status_code, 400)
        self.assertIn("验证码", res.data["detail"])
        self.assertTrue(
            PendingLogin.objects.filter(id=pending_id).exists(),
            "输错一位验证码就要求重填密码，体验上完全说不通",
        )

    @patch("apps.platforms.views.garmin_sso.login")
    def test_platform_failure_is_logged_and_reported(self, login):
        from apps.synclogs.models import SyncLog

        login.side_effect = garmin_sso.GarminError("login", "登录未通过，请确认账号和密码是否正确")
        res = self.client.post(
            "/api/accounts/garmin/bind-password/",
            {"username": "a@b.c", "password": "pw"},
            format="json",
        )
        self.assertEqual(res.status_code, 502)
        self.assertIn("账号和密码", res.data["detail"])
        self.assertTrue(SyncLog.objects.filter(level="error").exists())

    def test_oauth_platform_rejects_password_bind(self):
        make_platform("strava", auth_type="oauth2")
        res = self.client.post(
            "/api/accounts/strava/bind-password/",
            {"username": "a", "password": "b"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("授权", res.data["detail"])

    @patch("apps.platforms.views.garmin_sso.login")
    def test_authorize_view_points_password_platform_to_the_form(self, login):
        res = self.client.get("/api/accounts/garmin/authorize/?client=wx")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["code"], "use_password_bind")

    def test_password_platform_needs_no_oauth_credentials(self):
        """密码渠道不该因为「缺少 client_id」被判成未就绪 —— 那会把它推回演示身份。"""
        self.assertTrue(self.platform.oauth_ready)
        self.assertEqual(self.platform.mobile_bind_channel, "password")
