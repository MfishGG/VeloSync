from django.conf import settings
from django.db import models


class Activity(models.Model):
    """运动活动（统一存储，跨平台去重靠 start_timestamp 窗口 + fit_hash）"""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="activities"
    )
    name = models.CharField("活动名称", max_length=200, blank=True, default="未命名活动")
    start_timestamp = models.DateTimeField("开始时间")
    activity_type = models.CharField("运动类型", max_length=32, blank=True, default="")
    duration = models.IntegerField("时长(秒)", default=0)
    distance = models.FloatField("距离(km)", default=0)
    source_platform = models.CharField("来源平台", max_length=32)
    source_activity_id = models.CharField("来源平台活动 ID", max_length=128, blank=True, default="")
    fit_hash = models.CharField("FIT 文件哈希", max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "活动"
        verbose_name_plural = "活动"
        indexes = [
            models.Index(fields=["user", "start_timestamp"], name="idx_user_start"),
            models.Index(fields=["fit_hash"], name="idx_fit_hash"),
        ]
        ordering = ["-start_timestamp"]

    def __str__(self):
        return f"{self.name} @ {self.start_timestamp:%Y-%m-%d %H:%M}"


class ActivitySyncState(models.Model):
    """活动 × 平台 的同步状态（矩阵单元格）"""

    STATUS = [
        ("synced", "已同步"),
        ("pending", "待同步"),
        ("failed", "失败"),
        ("na", "不适用"),
    ]

    activity = models.ForeignKey(
        Activity, on_delete=models.CASCADE, related_name="sync_states"
    )
    platform = models.ForeignKey(
        "platforms.Platform", on_delete=models.CASCADE, related_name="+"
    )
    remote_activity_id = models.CharField(max_length=128, blank=True, default="")
    status = models.CharField("状态", max_length=16, choices=STATUS, default="pending")
    error_message = models.TextField(blank=True, default="")
    synced_at = models.DateTimeField("同步时间", null=True, blank=True)

    class Meta:
        verbose_name = "活动同步状态"
        verbose_name_plural = "活动同步状态"
        constraints = [
            models.UniqueConstraint(fields=["activity", "platform"], name="uk_activity_platform")
        ]

    def __str__(self):
        return f"{self.activity_id} × {self.platform.code}: {self.status}"
