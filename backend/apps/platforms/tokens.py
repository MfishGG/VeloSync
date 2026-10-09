"""平台 Token 的刷新与校验。

**这是「绑定第三方账号」真正的核心缺口。**

早先的代码里 `refresh_token` 只被写入、从未被读取，完全没有刷新实现，
而 `token_expires_at` 从未被赋值。后果很硬：Strava 的 access token 只有
**6 小时**（`expires_in: 21600`），且**每次刷新都会轮换 refresh token，旧的立即失效**。
也就是说，即把四个平台的适配器全都写完，用户绑定的账号也会在 6 小时后静默失效，
且**永远无法恢复** —— 对一个主打「无人值守自动同步」的产品，这是根本性问题。

这里补三件事：
1. `ensure_fresh_token()` —— 用之前先判断是否即将过期，是则刷新；
2. `refresh_access_token()` —— 走 `grant_type=refresh_token`，**把新 refresh_token 写回**；
3. 刷新失败时把 `status` 置为 `expired` / `revoked`，让界面说实话。
"""
import logging
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

import requests
from django.utils import timezone

from .models import PlatformAccount

logger = logging.getLogger(__name__)

#: 网络超时（连接, 读取）
_TIMEOUT = (5, 20)


class TokenError(Exception):
    """Token 刷新 / 撤销失败。"""


def post_json(url: str, payload: dict) -> dict:
    """POST 并解析 JSON，把 HTTP 层错误转成可读异常。

    不能直接 `resp.json()`：网关出错时会返回 HTML 错误页，
    `JSONDecodeError` 的信息是 `Expecting value: line 1 column 1`，
    对排障毫无帮助。这里带上状态码与响应前 200 字。
    """
    try:
        resp = requests.post(url, data=payload, timeout=_TIMEOUT)
    except requests.RequestException as exc:
        raise TokenError(f"请求 {url} 失败：{exc}") from exc

    body = (resp.text or "")[:200]
    if resp.status_code >= 400:
        raise TokenError(f"{url} 返回 HTTP {resp.status_code}：{body}")
    try:
        data = resp.json()
    except ValueError as exc:
        raise TokenError(f"{url} 返回的不是 JSON（HTTP {resp.status_code}）：{body}") from exc
    if not isinstance(data, dict):
        raise TokenError(f"{url} 返回了非预期的 JSON 结构：{body}")
    return data


def resolve_expiry(data: dict):
    """从平台响应里解析过期时间。

    OAuth 标准是 `expires_in`（秒），Strava 额外给了 `expires_at`（epoch 秒）。
    两者都读，优先绝对时间 —— 相对秒数在慢响应下会算偏。
    """
    expires_at = data.get("expires_at")
    if isinstance(expires_at, (int, float)) and expires_at > 0:
        return datetime.fromtimestamp(expires_at, tz=dt_timezone.utc)
    expires_in = data.get("expires_in")
    if expires_in is not None:
        try:
            return timezone.now() + timedelta(seconds=int(expires_in))
        except (TypeError, ValueError):
            return None
    return None


def refresh_access_token(account: PlatformAccount) -> bool:
    """用 refresh_token 换新的 access_token。成功返回 True。

    ⚠️ **轮换**：Strava 等平台每次刷新都会签发新的 refresh_token 并让旧的失效。
    因此只要响应里带了 refresh_token 就必须写回，否则下次刷新必然失败，
    账号从此不可恢复。
    """
    platform = account.platform
    refresh = account.get_refresh_token()
    if not refresh:
        account.mark_expired("没有可用的 refresh token，需要用户重新授权")
        raise TokenError(f"{platform.name} 没有 refresh token，无法自动刷新，请重新授权")
    if not platform.token_url:
        raise TokenError(f"{platform.name} 未配置 token_url，无法刷新")

    data = post_json(
        platform.token_url,
        {
            "grant_type": "refresh_token",
            "refresh_token": refresh,
            "client_id": platform.client_id,
            "client_secret": platform.client_secret,
        },
    )

    access = data.get("access_token") or ""
    if not access:
        err = data.get("error_description") or data.get("error") or data
        # invalid_grant 意味着 refresh token 已失效/被撤销，重试没有意义
        if str(data.get("error") or "").lower() == "invalid_grant":
            account.mark_revoked(f"平台返回 invalid_grant：{err}")
        else:
            account.mark_expired(f"刷新失败：{err}")
        raise TokenError(f"{platform.name} 刷新 Token 失败：{err}")

    account.set_tokens(
        access,
        refresh=data.get("refresh_token") or refresh,  # 未返回则沿用旧的
        expires_at=resolve_expiry(data),
    )
    account.save(
        update_fields=["access_token", "refresh_token", "token_expires_at", "status"]
    )
    logger.info("平台账号 %s（%s）Token 已刷新", account.pk, platform.name)
    return True


def ensure_fresh_token(account: PlatformAccount) -> PlatformAccount:
    """使用 Token 前调用：即将过期就先刷新。

    演示账号（`mock-` / `demo-`）不参与刷新 —— 它们的 Token 是我们自己签发的，
    没有对应的刷新端点，硬刷只会报错。
    """
    if account.is_demo or account.platform.auth_type == "mock":
        return account
    if not account.is_expiring:
        return account
    try:
        refresh_access_token(account)
    except TokenError:
        logger.warning("平台账号 %s 自动刷新失败，本次同步将带旧 Token 尝试", account.pk)
    return account
