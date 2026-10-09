from datetime import timedelta

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.activities.models import ActivityFitDetail
from apps.pipelines.engine import TaskPlanner
from apps.pipelines.tasks import dispatch_run, reap_stale_runs
from apps.platforms.adapters import AdapterError

from .models import Pipeline, PipelineEdge, PipelineNode, PipelineRun
from .serializers import (
    PipelineDetailSerializer,
    PipelineListSerializer,
    RunStatusSerializer,
    SyncTaskConfigSerializer,
)
from .spec import CONTENT_SPECS, OPTION_SPECS, SOURCE_SPECS, TIME_MODE_SPECS

#: 可由前端直接写入的结构化字段
TASK_FIELDS = (
    "source_type",
    "source_account",
    "source_fit_detail",
    "target_accounts",
    "sync_content",
    "time_range",
    "options",
)


class PipelineViewSet(viewsets.ModelViewSet):
    """同步任务 CRUD + 运行 + 试运行预览 + 运行状态轮询"""

    permission_classes = [IsAuthenticated]

    #: 会真正查库拉数据的动作，按 "write" 额度限流。
    #: ⚠️ `run_status` 必须**不在**其中 —— 前端每 1.5 秒轮询一次，
    #: 一旦把它算进 120/hour 的额度，跑一次任务就会把自己限死。
    THROTTLED_ACTIONS = {"create", "update", "partial_update", "run", "preview", "sync_preview"}

    def get_throttles(self):
        """按动作选择限流额度。

        不能在 `@action(...)` 里传 `throttle_scope=` —— DRF 会把额外 kwargs
        当作 `as_view()` 的 initkwargs 校验，而 `throttle_scope` 不是视图类属性，
        会直接抛 `TypeError: received an invalid keyword 'throttle_scope'`。
        """
        self.throttle_scope = "write" if self.action in self.THROTTLED_ACTIONS else ""
        return super().get_throttles()

    def get_queryset(self):
        return Pipeline.objects.filter(user=self.request.user).prefetch_related(
            "nodes__account__platform", "edges", "runs", "target_accounts__platform"
        )

    def get_serializer_class(self):
        if self.action == "retrieve":
            return PipelineDetailSerializer
        return PipelineListSerializer

    def perform_create(self, serializer):
        pipeline = serializer.save(user=self.request.user)
        pipeline.ensure_defaults()
        pipeline.save(update_fields=["sync_content", "time_range", "options", "source_type"])
        pipeline.rebuild_graph()

    # ---------- 结构化配置保存 ----------
    def _apply_task_fields(self, pipeline, data) -> bool:
        """写入结构化字段；返回是否发生了变化（需要重建节点图）。"""
        changed = False
        for field in TASK_FIELDS:
            if field not in data:
                continue
            if field == "target_accounts":
                pipeline.target_accounts.set(data[field] or [])
            elif field in ("source_account", "source_fit_detail"):
                # 外键字段需写 *_id，直接赋 int 会触发 ValueError
                setattr(pipeline, f"{field}_id", data[field] or None)
            else:
                setattr(pipeline, field, data[field])
            changed = True
        if changed:
            pipeline.ensure_defaults()
            pipeline.save()
        return changed

    def create(self, request, *args, **kwargs):
        """POST /api/pipelines/ —— 支持直接带着完整的同步任务配置创建。"""
        serializer = SyncTaskConfigSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(
            PipelineDetailSerializer(serializer.instance, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        """PUT /api/pipelines/{id}/ —— 画布整体保存 或 结构化配置保存（按载荷自动识别）。"""
        pipeline = self.get_object()
        data = request.data

        for field in ("name", "description", "is_active", "auto_run"):
            if field in data:
                setattr(pipeline, field, data[field])
        pipeline.save()

        task_changed = self._apply_task_fields(pipeline, data)

        nodes_data = data.get("nodes")
        if nodes_data is not None:
            pipeline.edges.all().delete()
            pipeline.nodes.all().delete()
            id_map: dict[str, int] = {}
            for nd in nodes_data:
                node = PipelineNode.objects.create(
                    pipeline=pipeline,
                    node_type=nd.get("node_type", "source"),
                    account_id=nd.get("account") or None,
                    config=nd.get("config") or {},
                    position_x=nd.get("position_x", 0),
                    position_y=nd.get("position_y", 0),
                )
                id_map[str(nd.get("client_id") or nd.get("id"))] = node.id
            for ed in data.get("edges") or []:
                src = id_map.get(str(ed.get("source")))
                tgt = id_map.get(str(ed.get("target")))
                if src and tgt and src != tgt:
                    PipelineEdge.objects.create(
                        pipeline=pipeline, source_node_id=src, target_node_id=tgt
                    )
        elif task_changed:
            # 结构化配置变更：重建等价节点图，保持画布与运行状态可用
            pipeline.rebuild_graph()

        return Response(PipelineDetailSerializer(pipeline, context={"request": request}).data)

    # ---------- 规格目录 ----------
    @action(detail=False, methods=["get"], url_path="sync-spec")
    def sync_spec(self, request):
        """GET /api/pipelines/sync-spec/ —— 数据来源、同步内容、时间范围与选项的目录。"""
        accounts = [
            {
                "id": a.id,
                "platform": a.platform.code,
                "platform_name": a.platform.name,
                "display_name": a.display_name or a.platform_user_id,
                "status": a.status,
                "capabilities": a.platform.capabilities or {},
            }
            for a in request.user.platform_accounts.select_related("platform")
        ]

        fit_records = []
        for d in (
            ActivityFitDetail.objects.filter(activity__user=request.user)
            .select_related("activity")
            .order_by("-parsed_at")[:100]
        ):
            activity = d.activity
            duration = (d.summary or {}).get("duration") or activity.duration or 0
            start = activity.start_timestamp
            fit_records.append(
                {
                    "id": d.id,
                    "activity_id": activity.id,
                    "activity_name": activity.name,
                    "file_name": d.file_name,
                    "start": start.isoformat(),
                    "end": (start + timedelta(seconds=int(duration))).isoformat(),
                    "duration": duration,
                    "distance": activity.distance,
                    "has_gps": bool(d.track),
                    "track_point_count": len(d.track or []),
                    "sample_count": len(d.samples or []),
                }
            )

        return Response(
            {
                "sources": SOURCE_SPECS,
                "contents": CONTENT_SPECS,
                "options": OPTION_SPECS,
                "time_modes": TIME_MODE_SPECS,
                "accounts": accounts,
                "fit_records": fit_records,
            }
        )

    @action(detail=False, methods=["post"], url_path="sync-preview")
    def sync_preview(self, request):
        """POST /api/pipelines/sync-preview/ —— 未保存的任务配置也能预览（新建向导用）。"""
        from apps.platforms.models import PlatformAccount

        body = request.data or {}
        snapshot = Pipeline(
            user=request.user,
            source_type=body.get("source_type") or "fit",
            source_account_id=body.get("source_account") or None,
            source_fit_detail_id=body.get("source_fit_detail") or None,
            sync_content=body.get("sync_content") or [],
            time_range=body.get("time_range") or {},
            options=body.get("options") or {},
        )
        targets = None
        if body.get("target_accounts") is not None:
            targets = list(
                PlatformAccount.objects.filter(
                    user=request.user, id__in=body["target_accounts"]
                ).select_related("platform")
            )
        snapshot.ensure_defaults()
        return self._plan(snapshot, targets)

    def _plan(self, snapshot, targets=None):
        """跑规划并把「来源拉不动」如实告诉用户，而不是伪装成「0 条」。"""
        try:
            return Response(TaskPlanner(snapshot, target_accounts=targets).plan())
        except AdapterError as exc:
            return Response(
                {
                    "code": "source_unavailable",
                    "detail": str(exc),
                    "source_type": snapshot.source_type,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

    # ---------- 试运行预览 ----------
    @action(detail=True, methods=["post"])
    def preview(self, request, pk=None):
        """POST /api/pipelines/{id}/preview/ —— 按当前（或临时覆盖的）配置预览将同步的内容，不写入任何数据。"""
        pipeline = self.get_object()
        override = request.data or {}
        target_override = None
        if override:
            snapshot = Pipeline(
                pk=pipeline.pk,
                user=pipeline.user,
                source_type=override.get("source_type", pipeline.source_type),
                source_account_id=override.get("source_account", pipeline.source_account_id),
                source_fit_detail_id=override.get("source_fit_detail", pipeline.source_fit_detail_id),
                sync_content=override.get("sync_content") or pipeline.sync_content,
                time_range=override.get("time_range") or pipeline.time_range,
                options={**(pipeline.options or {}), **(override.get("options") or {})},
            )
            if override.get("target_accounts") is not None:
                from apps.platforms.models import PlatformAccount

                target_override = list(
                    PlatformAccount.objects.filter(
                        user=pipeline.user, id__in=override["target_accounts"]
                    ).select_related("platform")
                )
            return self._plan(snapshot, target_override)
        return self._plan(pipeline)

    # ---------- 运行 ----------
    @action(detail=True, methods=["post"])
    def run(self, request, pk=None):
        """POST /api/pipelines/{id}/run/ —— 入队执行，返回 run_id 供前端轮询

        **不在这里同步执行**：早先 EAGER 模式下任务跑在 HTTP 请求里，
        一次同步几分钟就会撞上 gunicorn 的 --timeout 120，worker 被杀、
        响应永不返回，PipelineRun 永久停在 running。现在交 dispatch_run：
        有 Celery 走 Celery，没有则回退到后台线程，无论如何请求都立刻返回。
        """
        pipeline = self.get_object()
        if not pipeline.is_active:
            return Response({"detail": "任务已停用，请先启用"}, status=status.HTTP_400_BAD_REQUEST)
        if not pipeline.nodes.exists():
            pipeline.rebuild_graph()
        # 上一次可能因容器重启/超时中断而永远停在 running，先回收再新建
        reap_stale_runs(pipeline=pipeline)
        run = PipelineRun.objects.create(pipeline=pipeline, status="pending", nodes_state={})
        dispatch_run(pipeline.id, run.id)
        run.refresh_from_db()
        return Response(RunStatusSerializer(run).data, status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=["get"], url_path="run-status")
    def run_status(self, request, pk=None):
        """GET /api/pipelines/{id}/run-status/ —— 轮询最新一次运行的状态

        取代原来的 SSE `stream` 端点。那个实现用 `while + sleep(1)` 最长挂 600 秒、
        每秒查一次库，单个连接独占一个请求槽位；而全站并发槽位只有 8 个
        （gunicorn --workers 2 --threads 4 → gthread）。**8 个并发打开
        「任务详情」页的用户就能让整个 API 停止响应，包括探针调用的
        /api/health/** —— 探针失败则容器被重启。一条用户正常操作即可触发的自毁路径。

        短轮询天然无状态：不占长连接、不依赖查询参数传 JWT、可被限流，
        前端放弃后服务端不会残留任何挂起资源。
        """
        pipeline = self.get_object()
        run = None
        run_id = request.query_params.get("run_id")
        if run_id:
            run = pipeline.runs.filter(pk=run_id).first()
        if run is None:
            run = pipeline.runs.order_by("-created_at").first()
        if run is None:
            return Response({"run_id": None, "status": "idle", "nodes": {}, "stats": {}})

        return Response(
            {
                "run_id": run.id,
                "pipeline_id": pipeline.id,
                "status": run.status,
                "nodes": run.nodes_state or {},
                "stats": run.stats or {},
                "started_at": run.started_at,
                "finished_at": run.finished_at,
                # 前端据此判断是否继续轮询，避免各页面各自硬编码终态集合
                "done": run.status in ("success", "partial", "error"),
            }
        )
