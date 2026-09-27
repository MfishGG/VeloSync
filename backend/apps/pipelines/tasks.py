"""Celery 任务：管道执行 + 定时调度。"""
from celery import shared_task

from apps.pipelines.engine import PipelineEngine
from apps.pipelines.models import Pipeline, PipelineRun


@shared_task(bind=True, max_retries=3)
def run_pipeline_task(self, pipeline_id: int, run_id: int | None = None):
    pipeline = Pipeline.objects.get(pk=pipeline_id)
    run = PipelineRun.objects.filter(pk=run_id).first() if run_id else None
    if run is None:
        run = PipelineRun.objects.create(pipeline=pipeline, status="pending", nodes_state={})
    try:
        engine = PipelineEngine(pipeline, run)
        return engine.execute().status
    except Exception as exc:  # noqa: BLE001
        run.status = "error"
        run.finished_at = __import__("django.utils.timezone", fromlist=["timezone"]).now()
        run.save(update_fields=["status", "finished_at"])
        raise self.retry(exc=exc, countdown=2 ** self.request.retries * 10)


@shared_task
def scheduled_auto_run():
    """Celery Beat 定时任务：轮询所有启用 auto_run 的管道并入队执行。"""
    for pipeline in Pipeline.objects.filter(is_active=True, auto_run=True):
        run_pipeline_task.delay(pipeline.id)
