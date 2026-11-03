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

from . import garmin_sso
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


class ActivityExists(AdapterError):
    """目标平台上已经有这场活动。

    不算失败：同步的目的达到了。但也不能当成「刚上传成功」记 remote id ——
    那个 id 是对方的，我们没有。引擎据此记为「已同步（对方已有）」。
    """


def guess_file_kind(data: bytes) -> str:
    """按内容判断这是 FIT 还是 TCX。

    为什么不让调用方传：同一条链路里文件来源有三种（本地原始 FIT、平台下载、
    现场合成的 TCX），要是每个调用点都手写类型，总有一处会传错 —— 而传错的
    表现是佳明回一句「文件格式不支持」，完全指不回是哪一步。
    判定方法可靠：TCX 就是 XML，开头必然是 `<?xml` 或根元素；FIT 是二进制。
    """
    head = (data or b"")[:2048].lstrip()
    if head.startswith(b"<?xml") or head.startswith(b"<TrainingCenterDatabase"):
        return "tcx"
    if b"<TrainingCenterDatabase" in head:
        return "tcx"
    return "fit"


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

    #: 该平台能否**导出**活动原始文件。
    #:
    #: 影响同步链路怎么拿到要上传的字节：能导出的直接下载原始文件（无损），
    #: 不能导出的（Strava 的 api/v3 没有导出端点）只能拿本地采样点现场合成 TCX。
    CAN_EXPORT_FILES = True

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
    """佳明适配器（账号密码渠道 + 文件上传）。

    与其它平台最大的不同：它没有可申请的 OAuth 应用，凭据来自用户自己的
    账号密码登录（见 `garmin_sso`）。所以这里的 token 不是「OAuth 授权码换来的」，
    而是「登录后换来的」，刷新也走 OAuth1 而不是 refresh_token。

    `api_base` 里的域名决定打向哪个区（connect.garmin.com / connect.garmin.cn）：
    两套账号体系互不相通，指错域名只会得到「账号不存在」。
    """

    code = "garmin"

    #: 上传入口。文件名后缀决定佳明按哪种格式解析，所以扩展名必须对。
    UPLOAD_PATH = "/upload-service/upload"

    def _domain(self) -> str:
        return garmin_sso.platform_domain(self.account.platform)

    def _api(self, path: str) -> str:
        return f"https://connectapi.{self._domain()}{path}"

    # ---------- 令牌 ----------

    def _ensure_token(self, force: bool = False) -> str:
        """取可用的 OAuth2 Bearer，必要时用 OAuth1 换一份新的。

        OAuth2 只有 1 小时。不主动刷新的话，用户每天第一次同步必然 401 ——
        而 401 会被上层解释成「授权失效、请重新绑定」，于是他被要求重填一次密码，
        而实际上什么都不用做。
        """
        token = self.account.get_access_token()
        if token and not force and not self.account.is_expiring:
            return token

        oauth1 = self.account.get_session().get("oauth1") or {}
        if not oauth1.get("oauth_token"):
            raise AdapterError(
                "这个佳明账号缺少登录凭据（多为改动前绑定的），"
                "请在「账号」页用账号密码重新绑定"
            )
        try:
            oauth2 = garmin_sso.refresh(oauth1, self._domain())
        except garmin_sso.GarminError as exc:
            self.account.mark_expired(str(exc))
            raise AdapterError(f"{exc}；请在「账号」页重新绑定") from exc

        self._store_oauth2(oauth2)
        return oauth2["access_token"]

    def _store_oauth2(self, oauth2: dict) -> None:
        self.account.set_tokens(
            oauth2["access_token"],
            oauth2.get("refresh_token") or "",
            expires_in=oauth2.get("expires_in"),
        )
        self.account.save(
            update_fields=["access_token", "refresh_token", "token_expires_at", "status"]
        )

    # ---------- 读 ----------

    def fetch_activities(self, since=None) -> list[dict]:
        raise AdapterError(
            "佳明作为数据来源尚未接入（当前支持「上传到佳明」；"
            "从佳明取记录请等后续版本）"
        )

    def download_fit(self, activity_id) -> bytes:
        raise AdapterError("佳明暂不支持导出活动文件（本次只实现了上传）")

    # ---------- 写 ----------

    def upload_fit(self, fit_data: bytes, name: str = "") -> str:
        """上传 FIT 或 TCX，返回佳明侧的活动 ID。

        两种格式都收（`/upload-service/upload` 按文件名后缀识别），所以
        「Strava 拿不到原始文件 → 现场合成 TCX」这条路才能走通。
        """
        if not fit_data:
            raise AdapterError("要上传的文件是空的")

        kind = guess_file_kind(fit_data)
        filename = _filename_for(name, kind)
        token = self._ensure_token()
        resp = self._post_file(token, filename, fit_data, kind)

        # 401 只说明这一小时的表到期了，用 OAuth1 换一份再试一次；
        # 直接报「授权失效」会让用户白重填一次密码。
        if resp.status_code in (401, 403):
            logger.info("佳明上传返回 %s，刷新令牌后重试", resp.status_code)
            token = self._ensure_token(force=True)
            resp = self._post_file(token, filename, fit_data, kind)

        return self._read_upload_result(resp)

    def _post_file(self, token: str, filename: str, data: bytes, kind: str):
        mime = {
            "tcx": "application/vnd.garmin.tcx+xml",
            "fit": "application/octet-stream",
        }.get(kind, "application/octet-stream")
        try:
            return requests.post(
                self._api(self.UPLOAD_PATH),
                headers={"Authorization": f"Bearer {token}"},
                files={"file": (filename, data, mime)},
                timeout=(10, 120),
            )
        except requests.RequestException as exc:
            raise AdapterError(f"上传到佳明失败（网络错误：{type(exc).__name__}）") from exc

    def _read_upload_result(self, resp) -> str:
        body = _json_or_none(resp)
        if resp.status_code == 429:
            raise AdapterError("佳明上传接口限流了（429），请等一会儿再试")

        reason = _short_reason(body, resp)
        if resp.status_code == 409 or "duplicate" in reason.lower():
            raise ActivityExists("佳明上已经有这场活动的记录，无需重复上传")

        if resp.status_code >= 400:
            raise AdapterError(f"上传到佳明失败（HTTP {resp.status_code}）：{reason}")

        result = (body or {}).get("detailedImportResult") if isinstance(body, dict) else None
        if not isinstance(result, dict):
            raise AdapterError(
                "佳明没有返回上传结果。文件可能已进入处理队列，"
                "请稍后到佳明上看一眼，避免重复上传"
            )

        successes = result.get("successes") or []
        for item in successes:
            item = item or {}
            remote = item.get("internalId") or item.get("externalId")
            if remote:
                return str(remote)
        if successes:
            return ""

        message = _first_failure_message(result)
        if "duplicate" in message.lower():
            raise ActivityExists("佳明上已经有这场活动的记录，无需重复上传")
        raise AdapterError(f"佳明不接受这个文件：{message or '未给出原因'}")

    # ---------- 其它 ----------

    def check_exists(self, start_timestamp):
        """佳明没有「按时间点查是否已上传」的接口，去重交给文件里的时间戳。"""
        return None

    def revoke_token(self) -> bool:
        """佳明没有 deauthorize 端点。

        本地解绑会连同 `session_data` 一起删掉，服务端就再也拿不到这个账号 ——
        这与「撤销授权」的效果一致。
        """
        return False


def _filename_for(name: str, kind: str) -> str:
    """文件名要干净：引号/换行会破坏 multipart 的分隔与部分平台的解析。"""
    cleaned = "".join(ch for ch in (name or "") if ch not in '\r\n"\\/' and ch.isprintable())
    cleaned = cleaned.strip()[:80] or "velosync-activity"
    return f"{cleaned}.{kind}"


def _first_failure_message(result: dict) -> str:
    for failure in result.get("failures") or []:
        for message in (failure or {}).get("messages") or []:
            content = str((message or {}).get("content") or "").strip()
            if content:
                return content
    return ""


class StravaAdapter(OAuthAdapter):
    code = "strava"

    #: api/v3 **没有**活动文件导出端点（`export_original` / `export_tcx` 只在网页版
    #: 存在）。所以从 Strava 取数据只能走 streams，要文件得我们现场合成。
    CAN_EXPORT_FILES = False

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
        # 后缀与 data_type 必须一致，而且要与**文件内容**一致：
        # 合成的 TCX 若被当成 fit 上传，Strava 只会回一句解析失败
        kind = guess_file_kind(fit_data)
        if not filename.lower().endswith(f".{kind}"):
            filename += f".{kind}"

        data = {"data_type": kind}
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
