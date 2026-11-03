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
import time
from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

import requests
from django.utils import timezone

from .models import PlatformAccount
from .tokens import ensure_fresh_token

logger = logging.getLogger(__name__)

#: Strava 的 sport_type（CamelCase）→ 本项目统一的运动类型。
#: 未登记的一律留空，由界面显示「运动」而不去猜 —— 猜错比留空更糟。
STRAVA_SPORT_MAP = {
    "ride": "cycling",
    "virtualride": "cycling",
    "ebikeride": "cycling",
    "mountainbikeride": "cycling",
    "gravelride": "cycling",
    "emountainbikeride": "cycling",
    "handcycle": "cycling",
    "velomobile": "cycling",
    "run": "running",
    "trailrun": "running",
    "virtualrun": "running",
    "swim": "swimming",
    "hike": "hiking",
    "walk": "hiking",
}

#: 拉 streams 时固定要的键。Strava 只返回该活动实际存在的键（没有功率就没有 watts）
STRAVA_STREAM_KEYS = "time,latlng,distance,altitude,velocity_smooth,heartrate,cadence,watts,temp"


def _parse_utc(value):
    """解析 Strava 的 ISO 时间（`2026-11-01T00:00:00Z`）。

    不能用 `start_date_local`：那个不带时区，`fromisoformat` 出来的 naive 值
    会被 Django 按 UTC 存进去，国内用户的活动时间会整体偏移 8 小时。
    """
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, dt_timezone.utc)
    return parsed.astimezone(dt_timezone.utc)


class AdapterError(Exception):

    """平台适配器执行异常。"""


def _json_or_none(resp):
    """平台异常时常常返回 HTML 错误页而不是 JSON，别让 .json() 把真实错误盖掉。"""
    try:
        return resp.json()
    except ValueError:
        return None


