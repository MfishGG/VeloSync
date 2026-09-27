"""平台适配器层（Adapter）。

每个平台一个适配器，实现统一的四个能力：
- fetch_activities：拉取活动列表
- download_fit：下载 FIT 原始文件
- upload_fit：上传 FIT 文件
- check_exists：按开始时间检查目标平台是否已有该活动

新增平台只需实现 BaseAdapter 并注册到 ADAPTERS，配置即接入。
"""
import hashlib
import random
from abc import ABC, abstractmethod
from datetime import timedelta

from django.utils import timezone

from .models import PlatformAccount


class AdapterError(Exception):
    """平台适配器执行异常。"""


class BaseAdapter(ABC):
    code = "base"

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


class MockAdapter(BaseAdapter):
    """演示适配器：确定性伪随机数据，可完整跑通“拉取 → 过滤 → 上传”。"""

    code = "mock"
    SPORTS = ["cycling", "running", "hiking", "swimming"]

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


class OAuthAdapter(BaseAdapter):
    """
    OAuth2 平台通用骨架。
    各平台申请到开发者凭证后，在 platform 表补充 authorize_url/token_url/api_base，
    再按平台文档覆写对应方法即可接入。
    """

    code = "oauth"

    def _require_config(self):
        platform = self.account.platform
        if not platform.api_base or not self.account.get_access_token():
            raise AdapterError(
                f"{platform.name} 的 API 凭证尚未配置或账号未授权，"
                "请在平台表补充 client_id / api_base 并完成 OAuth 绑定"
            )

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


class IGPSPORTAdapter(OAuthAdapter):
    code = "igpsport"


class GarminAdapter(OAuthAdapter):
    code = "garmin"


class StravaAdapter(OAuthAdapter):
    code = "strava"


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
