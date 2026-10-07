from django.conf import settings
from django.db import models

from .spec import CONTENT_SPECS, SOURCE_CODES, SOURCE_SPECS, default_contents, default_options


class Pipeline(models.Model):
    """同步任务：数据来源 → 同步内容 → 目标账号。

    既支持画布式节点编排（nodes/edges），也支持结构化配置（source_type / sync_content /
    target_accounts / time_range / options）。结构化配置保存时会自动展开为等价的节点图，
    因此运行引擎、SSE 进度与画布可视化完全复用同一套机制。
    """

    SOURCE_TYPES = [(s["code"], s["label"]) for s in SOURCE_SPECS]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="pipelines"
    )
    name = models.CharField("名称", max_length=64)
    description = models.TextField("描述", blank=True, default="")
    is_active = models.BooleanField("启用", default=True)
    auto_run = models.BooleanField("定时自动运行", default=True)
    last_run_at = models.DateTimeField("上次运行", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # ---------- 结构化同步配置 ----------
    source_type = models.CharField(
        "数据来源", max_length=32, choices=SOURCE_TYPES, default="fit"
    )
    source_account = models.ForeignKey(
        "platforms.PlatformAccount",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="source_tasks",
        help_text="平台类来源绑定的账号；FIT 来源为空",
    )
    source_fit_detail = models.ForeignKey(
        "activities.ActivityFitDetail",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sync_tasks",
        help_text="指定某个已导入的 FIT 记录；为空表示该用户全部 FIT 记录",
    )
    target_accounts = models.ManyToManyField(
        "platforms.PlatformAccount",
        related_name="target_tasks",
        blank=True,
        verbose_name="目标账号",
    )
    sync_content = models.JSONField("同步内容", default=list, blank=True)
    time_range = models.JSONField("时间范围", default=dict, blank=True)
    options = models.JSONField("同步选项", default=dict, blank=True)

    class Meta:
        verbose_name = "同步任务"
        verbose_name_plural = "同步任务"
        ordering = ["-created_at"]

    def __str__(self):
        return self.name

    # ---------- 配置兜底 ----------
    def ensure_defaults(self) -> None:
        """补齐缺省的同步内容/时间范围/选项（历史数据或空配置时调用）。"""
        from .spec import normalize_contents, normalize_options, normalize_time_range

        if not isinstance(self.sync_content, list) or not self.sync_content:
            self.sync_content = default_contents(self.source_type)
        if not isinstance(self.time_range, dict) or not self.time_range.get("mode"):
            self.time_range = {"mode": "file", "start": None, "end": None, "days": 30}
        self.time_range = normalize_time_range(self.source_type, self.time_range)
        self.sync_content = normalize_contents(self.source_type, self.sync_content)
        base = default_options()
        base.update({k: v for k, v in (self.options or {}).items() if k in base})
        self.options = base

    @property
    def is_file_source(self) -> bool:
        return self.source_type == "fit"

    def target_account_list(self):
        return list(self.target_accounts.select_related("platform").all())

    def content_labels(self) -> list[str]:
        from .spec import content_label

        return [content_label(k) for k in self.sync_content]

    def rebuild_graph(self) -> None:
        """按结构化配置重建等价的节点图：源 → 时间范围过滤 → 各目标账号。

        画布可视化与执行引擎共用这张图，因此配置变更后画布与 SSE 进度会自动同步。
        """
        from datetime import timedelta

        from django.utils import timezone

        from .models import PipelineEdge, PipelineNode

        self.edges.all().delete()
        self.nodes.all().delete()

        source = PipelineNode.objects.create(
            pipeline=self,
            node_type="source",
            account=self.source_account,
            config={
                "source_type": self.source_type,
                "fit_detail": self.source_fit_detail_id,
            },
            position_x=40,
            position_y=140,
        )
        filter_node = PipelineNode.objects.create(
            pipeline=self,
            node_type="filter",
            config=self._time_filter_config(timezone.now(), timedelta),
            position_x=300,
            position_y=140,
        )
        PipelineEdge.objects.create(pipeline=self, source_node=source, target_node=filter_node)

        for index, account in enumerate(self.target_accounts.select_related("platform").all()):
            target = PipelineNode.objects.create(
                pipeline=self,
                node_type="target",
                account=account,
                config={"content": self.sync_content, "options": self.options},
                position_x=560,
                position_y=40 + index * 120,
            )
            PipelineEdge.objects.create(pipeline=self, source_node=filter_node, target_node=target)

    def _time_filter_config(self, now, timedelta) -> dict:
        """把任务的时间范围映射为画布过滤节点配置（file/all 模式不做过滤）。"""
        tr = self.time_range or {}
        mode = tr.get("mode")
        if mode == "recent":
            days = int(tr.get("days") or 30)
            return {
                "filter_type": "by_date_range",
                "date_from": (now - timedelta(days=days)).date().isoformat(),
                "date_to": now.date().isoformat(),
            }
        if mode == "custom":
            start = (tr.get("start") or "")[:10]
            end = (tr.get("end") or "")[:10]
            return {"filter_type": "by_date_range", "date_from": start, "date_to": end}
        return {"filter_type": "by_date_range", "date_from": "", "date_to": ""}


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
    stats = models.JSONField("执行统计", default=dict, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "管道运行记录"
        verbose_name_plural = "管道运行记录"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Run #{self.id} of {self.pipeline.name}: {self.status}"
