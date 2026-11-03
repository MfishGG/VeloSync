"""佳明账号密码登录（非官方接口）。

**为什么走这条路**：Garmin 的「Connect Developer Program」只对企业合作方开放，
个人应用申请不下来；而它的网页 / App 登录本身是可用的。市面上「佳速通」一类
产品绑定佳明时让用户直接填账号密码，走的就是同一套接口 —— 这不是我们抄捷径，
是这一侧**没有**公开 API 可用。

**它是什么、不是什么**：
- 是：佳明自家 Android App 用的移动端 SSO。登录拿到一张 ticket，换 OAuth1，
  再用 OAuth1 换 OAuth2（1 小时有效），之后调 `connectapi` 一律带 OAuth2 Bearer。
- 不是：任何有 SLA 的协议。佳明随时可能改字段、加风控。所以所有异常都带
  「哪一步失败」，失败时给用户的兜底话术一律是「导出 TCX 手动导入」。

**密码怎么处理**：只在 `login()` 这一次调用里出现，函数返回后即丢弃 ——
不落库、不写日志、不进异常信息。要保住的是 OAuth1 那一对（约一年有效），
OAuth2 过期时用它刷新（`refresh()`），刷不动了才需要用户重新输一次密码。

**两区完全独立**：国际区 `garmin.com`、中国区 `garmin.cn`，域名逐段替换
（`sso.*` / `connectapi.*` / `mobile.integration.*`）。同一套代码，只换 domain。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import secrets
import time
from urllib.parse import parse_qs, quote, urlparse

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

#: 平台 code → 接口域名。佳明两区各自独立，账号与数据互不相通。
DOMAINS = {
    "garmin": "garmin.com",
    "garmin_cn": "garmin.cn",
}
DEFAULT_DOMAIN = "garmin.com"

#: 佳明 Android App 的客户端标识。登录与换取令牌都认它。
MOBILE_CLIENT_ID = "GCM_ANDROID_DARK"

#: SSO 走的是 App 内置 WebView，请求必须像浏览器/App，不能像 python-requests
SSO_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
}
#: 换取令牌时必须用 Android App 的 UA —— 与下面那份 consumer key 是配套的
OAUTH_HEADERS = {"User-Agent": "com.garmin.android.apps.connectmobile"}

#: OAuth1 的消费方密钥不是我们能申请的，取自佳明 App 里内置的那一份。
#: 远程地址是社区维护的镜像；生产可用 settings.GARMIN_OAUTH_CONSUMER 覆盖成固定值，
#: 避免「上游挂了就绑不上账号」。
CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json"
_CONSUMER_CACHE: dict = {}
_CONSUMER_CACHE_AT: float = 0.0
_CONSUMER_TTL = 3600.0

TIMEOUT = (10, 25)


class GarminError(Exception):
    """登录/换令牌失败。`step` 指出卡在哪一步，便于支持时定位。"""

    def __init__(self, step: str, message: str, *, retriable: bool = False):
        super().__init__(message)
        self.step = step
        self.retriable = retriable


class MfaRequired(Exception):
    """需要二次验证。`state` 必须原样保存，验证码要用同一个会话提交。"""

    def __init__(self, state: dict, method: str = "email"):
        super().__init__("需要二次验证")
        self.state = state
        self.method = method


# ---------------- 底层工具 ----------------


def domain_for(platform_code: str) -> str:
    return DOMAINS.get(platform_code, DEFAULT_DOMAIN)


def platform_domain(platform) -> str:
    """平台该打向哪个区：优先看 `api_base` 的域名。

    两套账号体系完全独立，指错区只会得到「账号不存在」——用户完全想不到
    是配置里少写了一个 `.cn`。所以让运营改 `api_base` 就够了，代码不必改。
    """
    host = urlparse(platform.api_base or "").netloc
    if host.startswith("connect."):
        return host[len("connect.") :]
    return domain_for(platform.code)


def _pct(value: str) -> str:
    """RFC 5849 的百分号编码：只保留 unreserved 字符。"""
    return quote(str(value), safe="~-._")


def _consumer() -> tuple[str, str]:
    """取 OAuth1 的 consumer key / secret（带进程内缓存）。"""
    configured = getattr(settings, "GARMIN_OAUTH_CONSUMER", None)
    if isinstance(configured, dict) and configured.get("consumer_key"):
        return configured["consumer_key"], configured.get("consumer_secret", "")

    global _CONSUMER_CACHE, _CONSUMER_CACHE_AT
    fresh = _CONSUMER_CACHE and (time.time() - _CONSUMER_CACHE_AT) < _CONSUMER_TTL
    if fresh:
        return _CONSUMER_CACHE["consumer_key"], _CONSUMER_CACHE["consumer_secret"]

    try:
        resp = requests.get(CONSUMER_URL, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError) as exc:
        raise GarminError(
            "consumer",
            "拿不到佳明的 OAuth1 应用密钥（这是本服务侧的配置依赖，与你的账号无关），"
            "通常是服务端网络出不去。请稍后重试",
            retriable=True,
        ) from exc

    if not isinstance(data, dict) or not data.get("consumer_key"):
        raise GarminError("consumer", "佳明 OAuth1 密钥格式异常，请稍后重试", retriable=True)

    _CONSUMER_CACHE = data
    _CONSUMER_CACHE_AT = time.time()
    return data["consumer_key"], data.get("consumer_secret", "")


def _oauth1_header(
    method: str,
    url: str,
    *,
    token: str = "",
    token_secret: str = "",
    body: dict | None = None,
) -> str:
    """按 RFC 5849 生成 HMAC-SHA1 的 Authorization 头。

    自己实现而不引入 `requests-oauthlib`：整个项目只有这一处需要签名，
    而多一个依赖就多一次构建失败的可能。签名基串必须包含 **表单体参数**
    （佳明的 `audience` 就属于这一类），漏掉会得到 401 且看不出原因。
    """
    consumer_key, consumer_secret = _consumer()
    oauth_params = {
        "oauth_consumer_key": consumer_key,
        "oauth_nonce": secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time())),
        "oauth_version": "1.0",
    }
    if token:
        oauth_params["oauth_token"] = token

    parsed = urlparse(url)
    base_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"

    signing_params = dict(oauth_params)
    # URL 上的查询串与表单体都要进签名基串（RFC 5849 §3.4.1.3.1）
    for key, values in parse_qs(parsed.query, keep_blank_values=True).items():
        signing_params[key] = values[0] if values else ""
    for key, value in (body or {}).items():
        signing_params[key] = value
    # 排序规则：先按编码后的键，再按键值（RFC 5849 §3.4.1.3.2）
    pairs = sorted((_pct(k), _pct(v)) for k, v in signing_params.items())
    normalized = "&".join(f"{k}={v}" for k, v in pairs)

    base_string = "&".join([method.upper(), _pct(base_url), _pct(normalized)])
    signing_key = f"{_pct(consumer_secret)}&{_pct(token_secret)}"
    digest = hmac.new(signing_key.encode(), base_string.encode(), hashlib.sha1).digest()
    oauth_params["oauth_signature"] = base64.b64encode(digest).decode()

    header = ", ".join(f'{_pct(k)}="{_pct(v)}"' for k, v in sorted(oauth_params.items()))
    return f"OAuth {header}"


def _json_body(resp):
    try:
        return resp.json()
    except ValueError:
        return None


def _status_of(body) -> tuple[str, str]:
    """SSO 响应的 (type, message)。"""
    if not isinstance(body, dict):
        return "", ""
    status = body.get("responseStatus") or {}
    if not isinstance(status, dict):
        return "", ""
    return str(status.get("type") or ""), str(status.get("message") or "")


def _check_response(resp, step: str):
    """把网络/HTTP 层异常翻译成人话。"""
    if resp.status_code == 429:
        raise GarminError(
            step,
            "佳明登录接口暂时限流了（短时间内尝试太多次），请等 1 小时后再试。"
            "这段时间内反复重试会延长限流时间",
        )
    if resp.status_code >= 500:
        raise GarminError(step, "佳明登录服务暂时不可用，请稍后重试", retriable=True)
    if resp.status_code >= 400:
        raise GarminError(
            step, f"佳明返回了 HTTP {resp.status_code}，请稍后重试", retriable=True
        )


def _cookies_to_dict(session: requests.Session) -> dict:
    return requests.utils.dict_from_cookiejar(session.cookies)


def _session_with_cookies(cookies: dict | None) -> requests.Session:
    session = requests.Session()
    if cookies:
        session.cookies = requests.utils.cookiejar_from_dict(dict(cookies))
    return session


# ---------------- 登录 ----------------


def _signin_url(domain: str) -> str:
    return f"https://sso.{domain}/mobile/sso/en/sign-in"


def _login_url(domain: str) -> str:
    return f"https://sso.{domain}/mobile/api/login"


def _mfa_url(domain: str) -> str:
    return f"https://sso.{domain}/mobile/api/mfa/verifyCode"


def _login_params(domain: str) -> dict:
    return {
        "clientId": MOBILE_CLIENT_ID,
        "locale": "zh-CN",
        "service": f"https://mobile.integration.{domain}/gcm/android",
    }


def login(
    username: str,
    password: str,
    domain: str = DEFAULT_DOMAIN,
    session: requests.Session | None = None,
) -> tuple[dict, dict]:
    """账号密码换取 (oauth1, oauth2)。需要二次验证时抛 `MfaRequired`。

    `session` 用于二次验证的续用：调用方把 MFA 状态存下来后，下一轮用
    `verify_mfa(state, code)` 接着走，而不是再让用户输一次密码。
    """
    session = session or _session_with_cookies(None)
    params = _login_params(domain)

    try:
        session.get(
            _signin_url(domain),
            params={"clientId": MOBILE_CLIENT_ID},
            headers={**SSO_HEADERS, "Sec-Fetch-Site": "none"},
            timeout=TIMEOUT,
        )
        resp = session.post(
            _login_url(domain),
            params=params,
            headers=SSO_HEADERS,
            json={
                "username": username,
                "password": password,
                "rememberMe": False,
                "captchaToken": "",
            },
            timeout=TIMEOUT,
        )
    except requests.RequestException as exc:
        raise GarminError("login", f"连不上佳明登录服务（{type(exc).__name__}）", retriable=True) from exc

    _check_response(resp, "login")
    body = _json_body(resp)
    if body is None:
        # 风控拦截时返回的是一张 HTML 页面而不是 JSON
        raise GarminError(
            "login",
            "佳明登录接口返回了网页而不是数据，通常是被风控拦了一次。请稍后重试",
            retriable=True,
        )

    status_type, message = _status_of(body)
    if status_type == "SUCCESSFUL":
        ticket = body.get("serviceTicketId") or ""
        if not ticket:
            raise GarminError("login", "佳明登录成功但没返回凭据，请稍后重试", retriable=True)
        return _complete(ticket, domain, session)

    if status_type == "MFA_REQUIRED":
        mfa_info = body.get("customerMfaInfo") or {}
        method = str(mfa_info.get("mfaLastMethodUsed") or "email")
        raise MfaRequired(
            state={
                "domain": domain,
                "login_params": params,
                "cookies": _cookies_to_dict(session),
            },
            method=method,
        )

    # 具体原因只进日志（已刻意不含密码）
    logger.warning("佳明登录未通过：type=%s message=%s", status_type, message)
    raise GarminError(
        "login",
        "登录未通过，请确认账号和密码是否正确（中国区账号要用 connect.garmin.cn 那一套）",
    )


def verify_mfa(state: dict, code: str) -> tuple[dict, dict]:
    """提交二次验证码，接着上一次的会话把登录做完。"""
    domain = state.get("domain") or DEFAULT_DOMAIN
    params = state.get("login_params") or _login_params(domain)
    session = _session_with_cookies(state.get("cookies"))
    method = state.get("mfa_method") or "email"

    try:
        resp = session.post(
            _mfa_url(domain),
            params=params,
            headers=SSO_HEADERS,
            json={
                "mfaMethod": method,
                "mfaVerificationCode": code,
                "rememberMyBrowser": False,
                "reconsentList": [],
                "mfaSetup": False,
            },
            timeout=TIMEOUT,
        )
    except requests.RequestException as exc:
        raise GarminError("mfa", f"连不上佳明登录服务（{type(exc).__name__}）", retriable=True) from exc

    _check_response(resp, "mfa")
    body = _json_body(resp)
    if body is None:
        raise GarminError("mfa", "提交验证码时佳明返回了网页而不是数据，请稍后重试", retriable=True)

    status_type, message = _status_of(body)
    if status_type != "SUCCESSFUL":
        logger.warning("佳明二次验证未通过：type=%s message=%s", status_type, message)
        raise GarminError("mfa", "验证码不正确或已过期，请重新获取后再试")

    ticket = body.get("serviceTicketId") or ""
    if not ticket:
        raise GarminError("mfa", "验证通过但没拿到凭据，请重新绑定", retriable=True)
    return _complete(ticket, domain, session)


def _complete(ticket: str, domain: str, session: requests.Session) -> tuple[dict, dict]:
    oauth1 = get_oauth1(ticket, domain, session)
    oauth2 = exchange_oauth2(oauth1, domain, login=True)
    return oauth1, oauth2


def get_oauth1(ticket: str, domain: str, session: requests.Session | None = None) -> dict:
    """ticket → OAuth1（约一年有效，是刷新 OAuth2 的唯一凭据）。"""
    session = session or _session_with_cookies(None)
    url = (
        f"https://connectapi.{domain}/oauth-service/oauth/preauthorized"
        f"?ticket={quote(ticket, safe='')}"
        f"&login-url={quote(f'https://mobile.integration.{domain}/gcm/android', safe='')}"
        "&accepts-mfa-tokens=true"
    )
    try:
        # 不自动跟随：有的返回体本身就是 `oauth_token=..&oauth_token_secret=..`，
        # 有的把它放在 302 的 Location 里 —— 两种都得认
        resp = session.get(
            url, headers=OAUTH_HEADERS, timeout=TIMEOUT, allow_redirects=False
        )
    except requests.RequestException as exc:
        raise GarminError("ticket", f"换取登录凭据失败（{type(exc).__name__}）", retriable=True) from exc

    if resp.status_code in (301, 302, 303, 307, 308):
        location = resp.headers.get("Location") or ""
        raw = urlparse(location).query
    else:
        _check_response(resp, "ticket")
        raw = resp.text

    parsed = parse_qs(raw)
    token = {k: v[0] for k, v in parsed.items() if v}
    if not token.get("oauth_token") or not token.get("oauth_token_secret"):
        raise GarminError(
            "ticket",
            "佳明没有返回可用的登录凭据，可能是登录状态已失效。请重新绑定",
        )
    token["domain"] = domain
    return token


def exchange_oauth2(oauth1: dict, domain: str, *, login: bool = False) -> dict:
    """OAuth1 → OAuth2。

    `login=True` 是首次登录（要带 audience），`login=False` 是刷新（不带）。
    带错会拿到 401，而且提示里看不出差别。
    """
    url = f"https://connectapi.{domain}/oauth-service/oauth/exchange/user/2.0"
    body: dict = {}
    if login:
        body["audience"] = "GARMIN_CONNECT_MOBILE_ANDROID_DI"
    if oauth1.get("mfa_token"):
        body["mfa_token"] = oauth1["mfa_token"]

    headers = {
        **OAUTH_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": _oauth1_header(
            "POST",
            url,
            token=oauth1.get("oauth_token", ""),
            token_secret=oauth1.get("oauth_token_secret", ""),
            body=body,
        ),
    }
    try:
        resp = requests.post(url, headers=headers, data=body, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise GarminError("exchange", f"换取访问令牌失败（{type(exc).__name__}）", retriable=True) from exc

    if resp.status_code in (401, 403):
        raise GarminError("exchange", "佳明拒绝了刷新请求，登录凭据已失效，请重新绑定账号")
    _check_response(resp, "exchange")

    data = _json_body(resp)
    if not isinstance(data, dict) or not data.get("access_token"):
        raise GarminError("exchange", "佳明没有返回访问令牌，请稍后重试", retriable=True)

    data["domain"] = domain
    return data


def refresh(oauth1: dict, domain: str | None = None) -> dict:
    """用 OAuth1 换一份新的 OAuth2（日常每小时的路径）。"""
    domain = domain or oauth1.get("domain") or DEFAULT_DOMAIN
    return exchange_oauth2(oauth1, domain, login=False)


# ---------------- 资料 ----------------


def profile(access_token: str, domain: str = DEFAULT_DOMAIN) -> dict:
    """读账号资料，用于在账号列表里显示「是谁」。

    失败不算错：拿不到名字就用用户填的登录名，绑定本身是成功的。
    超时给得比登录短 —— 它在登录完成后才调用，而小程序走 callContainer 时
    单次请求硬上限 15 秒，这里多花的时间会直接从用户可感知的等待里扣。
    """
    try:
        resp = requests.get(
            f"https://connectapi.{domain}/userprofile-service/socialProfile",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=(3, 6),
        )
    except requests.RequestException:
        return {}
    if resp.status_code >= 400:
        return {}
    data = _json_body(resp)
    return data if isinstance(data, dict) else {}
