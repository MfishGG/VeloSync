import json
import time

from django.http import StreamingHttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.pipelines.tasks import run_pipeline_task

from .models import Pipeline, PipelineEdge, PipelineNode, PipelineRun
from .serializers import PipelineDetailSerializer, PipelineListSerializer, RunStatusSerializer


class PipelineViewSet(viewsets.ModelViewSet):
    """管道 CRUD + 运行 + SSE 实时进度"""

    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Pipeline.objects.filter(user=self.request.user).prefetch_related(
            "nodes__account__platform", "edges", "runs"
        )

    def get_serializer_class(self):
        if self.action == "retrieve":
            return PipelineDetailSerializer
        return PipelineListSerializer

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def update(self, request, *args, **kwargs):
        """PUT /api/pipelines/{id}/ —— 整体保存（画布拖拽后）：元信息 + 全量 nodes/edges"""
        pipeline = self.get_object()
        data = request.data

        for field in ("name", "description", "is_active", "auto_run"):
            if field in data:
                setattr(pipeline, field, data[field])
        pipeline.save()

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

        return Response(PipelineDetailSerializer(pipeline).data)

    @action(detail=True, methods=["post"])
    def run(self, request, pk=None):
        """POST /api/pipelines/{id}/run/ —— 入队执行，返回 run_id 供 SSE 订阅"""
        pipeline = self.get_object()
        if not pipeline.is_active:
            return Response({"detail": "管道已停用，请先启用"}, status=status.HTTP_400_BAD_REQUEST)
        run = PipelineRun.objects.create(pipeline=pipeline, status="pending", nodes_state={})
        run_pipeline_task.delay(pipeline.id, run.id)
        # EAGER 模式（CELERY_TASK_ALWAYS_EAGER=1）下任务同步执行完毕，
        # 刷新实例以返回真实终态，避免响应仍是 pending。
        try:
            run.refresh_from_db()
        except PipelineRun.DoesNotExist:  # pragma: no cover - 理论上不会发生
            pass
        return Response(RunStatusSerializer(run).data, status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=["get"])
    def stream(self, request, pk=None):
        """GET /api/pipelines/{id}/stream/ —— SSE 实时推送最新一次运行的节点状态"""
        pipeline = self.get_object()

        def event_stream():
            last_payload = None
            deadline = time.time() + 600  # 最长挂 10 分钟
            while time.time() < deadline:
                run = pipeline.runs.order_by("-created_at").first()
                if run is not None:
                    payload = json.dumps(
                        {"run_id": run.id, "status": run.status, "nodes": run.nodes_state or {}},
                        ensure_ascii=False,
                    )
                    if payload != last_payload:
                        last_payload = payload
                        yield f"data: {payload}\n\n"
                    if run.status in ("success", "partial", "error"):
                        yield "event: done\ndata: {}\n\n"
                        return
                time.sleep(1)

        response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache, no-transform"
        response["X-Accel-Buffering"] = "no"
        return response
