"""平台适配器层（Adapter）。

每个平台一个适配器，实现统一的能力：
- fetch_activities / download_fit / upload_fit / check_exists：运动记录同步
- fetch_content / push_content：个人资料、训练课程、路线、体重、睡眠等账号类内容同步

新增平台只需实现 BaseAdapter 并注册到 ADAPTERS，配置即接入。
未实现的账号类内容会抛出 NotImplementedError，引擎记为「预留」并跳过，不会中断任务。
"""
import hashlib
import logging
import random
from abc import ABC, abstractmethod
from datetime import timedelta

import requests
from django.utils import timezone

from .models import PlatformAccount
from .tokens import ensure_fresh_token

logger = logging.getLogger(__name__)


class AdapterError(Exception):
    """平台适配器执行异常。"""


class ContentNotSupported(NotImplementedError):
    """平台未实现某种账号类内容的同步（引擎记为预留）。"""


class BaseAdapter(ABC):
    code = "base"

    #: 该平台支持的账号类内容（运动记录之外的 profile / course / route / weight / sleep …）
    CONTENT_SUPPORT: set[str] = set()

    def __init__(self, account: PlatformAccount):
        self.account = account

    @abstractmethod
    def fetch_activities(self, since=None) -> list[dict]: ...

    @abstractmethod
    def download_fit(self, activity_id) -> bytes: ...

    @abstractmethod
    def upload_fit(self, fit_data: bytes, name: str = "") -> str: ...

    @abstractmethod
    def check_exists(self, start_timestamp): ...

    # ---------- 账号类内容 ----------
    def supports_content(self, key: str) -> bool:
        return key in self.CONTENT_SUPPORT

    def fetch_content(self, key: str, since=None, until=None) -> dict:
        """从来源账号拉取某类内容。默认未实现。"""
        raise ContentNotSupported(f"{self.account.platform.name} 暂不支持拉取「{key}」")

    def push_content(self, key: str, payload: dict) -> str:
        """把某类内容写入目标账号，返回远端标识。默认未实现。"""
        raise ContentNotSupported(f"{self.account.platform.name} 暂不支持写入「{key}」")

    def revoke_token(self) -> bool:
        """通知平台撤销本账号的授权。默认无此能力。

        合规要求：Strava 明确要求用户在应用内解除授权时，应用应调用
        `POST /oauth/deauthorize`。此前解绑只删了本地记录，平台侧授权仍然有效 ——
        用户以为已断开、实际没有。
        """
        return False


class MockAdapter(BaseAdapter):
    """演示适配器：确定性伪随机数据，可完整跑通“拉取 → 过滤 → 上传”。"""

    code = "mock"
    SPORTS = ["cycling", "running", "hiking", "swimming"]
    CONTENT_SUPPORT = {"profile", "course", "route", "weight", "sleep", "health", "workout"}

    def fetch_activities(self, since=None) -> list[dict]:
        rng = random.Random(self.account.id)
        base = since or (timezone.now() - timedelta(days=14))
        results = []
        cursor = base
        for i in range(8):
            cursor = cursor + timedelta(hours=28 + rng.randint(0, 16))
            if cursor > timezone.now():
                break
            sport = self.SPORTS[rng.randrange(len(self.SPORTS))]
            distance = (
                round(18 + rng.random() * 60, 2)
                if sport == "cycling"
                else round(4 + rng.random() * 12, 2)
            )
            results.append(
                {
                    "remote_id": f"mock-{self.account.id}-{i}",
                    "name": f"{sport} 训练 #{i + 1}",
                    "start_timestamp": cursor,
                    "activity_type": sport,
                    "duration": int(distance / 25 * 3600) + rng.randint(-200, 600),
                    "distance": distance,
                }
            )
        return results

    def download_fit(self, activity_id) -> bytes:
        return b"MOCK-FIT-" + str(activity_id).encode()

    def upload_fit(self, fit_data: bytes, name: str = "") -> str:
        return f"mock-remote-{hashlib.md5(fit_data).hexdigest()[:12]}"

    def check_exists(self, start_timestamp):
        return None

    # ---------- 账号类内容（演示数据，便于完整跑通同步链路） ----------
    def fetch_content(self, key: str, since=None, until=None) -> dict:
        rng = random.Random(f"{self.account.id}-{key}")
        days = 7 if key in ("sleep", "weight", "health") else 5
        base = since or (timezone.now() - timedelta(days=days))
        items = []
        for i in range(days):
            day = (base + timedelta(days=i)).date().isoformat()
            if key == "profile":
                items = [{"nickname": self.account.display_name or "demo", "weight_kg": 65.5, "height_cm": 175}]
                break
            if key == "weight":
                items.append({"date": day, "weight_kg": round(64 + rng.random() * 2, 1)})
            elif key == "sleep":
                items.append(
                    {
                        "date": day,
                        "duration_min": 380 + rng.randint(-60, 60),
                        "deep_min": 70 + rng.randint(0, 40),
                        "rem_min": 80 + rng.randint(0, 30),
                    }
                )
            elif key == "health":
                items.append(
                    {"date": day, "steps": 6000 + rng.randint(0, 9000), "resting_hr": 48 + rng.randint(0, 12)}
                )
            elif key == "course":
                items.append({"name": f"课程 {i + 1}", "duration_min": 30 + rng.randint(0, 60)})
            elif key == "route":
                items.append({"name": f"路线 {i + 1}", "distance_km": round(20 + rng.random() * 60, 1)})
            elif key == "workout":
                items.append({"date": day, "name": f"训练计划 {i + 1}", "type": self.SPORTS[rng.randrange(4)]})
        return {"key": key, "items": items}

    def push_content(self, key: str, payload: dict) -> str:
        count = len((payload or {}).get("items") or [])
        return f"mock-{key}-{hashlib.md5(f'{key}{count}{self.account.id}'.encode()).hexdigest()[:10]}"


