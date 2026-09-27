from django.conf import settings
from django.db import models


class Pipeline(models.Model):
    """同步管道：源 → 过滤器 → 目标 的可视化数据流"""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="pipelines"
    )
    name = models.CharField("名称", max_length=64)
    description = models.TextField("描述", blank=True, default="")
    is_active = models.BooleanField("启用", default=True)
    auto_run = models.BooleanField("定时自动运行", default=True)
    last_run_at = models.DateTimeField("上次运行", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "管道"
        verbose_name_plural = "管道"
        ordering = ["-created_at"]

    def __str__(self):
        return self.name


class PipelineNode(models.Model):
    """管道节点：source（源）/ filter（过滤器）/ target（目标）"""

    NODE_TYPES = [
        ("source", "源"),
        ("filter", "过滤器"),
        ("target", "目标"),
    ]

    pipeline = models.ForeignKey(Pipeline, on_delete=models.CASCADE, related_name="nodes")
    node_type = models.CharField("类型", max_length=16, choices=NODE_TYPES)
    account = models.ForeignKey(
        "platforms.PlatformAccount",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pipeline_nodes",
        help_text="源/目标节点绑定的平台账号",
    )
    config = models.JSONField("配置（过滤器参数等）", default=dict, blank=True)
    position_x = models.FloatField(default=0)
    position_y = models.FloatField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "管道节点"
        verbose_name_plural = "管道节点"
        ordering = ["id"]

    def __str__(self):
        return f"{self.pipeline.name} #{self.id} ({self.node_type})"


class PipelineEdge(models.Model):
    """管道连线"""

    pipeline = models.ForeignKey(Pipeline, on_delete=models.CASCADE, related_name="edges")
    source_node = models.ForeignKey(
        PipelineNode, on_delete=models.CASCADE, related_name="out_edges"
    )
    target_node = models.ForeignKey(
        PipelineNode, on_delete=models.CASCADE, related_name="in_edges"
    )

    class Meta:
        verbose_name = "管道连线"
        verbose_name_plural = "管道连线"

    def __str__(self):
        return f"{self.source_node_id} → {self.target_node_id}"


class PipelineRun(models.Model):
    """一次管道执行（SSE 实时状态载体）"""

    STATUS = [
        ("pending", "等待"),
        ("running", "运行中"),
        ("success", "成功"),
        ("partial", "部分成功"),
        ("error", "失败"),
    ]

    pipeline = models.ForeignKey(Pipeline, on_delete=models.CASCADE, related_name="runs")
    status = models.CharField("状态", max_length=16, choices=STATUS, default="pending")
    nodes_state = models.JSONField("节点实时状态", default=dict, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "管道运行记录"
        verbose_name_plural = "管道运行记录"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Run #{self.id} of {self.pipeline.name}: {self.status}"
