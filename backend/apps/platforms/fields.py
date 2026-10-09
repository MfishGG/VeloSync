"""自定义模型字段。"""
from django.db import models

from .crypto import CURRENT_KEY_VERSION, TokenDecryptError, decrypt, encrypt


class EncryptedTextField(models.TextField):
    """入库前 Fernet 加密、出库后自动解密的文本字段。

    用途：平台凭证（`Platform.client_secret`）。同一张表里的用户 Token
    早就加密了，而 `client_secret` 却是明文 —— 两者敏感级别相当
    （`client_secret` 泄漏后可以冒充你的应用），同一项目里对同类数据两套标准
    是不自洽的。

    **历史明文兼容**：解密失败时不抛异常，而是当作明文返回。这样已有的
    明文记录仍能被读出，并在下一次保存时自动转成密文，无需一次性数据迁移。
    """

    def from_db_value(self, value, expression, connection):
        if value is None or value == "":
            return value or ""
        try:
            return decrypt(value)
        except TokenDecryptError:
            # 兼容历史明文记录；下一次 save() 时会被加密
            return value

    def get_prep_value(self, value):
        if value is None:
            return None
        if value == "":
            return ""
        if isinstance(value, str) and value.startswith(f"{CURRENT_KEY_VERSION}:"):
            return value  # 已经是密文（例如 queryset.update() 传来的）
        return encrypt(value)
