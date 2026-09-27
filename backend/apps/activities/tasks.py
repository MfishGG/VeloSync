"""活动同步任务：上传单个活动到指定平台，并更新矩阵状态与日志。"""
import logging

from celery import shared_task
from django.utils import timezone

from apps.activities.models import Activity, ActivitySyncState
from apps.platforms.adapters import get_adapter
from apps.platforms.models import Platform, PlatformAccount
from apps.synclogs.models import SyncLog

logger = logging.getLogger(__name__)


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
        fit_data = adapter.download_fit(activity.source_activity_id or activity.id)
        remote_id = adapter.upload_fit(fit_data, name=activity.name)
        state.status = "synced"
        state.remote_activity_id = str(remote_id)
        state.error_message = ""
        state.synced_at = timezone.now()
        SyncLog.objects.create(
            user=user, pipeline=pipeline, activity=activity, level="success",
            message=f"已将「{activity.name}」同步到 {platform.name}",
            detail={"remote_id": str(remote_id)},
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
