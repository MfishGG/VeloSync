from django.conf import settings
from django.db import models


class SyncLog(models.Model):
    """同步日志（管道 / 活动维度，级别 info/success/warning/error）"""

    LEVELS = [
        ("info", "信息"),
        ("success", "成功"),
        ("warning", "警告"),
        ("error", "错误"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sync_logs"
    )
    pipeline = models.ForeignKey(
        "pipelines.Pipeline", on_delete=models.SET_NULL, null=True, blank=True, related_name="logs"
    )
    activity = models.ForeignKey(
        "activities.Activity", on_delete=models.SET_NULL, null=True, blank=True, related_name="logs"
    )
    level = models.CharField("级别", max_length=16, choices=LEVELS, default="info")
    message = models.TextField("消息")
    detail = models.JSONField("详情", default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "同步日志"
        verbose_name_plural = "同步日志"
        indexes = [models.Index(fields=["user", "created_at"], name="idx_user_created")]
        ordering = ["-created_at"]

    def __str__(self):
        return f"[{self.level}] {self.message[:50]}"
