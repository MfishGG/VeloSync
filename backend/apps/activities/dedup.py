"""智能去重：±5 秒时间窗口匹配 + FIT 哈希辅助校验。"""
from datetime import timedelta

from apps.activities.models import Activity

DEFAULT_WINDOW_SECONDS = 5


def find_duplicate(
    user,
    start_timestamp,
    fit_hash: str | None = None,
    window_seconds: int = DEFAULT_WINDOW_SECONDS,
) -> Activity | None:
    """
    在 user 的活动库中查找同一时刻的活动：
    1. 时间窗口 ±window_seconds 内的记录；
    2. 若提供 fit_hash，优先返回哈希完全一致的记录；
    3. 否则返回窗口内第一条。
    """
    window = timedelta(seconds=window_seconds)
    qs = Activity.objects.filter(
        user=user,
        start_timestamp__gte=start_timestamp - window,
        start_timestamp__lte=start_timestamp + window,
    )
    if fit_hash:
        matched = qs.filter(fit_hash=fit_hash).first()
        if matched:
            return matched
    return qs.first()
