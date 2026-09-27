"""第三方快捷登录服务层（微信 / QQ / 微博）

两种模式：
1. **oauth 模式** —— 在 `.env` 中配置了 app_id / app_secret，走真实 OAuth2：
   前端拿 authorize_url 跳转 → 平台回调后端 callback → code 换 openid → 签发 JWT 回跳前端。
2. **mock 模式** —— 未配置凭证（本地开发的默认情况），前端提交一个演示身份即可一键登录/注册，
   便于在没有公网回调与开发者资质时完整体验流程。
"""

import hashlib
import json
import secrets
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from django.conf import settings
from django.contrib.auth.models import User

from .models import SocialAccount


class SocialError(Exception):
    """第三方登录失败（凭证缺失、code 失效、接口报错等）"""


# 平台展示元信息（颜色 / 图标 key 供前端渲染）
PROVIDER_META = {
    "wechat": {"name": "微信", "color": "#07C160", "icon": "wechat"},
    "qq": {"name": "QQ", "color": "#12B7F5", "icon": "qq"},
    "weibo": {"name": "微博", "color": "#E6162D", "icon": "weibo"},
}

TIMEOUT = 8


def _config(provider: str) -> dict:
    cfg = getattr(settings, "SOCIAL_AUTH_PROVIDERS", {}).get(provider)
    if cfg is None:
        raise SocialError(f"不支持的第三方平台：{provider}")
    return cfg


def list_providers() -> list[dict]:
    """供前端渲染快捷登录按钮：区分 oauth / mock 模式"""
    items = []
    for code, cfg in getattr(settings, "SOCIAL_AUTH_PROVIDERS", {}).items():
        enabled = bool(cfg.get("app_id") and cfg.get("app_secret"))
        meta = PROVIDER_META.get(code, {})
        items.append(
            {
                "code": code,
                "name": cfg.get("name") or meta.get("name", code),
                "color": meta.get("color", "#64748b"),
                "icon": meta.get("icon", code),
                "enabled": enabled,
                "mode": "oauth" if enabled else "mock",
            }
        )
    return items


def is_enabled(provider: str) -> bool:
    cfg = _config(provider)
    return bool(cfg.get("app_id") and cfg.get("app_secret"))


