"""Celery 任务：管道执行 + 定时调度 + 僵尸运行回收。"""
import logging
import threading
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from apps.pipelines.engine import PipelineEngine
from apps.pipelines.models import Pipeline, PipelineRun

logger = logging.getLogger(__name__)


def _execute(pipeline_id: int, run_id: int | None) -> None:
    """同步执行一次管道（Celery worker 与后台线程共用这段逻辑）。"""
    pipeline = Pipeline.objects.get(pk=pipeline_id)
    run = PipelineRun.objects.filter(pk=run_id).first() if run_id else None
    if run is None:
        run = PipelineRun.objects.create(pipeline=pipeline, status="pending", nodes_state={})
    engine = PipelineEngine(pipeline, run)
    engine.execute()


def dispatch_run(pipeline_id: int, run_id: int) -> str:
    """把一次运行派发出去，返回实际使用的通道（`celery` / `thread`）。

    **绝不在这里同步执行。**

    早先的做法是 `run_pipeline_task.delay()`，而 `CELERY_TASK_ALWAYS_EAGER` 默认为 1，
    于是任务在 HTTP 请求线程内同步跑完：
    - 一次同步几分钟 → 撞上 gunicorn `--timeout 120` → worker 被杀、
      响应永不返回、`PipelineRun` 永久停在 `running`；
    - `max_retries=3` 在 EAGER 下是内联重试，只会卡更久。

    改成 `EAGER=0` 而不起 worker 同样不行：`.delay()` 连不上 Redis 直接抛异常。

    所以这里显式分两路：
    1. 非 EAGER 且 broker 可用 → 交给 Celery（生产推荐，可横向扩 worker）；
    2. 否则 → 起一个 daemon 线程跑。

    线程方案在容器被回收时会中断（所以必须配合 `reap_stale_runs` 兜底），
    但相比「阻塞请求 + 杀 worker」已是本质改善，且**不要求立刻引入 Redis**。
    """
    if not settings.CELERY_TASK_ALWAYS_EAGER:
        try:
            run_pipeline_task.delay(pipeline_id, run_id)
            return "celery"
        except Exception as exc:  # noqa: BLE001 —— broker 不可用/未启动 worker
            logger.warning(
                "Celery 派发失败（%s: %s），回退到后台线程执行 pipeline=%s run=%s",
                type(exc).__name__,
                exc,
                pipeline_id,
                run_id,
            )

    thread = threading.Thread(
        target=_run_in_thread,
        args=(pipeline_id, run_id),
        name=f"pipeline-{pipeline_id}-{run_id}",
        daemon=True,
    )
    thread.start()
    return "thread"


def _run_in_thread(pipeline_id: int, run_id: int) -> None:
    """后台线程入口：兜住一切异常，避免线程静默死掉留下 running 记录。"""
    try:
        _execute(pipeline_id, run_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("后台线程执行管道失败 pipeline=%s run=%s", pipeline_id, run_id)
        PipelineRun.objects.filter(pk=run_id, status__in=["pending", "running"]).update(
            status="error",
            finished_at=timezone.now(),
            stats={"error": f"{type(exc).__name__}: {exc}"[:500]},
        )


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
        run.finished_at = timezone.now()
        run.save(update_fields=["status", "finished_at"])
        raise self.retry(exc=exc, countdown=2 ** self.request.retries * 10)


@shared_task
def scheduled_auto_run():
    """Celery Beat 定时任务：轮询所有启用 auto_run 的管道并入队执行。

    注意：需要真的跑起 `celery beat` 才会被触发。容器只启动 gunicorn 时，
    `auto_run` 不会自动执行 —— 这一点此前没有被说明，README 却宣称每 5 分钟轮询。
    """
    ran = 0
    for pipeline in Pipeline.objects.filter(is_active=True, auto_run=True):
        run = PipelineRun.objects.create(pipeline=pipeline, status="pending", nodes_state={})
        dispatch_run(pipeline.id, run.id)
        ran += 1
    return ran


@shared_task
def reap_stale_runs(pipeline=None):
    """把卡在 pending/running 超过阈值的运行置为 error。

    解决两类真实故障：容器被回收时后台线程被强杀；以及早先 EAGER 模式下
    worker 超时被杀。没有这道兜底，记录会永远停在 `running`，
    用户看到的进度条也永远不会结束。

    可被两种方式调用：Celery Beat 定时（无参，扫全表），
    或新建运行前针对单个管道调用（传 pipeline 实例）。
    """
    limit = timezone.now() - timedelta(
        minutes=getattr(settings, "PIPELINE_RUN_TIMEOUT_MINUTES", 30)
    )
    qs = PipelineRun.objects.filter(status__in=["pending", "running"])
    if pipeline is not None:
        qs = qs.filter(pipeline=pipeline)
    else:
        qs = qs.filter(created_at__lt=limit)
    count = qs.update(
        status="error",
        finished_at=timezone.now(),
        stats={"error": "执行超时或进程被中断（可能因容器回收 / worker 超时），已标记为失败"},
    )
    if count:
        logger.warning("回收了 %s 条卡住的运行记录", count)
    return count