def _short_reason(body, resp, limit: int = 200) -> str:
    """从响应里抠一句能放进错误提示的话。"""
    if isinstance(body, dict):
        msg = body.get("message") or body.get("error")
        if msg:
            return str(msg)[:limit]
    text = (getattr(resp, "text", "") or "").strip().replace("\n", " ")
    return text[:limit] or "无响应内容"


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

    #: uploads 是异步接口：POST 只返回 upload id，解析结果要轮询 GET /uploads/{id}
    UPLOAD_POLL_INTERVAL = 2.0
    UPLOAD_POLL_TIMEOUT = 60.0

    # ---------- 读 ----------

    def _get_json(self, url: str, params: dict | None = None):
        """统一处理 Strava 读接口的错误语义。

        429 单独说清楚：新应用的读配额是 **每 15 分钟 100 次、每天 1000 次**，
        而且连续重试会延长冷却窗口。把它混进「请求失败」里，用户只会不停重试，
        结果是从冷却 15 分钟变成 1 小时。
        """
        token = self.account.get_access_token()
        try:
            resp = requests.get(
                url,
                headers={"Authorization": f"Bearer {token}"},
                params=params,
                timeout=(10, 60),
            )
        except requests.RequestException as exc:
            raise AdapterError(f"请求 Strava 失败（网络错误）：{exc}") from exc

        body = _json_or_none(resp)
        if resp.status_code == 429:
            raise AdapterError(
                "Strava 读取限流（429）：配额为每 15 分钟 100 次、每天 1000 次。"
                "请等待 15 分钟后重试；连续重试会延长冷却时间"
            )
        if resp.status_code == 401:
            raise AdapterError("Strava 授权已失效（401），请到「账号管理」重新授权")
        if resp.status_code >= 400:
            raise AdapterError(
                f"Strava 返回 HTTP {resp.status_code}：{_short_reason(body, resp)}"
            )
        if body is None:
            raise AdapterError(f"Strava 返回的不是 JSON（HTTP {resp.status_code}）")
        return body

    def fetch_activities(self, since=None) -> list[dict]:
        """拉取活动列表（`GET /athlete/activities`）。

        注意这里**拿不到文件**：Strava 的 api/v3 没有导出端点，`fit_hash` 恒为空。
        要曲线与轨迹必须再对每条调 `fetch_activity_streams` —— 那是一活动一次请求，
        正因如此才要做成「按需」，而不是同步时全量拉详情。
        """
        self._require_config()
        base = (self.account.platform.api_base or "").rstrip("/")
        params: dict = {"per_page": 100}
        if since is not None:
            params["after"] = int(since.timestamp())

        collected: list[dict] = []
        # 上限 10 页 = 1000 条。再多说明该用增量同步，而不是把限流全花在翻页上
        for page in range(1, 11):
            params["page"] = page
            body = self._get_json(f"{base}/athlete/activities", params=params)
            if not isinstance(body, list):
                raise AdapterError(
                    f"Strava 活动列表返回了非预期结构：{str(body)[:120]}"
                )
            if not body:
                break
            collected.extend(body)
            if len(body) < int(params["per_page"]):
                break

        items = [self._to_activity(raw) for raw in collected]
        # 没有开始时间的记录进不了活动表（该字段非空），直接丢掉而不是塞当前时间
        return [item for item in items if item["start_timestamp"] is not None]

    @staticmethod
    def _to_activity(raw: dict) -> dict:
        """Strava 活动摘要 → 引擎约定的字典结构。"""
        sport = str(raw.get("sport_type") or raw.get("type") or "").lower()
        return {
            "remote_id": str(raw.get("id") or ""),
            "name": raw.get("name") or "未命名活动",
            "start_timestamp": _parse_utc(raw.get("start_date")),
            "activity_type": STRAVA_SPORT_MAP.get(sport, ""),
            # 用 moving_time 而不是 elapsed_time：骑行看重的是移动时间，
            # elapsed 会把等红灯、休息都算进去，与码表上看到的对不上
            "duration": int(raw.get("moving_time") or raw.get("elapsed_time") or 0),
            "distance": round(float(raw.get("distance") or 0) / 1000, 2),
            "fit_hash": "",
        }

    def fetch_activity_streams(self, remote_id, keys: str = STRAVA_STREAM_KEYS) -> dict:
        """拿一条活动的 streams，返回扁平化的 `{键: 序列}`。

        `key_by_type=true` 让响应变成 `{"time": {"data": [...]}}`；
        不带这个参数时返回的是一个数组，解析代码得跟着改 —— 这里的形状是固定的。
        """
        self._require_config()
        base = (self.account.platform.api_base or "").rstrip("/")
        body = self._get_json(
            f"{base}/activities/{remote_id}/streams",
            params={"keys": keys, "key_by_type": "true"},
        )
        if not isinstance(body, dict):
            raise AdapterError(f"Strava streams 返回了非预期结构：{str(body)[:120]}")

        streams: dict = {}
        for key, payload in body.items():
            data = (payload or {}).get("data") if isinstance(payload, dict) else None
            if isinstance(data, list):
                streams[key] = data
        if not streams.get("time"):
            raise AdapterError("Strava 没有返回时间序列（该活动可能未记录采样点）")
        return streams

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

    def upload_fit(self, fit_data: bytes, name: str = "") -> str:
        """上传 FIT 到 Strava，返回 **Strava 侧的活动 ID**。

        必须两步，因为 Strava 的 uploads 是异步的：
          1. POST /uploads 拿到 upload id —— 此时活动还不存在
          2. 轮询 GET /uploads/{id}，直到出现 activity_id 或 error

        只做第一步、把 upload id 当活动 ID 返回是个很自然的错误：数字看着像，
        但它是上传任务的编号。后续再用它去比对/引用就全都对不上。
        """
        self._require_config()
        token = self.account.get_access_token()
        base = (self.account.platform.api_base or "").rstrip("/")

        filename = (name or "").strip()[:120] or "velosync-activity"
        if not filename.lower().endswith(".fit"):
            filename += ".fit"

        data = {"data_type": "fit"}
        if name:
            data["name"] = name[:150]

        try:
            resp = requests.post(
                f"{base}/uploads",
                headers={"Authorization": f"Bearer {token}"},
                files={"file": (filename, fit_data, "application/octet-stream")},
                data=data,
                timeout=(10, 120),
            )
        except requests.RequestException as exc:
            raise AdapterError(f"上传到 Strava 失败（网络错误）：{exc}") from exc

        body = _json_or_none(resp)
        if resp.status_code == 403:
            raise AdapterError(
                "上传到 Strava 被拒绝（403）：当前授权缺少 activity:write 权限。"
                "请到「账号管理」解绑后重新授权（授权页需勾选全部权限）"
            )
        if resp.status_code not in (200, 201):
            raise AdapterError(
                f"上传到 Strava 失败（HTTP {resp.status_code}）：{_short_reason(body, resp)}"
            )
        if not isinstance(body, dict) or not body.get("id"):
            raise AdapterError(
                f"上传到 Strava 失败：响应里没有 upload id（{_short_reason(body, resp)}）"
            )

        return self._await_upload(base, token, body["id"])

    def _await_upload(self, base: str, token: str, upload_id) -> str:
        """轮询直到 Strava 解析完成，返回活动 ID。"""
        deadline = time.monotonic() + self.UPLOAD_POLL_TIMEOUT
        while time.monotonic() < deadline:
            try:
                resp = requests.get(
                    f"{base}/uploads/{upload_id}",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=(5, 30),
                )
            except requests.RequestException as exc:
                raise AdapterError(f"查询 Strava 上传状态失败（网络错误）：{exc}") from exc

            if resp.status_code == 404:
                raise AdapterError("Strava 找不到刚才的 upload id（可能已过期，请重试）")
            if resp.status_code != 200:
                raise AdapterError(f"查询 Strava 上传状态失败（HTTP {resp.status_code}）")

            body = _json_or_none(resp)
            if isinstance(body, dict):
                if body.get("error"):
                    raise AdapterError(f"Strava 解析 FIT 失败：{body['error']}")
                if body.get("activity_id"):
                    return str(body["activity_id"])

            time.sleep(self.UPLOAD_POLL_INTERVAL)

        raise AdapterError(
            f"Strava 上传超时：{int(self.UPLOAD_POLL_TIMEOUT)} 秒内未完成解析。"
            "文件可能仍在处理中，请稍后到 Strava 上确认，避免重复上传"
        )


class CorosAdapter(OAuthAdapter):
    code = "coros"


ADAPTERS: dict[str, type[BaseAdapter]] = {
    "mock": MockAdapter,
    "igpsport": IGPSPORTAdapter,
    "garmin": GarminAdapter,
    # 中国区是独立账号体系与独立域名，但与国际区共用同一套接口语义
    "garmin_cn": GarminAdapter,
    "strava": StravaAdapter,
    "coros": CorosAdapter,
}


def get_adapter(account: PlatformAccount) -> BaseAdapter:
    """根据账号所属平台返回对应适配器实例。"""
    cls = ADAPTERS.get(account.platform.code, OAuthAdapter)
    return cls(account)
