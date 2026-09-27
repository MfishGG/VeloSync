"""平台 Token 加密：Fernet 对称加密，密钥来自环境变量 TOKEN_ENCRYPTION_KEY。"""
import base64
import hashlib

from cryptography.fernet import Fernet
from django.conf import settings

_fernet_instance = None


def _fernet() -> Fernet:
    global _fernet_instance
    if _fernet_instance is None:
        key = getattr(settings, "TOKEN_ENCRYPTION_KEY", "")
        if key:
            fernet_key = key.encode()
        else:
            # 开发环境：由 SECRET_KEY 派生稳定密钥（生产务必显式设置 TOKEN_ENCRYPTION_KEY）
            digest = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
            fernet_key = base64.urlsafe_b64encode(digest)
        _fernet_instance = Fernet(fernet_key)
    return _fernet_instance


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    return _fernet().decrypt(value.encode()).decode()
