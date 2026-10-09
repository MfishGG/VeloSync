"""平台 Token 加密：Fernet 对称加密，密钥来自环境变量 TOKEN_ENCRYPTION_KEY。

**密文带版本前缀**（形如 `v1:gAAAAA...`）。

为什么需要这个前缀：没有它就没法判断一段密文是用哪把密钥加的。后果很隐蔽 ——
一旦补上 TOKEN_ENCRYPTION_KEY（此前由 SECRET_KEY 派生），所有旧密文都解不开，
而历史上解密失败是**静默返回空串**，用户看到的是「账号未授权」，
没人能联想到是换了密钥。带上版本号之后，至少可以按版本逐批重加密、平滑轮换。
"""
import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings

#: 当前密钥版本。换密钥时递增，并保留旧版本的解密分支以便平滑迁移。
CURRENT_KEY_VERSION = "v1"

_fernet_instance = None


class TokenDecryptError(Exception):
    """密文无法解开。调用方**不应**静默吞掉它。"""


def key_source() -> str:
    """当前密钥来自哪里：`env`（显式设置）或 `derived`（由 SECRET_KEY 派生）。"""
    return "env" if getattr(settings, "TOKEN_ENCRYPTION_KEY", "") else "derived"


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
    """加密并打上版本前缀。空值返回空串（不产生无意义的密文）。"""
    if not value:
        return ""
    token = _fernet().encrypt(value.encode()).decode()
    return f"{CURRENT_KEY_VERSION}:{token}"


def decrypt(value: str) -> str:
    """解密。失败抛 TokenDecryptError，**不返回空串**。

    兼容历史数据：没有版本前缀的密文按 v1 处理（早期版本就是当前密钥加密的）。
    """
    if not value:
        return ""
    version, _, token = value.partition(":")
    if not token:  # 无前缀的历史密文
        version, token = CURRENT_KEY_VERSION, value
    if version != CURRENT_KEY_VERSION:
        raise TokenDecryptError(
            f"密文使用的密钥版本 {version} 与当前版本 {CURRENT_KEY_VERSION} 不一致，"
            "需要按版本逐批重新加密"
        )
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise TokenDecryptError(
            "密文无法解开：通常意味着 TOKEN_ENCRYPTION_KEY 被更换或丢失。"
            "已存 Token 无法自动恢复，需要用户重新授权。"
        ) from exc