class OAuthAdapter(BaseAdapter):
    """
    OAuth2 平台通用骨架。
    各平台申请到开发者凭证后，在 platform 表补充 authorize_url/token_url/api_base，
    再按平台文档覆写对应方法即可接入。
    """

    code = "oauth"

    def _require_config(self):
        platform = self.account.platform
        # 演示身份：先在「账号管理」或本地凭证配置之前以演示身份绑定过
        if self.account.is_demo:
            raise AdapterError(
                f"{platform.name} 当前绑定的是本地【演示身份】，未接入真实平台，无法拉取/上传数据。"
                "请先在平台表配置 OAuth 凭证，再到「账号管理」重新授权"
            )
        missing = platform.oauth_missing
        if missing:
            raise AdapterError(
                f"{platform.name} 尚未配置 OAuth 凭证（{'、'.join(missing)}），"
                "请在平台表补充，或执行 python manage.py set_platform_oauth --list 查看各平台状态"
            )
        if not platform.api_base:
            raise AdapterError(f"{platform.name} 尚未配置 api_base（接口地址），请在平台表补充")

        # 先刷新再取用：access token 往往只有几小时，直接拿去请求必然 401，
        # 而 401 又会被误判成「用户没授权」。这里在过期前主动换新。
        ensure_fresh_token(self.account)

        if not self.account.get_access_token():
            if self.account.token_error:
                raise AdapterError(
                    f"{platform.name} 的 Token 无法解密：{self.account.token_error}"
                )
            raise AdapterError(f"{platform.name} 的账号未授权或 Token 已失效，请在「账号管理」重新授权")

    def fetch_activities(self, since=None) -> list[dict]:
        self._require_config()
        raise AdapterError(f"{self.account.platform.name} 的拉取接口需按官方文档实现（Adapter 层待适配）")

    def download_fit(self, activity_id) -> bytes:
        self._require_config()
        raise AdapterError(f"{self.account.platform.name} 的 FIT 下载接口待适配")

    def upload_fit(self, fit_data: bytes, name: str = "") -> str:
        self._require_config()
        raise AdapterError(f"{self.account.platform.name} 的 FIT 上传接口待适配")

    def check_exists(self, start_timestamp):
        return None

    def revoke_token(self) -> bool:
        """默认实现：不声明 deauthorize 端点的平台，只能本地解绑。"""
        return False


class IGPSPORTAdapter(OAuthAdapter):
    code = "igpsport"


class GarminAdapter(OAuthAdapter):
    code = "garmin"


class StravaAdapter(OAuthAdapter):
    code = "strava"

    #: Strava 明确要求撤销授权时调用该端点，否则平台侧授权仍然有效
    DEAUTHORIZE_URL = "https://www.strava.com/oauth/deauthorize"

    def revoke_token(self) -> bool:
        """调用 Strava deauthorize 真正撤销授权。"""
        token = self.account.get_access_token()
        if not token:
            return False
        try:
            resp = requests.post(self.DEAUTHORIZE_URL, data={"access_token": token}, timeout=(5, 20))
        except requests.RequestException as exc:
            logger.warning("Strava deauthorize 请求失败：%s", exc)
            return False
        # Strava 无论成功与否都返回 200，靠 body 判断；失败不阻断本地解绑
        ok = resp.status_code == 200
        if not ok:
            logger.warning("Strava deauthorize 返回 HTTP %s", resp.status_code)
        return ok


class CorosAdapter(OAuthAdapter):
    code = "coros"


ADAPTERS: dict[str, type[BaseAdapter]] = {
    "mock": MockAdapter,
    "igpsport": IGPSPORTAdapter,
    "garmin": GarminAdapter,
    "strava": StravaAdapter,
    "coros": CorosAdapter,
}


def get_adapter(account: PlatformAccount) -> BaseAdapter:
    """根据账号所属平台返回对应适配器实例。"""
    cls = ADAPTERS.get(account.platform.code, OAuthAdapter)
    return cls(account)
