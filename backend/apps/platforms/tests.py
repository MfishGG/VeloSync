"""平台 Token 加密 / 刷新 / 撤销 的回归测试。

这几段逻辑此前完全没有测试，而它们恰好是审查中问题最集中的地方：
Token 从不刷新、解密的密钥可能退化成公开值、Strava 的用户 ID 被写成字典字符串。
"""
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import connection
from django.test import TestCase, override_settings
from django.utils import timezone

from .crypto import (
    CURRENT_KEY_VERSION,
    TokenDecryptError,
    decrypt,
    encrypt,
    key_source,
)
from .models import Platform, PlatformAccount
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


class EncryptedFieldTests(TestCase):
    def test_client_secret_is_encrypted_at_rest(self):
        platform = Platform.objects.create(code="strava", name="Strava", client_secret="s3cr3t")
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
        platform = Platform.objects.create(code="garmin", name="Garmin", client_secret="")
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
        self.platform = Platform.objects.create(
            code="strava",
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
