"""活动同步任务：上传单个活动到指定平台，并更新矩阵状态与日志。"""
import logging

from celery import shared_task
from django.utils import timezone

from apps.activities.models import Activity, ActivitySyncState
from apps.platforms.adapters import ActivityExists, AdapterError, get_adapter
from apps.platforms.models import Platform, PlatformAccount
from apps.synclogs.models import SyncLog

from .payload import activity_file

logger = logging.getLogger(__name__)


def _source_adapter(activity, user):
    """活动来源平台的适配器（用于下载原始文件）。

    FIT 来源没有账号，直接返回 None。找不到账号也返回 None —— 本地文件或
    采样点仍然可能够用，不该在这里提前失败。
    """
    code = activity.source_platform or ""
    if code in ("", "fit"):
        return None
    account = (
        PlatformAccount.objects.filter(
            user=user, platform__code=code, status="active"
        )
        .select_related("platform")
        .first()
    )
    if account is None:
        return None
    try:
        return get_adapter(account)
    except Exception:  # noqa: BLE001
        return None


def sync_activity_to_platform(activity_id: int, platform_id: int, account_id: int | None = None, pipeline=None) -> ActivitySyncState:
    """把活动上传到平台（同步执行）。失败写入 error_message，成功写入 remote id。"""
    activity = Activity.objects.select_related("user").get(pk=activity_id)
    platform = Platform.objects.get(pk=platform_id)
    user = activity.user

    account = None
    if account_id:
        account = PlatformAccount.objects.filter(pk=account_id, user=user).first()
    if account is None:
        account = (
            PlatformAccount.objects.filter(user=user, platform=platform, status="active")
            .select_related("platform")
            .first()
        )

    state, _ = ActivitySyncState.objects.get_or_create(activity=activity, platform=platform)

    if account is None:
        state.status = "failed"
        state.error_message = f"未绑定 {platform.name} 账号，请先在「账号」页绑定"
        state.save()
        SyncLog.objects.create(
            user=user, pipeline=pipeline, activity=activity, level="error",
            message=f"同步「{activity.name}」到 {platform.name} 失败: 未绑定账号",
        )
        return state

    state.status = "pending"
    state.error_message = ""
    state.save()

    try:
        adapter = get_adapter(account)
        # 原来这里是 `adapter.download_fit(...)`，而 adapter 是**目标平台**的 —
        # 等于问佳明要原始文件。来源给不了文件时（Strava）必然失败，
        # 现在统一走 payload.activity_file：本地文件 → 来源下载 → 合成 TCX。
        file_data, kind, file_error = activity_file(
            activity, _source_adapter(activity, user), activity.source_activity_id
        )
        if not file_data:
            raise AdapterError(f"没有可上传的文件：{file_error}")
        remote_id = adapter.upload_fit(file_data, name=activity.name)
        state.status = "synced"
        state.remote_activity_id = str(remote_id)
        state.error_message = ""
        state.synced_at = timezone.now()
        SyncLog.objects.create(
            user=user, pipeline=pipeline, activity=activity, level="success",
            message=(
                f"已将「{activity.name}」同步到 {platform.name}"
                + ("（来源无原始文件，已合成 TCX）" if kind == "tcx" else "")
            ),
            detail={"remote_id": str(remote_id)},
        )
    except ActivityExists as exc:
        # 对方已有记录：这是成功，不是失败
        state.status = "synced"
        state.remote_activity_id = ""
        state.error_message = ""
        state.synced_at = timezone.now()
        SyncLog.objects.create(
            user=user, pipeline=pipeline, activity=activity, level="info",
            message=f"「{activity.name}」在 {platform.name} 上已有记录，跳过上传：{exc}",
        )
    except Exception as exc:  # noqa: BLE001
        state.status = "failed"
        state.error_message = str(exc)[:500]
        state.synced_at = None
        SyncLog.objects.create(
            user=user, pipeline=pipeline, activity=activity, level="error",
            message=f"同步「{activity.name}」到 {platform.name} 失败: {exc}",
        )
    state.save()
    return state


@shared_task(bind=True, max_retries=3)
def sync_activity_task(self, activity_id: int, platform_id: int, account_id: int | None = None):
    """异步版本（Celery），指数退避重试。"""
    try:
        return sync_activity_to_platform(activity_id, platform_id, account_id=account_id).status
    except Exception as exc:  # noqa: BLE001
        raise self.retry(exc=exc, countdown=2 ** self.request.retries * 10)