def callback_url(provider: str) -> str:
    base = getattr(settings, "SOCIAL_REDIRECT_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
    return f"{base}/api/auth/social/{provider}/callback/"


def build_authorize_url(provider: str, state: str = "") -> str:
    """真实 OAuth 授权地址（未启用时返回空串）"""
    _config(provider)
    if not is_enabled(provider):
        return ""
    cfg = _config(provider)
    redirect = urllib.parse.quote(callback_url(provider), safe="")
    if provider == "wechat":
        return (
            "https://open.weixin.qq.com/connect/qrconnect?"
            f"appid={cfg['app_id']}&redirect_uri={redirect}&response_type=code"
            f"&scope={cfg.get('scope', 'snsapi_login')}&state={state}#wechat_redirect"
        )
    if provider == "qq":
        return (
            "https://graph.qq.com/oauth2.0/authorize?response_type=code"
            f"&client_id={cfg['app_id']}&redirect_uri={redirect}&state={state}"
            f"&scope={cfg.get('scope', 'get_user_info')}"
        )
    if provider == "weibo":
        return (
            "https://api.weibo.com/oauth2/authorize?response_type=code"
            f"&client_id={cfg['app_id']}&redirect_uri={redirect}&state={state}"
        )
    raise SocialError(f"平台 {provider} 暂未实现授权地址")


def _http_json(url: str, data: dict | None = None) -> Any:
    """极简 HTTP 客户端：GET（query）或 POST（form）"""
    if data is None:
        req = urllib.request.Request(url, headers={"User-Agent": "VeloSync/1.0"})
    else:
        body = urllib.parse.urlencode(data).encode()
        req = urllib.request.Request(
            url,
            data=body,
            headers={"User-Agent": "VeloSync/1.0", "Content-Type": "application/x-www-form-urlencoded"},
        )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        text = resp.read().decode("utf-8", "ignore")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # QQ 的 token / me 接口返回非标准 JSON（access_token=...& / callback({...});）
        return text


def exchange_profile(provider: str, code: str) -> dict:
    """用 OAuth code 换取 openid 与用户资料"""
    cfg = _config(provider)
    if not code:
        raise SocialError("缺少授权 code")

    if provider == "wechat":
        token = _http_json(
            "https://api.weixin.qq.com/sns/oauth2/access_token?"
            f"appid={cfg['app_id']}&secret={cfg['app_secret']}&code={code}&grant_type=authorization_code"
        )
        if isinstance(token, dict) and token.get("errcode"):
            raise SocialError(f"微信授权失败：{token.get('errmsg')}")
        access, openid = token.get("access_token"), token.get("openid")
        info = _http_json(
            f"https://api.weixin.qq.com/sns/userinfo?access_token={access}&openid={openid}&lang=zh_CN"
        )
        return {
            "openid": openid,
            "unionid": token.get("unionid", ""),
            "nickname": (info or {}).get("nickname", ""),
            "avatar_url": (info or {}).get("headimgurl", ""),
            "raw": token if isinstance(token, dict) else {},
        }

    if provider == "qq":
        token_text = _http_json(
            "https://graph.qq.com/oauth2.0/token?grant_type=authorization_code"
            f"&client_id={cfg['app_id']}&client_secret={cfg['app_secret']}&code={code}"
            f"&redirect_uri={urllib.parse.quote(callback_url(provider), safe='')}"
        )
        token = dict(urllib.parse.parse_qsl(str(token_text)))
        access = token.get("access_token")
        if not access:
            raise SocialError(f"QQ 授权失败：{token_text}")
        me_text = _http_json(f"https://graph.qq.com/oauth2.0/me?access_token={access}&unionid=1")
        inner = str(me_text)
        if "{" in inner:
            inner = inner[inner.index("{") : inner.rindex("}") + 1]
        me = json.loads(inner)
        openid = me.get("openid", "")
        info = _http_json(
            "https://graph.qq.com/user/get_user_info?"
            f"access_token={access}&oauth_consumer_key={cfg['app_id']}&openid={openid}"
        )
        return {
            "openid": openid,
            "unionid": me.get("unionid", ""),
            "nickname": (info or {}).get("nickname", ""),
            "avatar_url": (info or {}).get("figureurl_qq_2") or (info or {}).get("figureurl_qq_1", ""),
            "raw": me,
        }

    if provider == "weibo":
        token = _http_json(
            "https://api.weibo.com/oauth2/access_token",
            {
                "client_id": cfg["app_id"],
                "client_secret": cfg["app_secret"],
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": callback_url(provider),
            },
        )
        if not isinstance(token, dict) or not token.get("access_token"):
            raise SocialError(f"微博授权失败：{token}")
        uid = str(token.get("uid", ""))
        info = _http_json(
            f"https://api.weibo.com/2/users/show.json?access_token={token['access_token']}&uid={uid}"
        )
        return {
            "openid": uid,
            "unionid": "",
            "nickname": (info or {}).get("screen_name", ""),
            "avatar_url": (info or {}).get("avatar_large", ""),
            "raw": token,
        }

    raise SocialError(f"平台 {provider} 暂未实现登录")


def mock_profile(provider: str, identity: str = "") -> dict:
    """演示模式：用一个稳定的伪 openid 代表一位第三方用户"""
    _config(provider)
    identity = (identity or "骑行爱好者").strip()[:32]
    seed = f"{provider}:{identity}"
    openid = "mock-" + provider + "-" + hashlib.sha256(seed.encode()).hexdigest()[:16]
    meta = PROVIDER_META.get(provider, {})
    return {
        "openid": openid,
        "unionid": "",
        "nickname": identity,
        "avatar_url": "",
        "raw": {"mock": True, "provider_name": meta.get("name", provider)},
    }


def get_or_create_user(provider: str, profile: dict) -> tuple[User, bool]:
    """按 (provider, openid) 查找绑定；不存在则自动注册新账号并绑定"""
    openid = profile.get("openid") or ""
    if not openid:
        raise SocialError("未能获取第三方 openid")

    social = (
        SocialAccount.objects.filter(provider=provider, openid=openid).select_related("user").first()
    )
    if social is not None:
        changed = False
        for field, key in (("nickname", "nickname"), ("avatar_url", "avatar_url")):
            value = profile.get(key) or ""
            if value and getattr(social, field) != value:
                setattr(social, field, value)
                changed = True
        if profile.get("unionid") and social.unionid != profile["unionid"]:
            social.unionid = profile["unionid"]
            changed = True
        if changed:
            social.save(update_fields=["nickname", "avatar_url", "unionid", "updated_at"])
        # 昵称同步到 user.first_name，便于工作台展示
        if social.nickname and social.user.first_name != social.nickname:
            social.user.first_name = social.nickname[:30]
            social.user.save(update_fields=["first_name"])
        return social.user, False

    meta = PROVIDER_META.get(provider, {})
    base = f"{provider}_{openid[-8:] or secrets.token_hex(3)}"
    username = base
    while User.objects.filter(username=username).exists():
        username = f"{base}{secrets.token_hex(2)}"
    user = User.objects.create_user(
        username=username,
        password=secrets.token_urlsafe(32),  # 第三方账号不设可用密码
        first_name=(profile.get("nickname") or meta.get("name", "用户"))[:30],
    )
    SocialAccount.objects.create(
        user=user,
        provider=provider,
        openid=openid,
        unionid=profile.get("unionid", ""),
        nickname=profile.get("nickname", ""),
        avatar_url=profile.get("avatar_url", ""),
        raw=profile.get("raw", {}),
    )
    return user, True
