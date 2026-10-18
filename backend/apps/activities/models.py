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


class ActivityFitDetail(models.Model):
    """FIT 文件解析详情（一个活动一份，重复解析覆盖更新）"""

    activity = models.OneToOneField(
        Activity, on_delete=models.CASCADE, related_name="fit_detail"
    )
    file_name = models.CharField("文件名", max_length=255, blank=True, default="")
    file_size = models.IntegerField("文件大小(字节)", default=0)
    file_hash = models.CharField("文件 SHA256", max_length=64, blank=True, default="")
    device = models.JSONField("设备信息", default=dict, blank=True)
    summary = models.JSONField("汇总指标", default=dict, blank=True)
    samples = models.JSONField("采样序列", default=list, blank=True)
    track = models.JSONField("轨迹点", default=list, blank=True)
    parsed_at = models.DateTimeField("解析时间", auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "FIT 解析详情"
        verbose_name_plural = "FIT 解析详情"

    def __str__(self):
        return f"FIT<{self.activity_id}> {self.file_name}"


class ActivityFitFile(models.Model):
    """FIT 原始字节。

    单独一张表、而不是 Activity 上的 BinaryField，是因为 Activity 是所有列表页
    （活动列表、矩阵、仪表盘统计）的查询主体：二进制字段一旦落在主表，任何
    SELECT 都会把它带出来 —— 20MB 的 blob 乘上几十行，列表页会慢一个数量级。
    这里用 OneToOne 挂在旁边，只有真要「把文件传到别的平台」时才取。

    存原始文件而不是只存 hash，是因为 Strava 这类平台要**完整文件**自己解析：
    给它 payload JSON 只会回 "Invalid .FIT File Header"，而用户看到的是一个
    完全联想不到源头的解析错误。
    """

    activity = models.OneToOneField(
        Activity, on_delete=models.CASCADE, related_name="fit_file"
    )
    data = models.BinaryField("原始字节")
    size = models.PositiveIntegerField("字节数", default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "FIT 原始文件"
        verbose_name_plural = "FIT 原始文件"

    def __str__(self):
        return f"FIT<{self.activity_id}> {self.size} bytes"


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
