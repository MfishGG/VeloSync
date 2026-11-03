"""执行模型与引擎行为的回归测试。

覆盖审查中确认的几个真实故障：SSE 长连接占死请求槽位、EAGER 模式把任务跑在
HTTP 请求里、拉取失败被吞成「0 条成功」、以及 N×M 次查询。
"""
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.activities.models import Activity, ActivityFitFile, ActivitySyncState
from apps.platforms.adapters import AdapterError, MockAdapter
from apps.platforms.models import Platform, PlatformAccount
from apps.platforms.testing import make_platform

from .engine import PipelineEngine, TaskPlanner
from .models import Pipeline, PipelineRun
from .tasks import dispatch_run, reap_stale_runs


class BaseFixtures(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("rider", password="x")
        self.mock = make_platform(
            "mock", name="演示平台", auth_type="mock", capabilities={"upload": True}
        )
        self.other = make_platform(
            "other", name="其他平台", auth_type="mock", capabilities={"upload": True}
        )
        self.account = PlatformAccount.objects.create(
            user=self.user, platform=self.mock, platform_user_id="mock-1"
        )

    def make_pipeline(self, **kwargs):
        defaults = {
            "user": self.user,
            "name": "任务",
            "source_type": "fit",
            "sync_content": ["activity"],
            "time_range": {},
            "options": {},
        }
        defaults.update(kwargs)
        return Pipeline.objects.create(**defaults)

    def make_activity(self, name="骑行", source_platform="mock"):
        return Activity.objects.create(
            user=self.user,
            name=name,
            start_timestamp=timezone.now() - timedelta(hours=2),
            activity_type="cycling",
            source_platform=source_platform,
        )


class ReapStaleRunsTests(BaseFixtures):
    def test_old_running_run_is_marked_error(self):
        """没有这道兜底，容器被回收后记录会永远停在 running，进度条永不结束。"""
        pipeline = self.make_pipeline()
        run = PipelineRun.objects.create(pipeline=pipeline, status="running", nodes_state={})
        PipelineRun.objects.filter(pk=run.pk).update(
            created_at=timezone.now() - timedelta(hours=3)
        )

        self.assertEqual(reap_stale_runs(), 1)
        run.refresh_from_db()
        self.assertEqual(run.status, "error")
        self.assertIsNotNone(run.finished_at)

    def test_fresh_running_run_is_left_alone(self):
        pipeline = self.make_pipeline()
        run = PipelineRun.objects.create(pipeline=pipeline, status="running", nodes_state={})
        self.assertEqual(reap_stale_runs(), 0)
        run.refresh_from_db()
        self.assertEqual(run.status, "running")

    def test_pipeline_scoped_reap_ignores_age(self):
        """点了「运行」时应先回收同一任务的僵尸记录，不等超时。"""
        pipeline = self.make_pipeline()
        run = PipelineRun.objects.create(pipeline=pipeline, status="running", nodes_state={})
        self.assertEqual(reap_stale_runs(pipeline=pipeline), 1)
        run.refresh_from_db()
        self.assertEqual(run.status, "error")

    def test_finished_runs_are_never_touched(self):
        pipeline = self.make_pipeline()
        run = PipelineRun.objects.create(pipeline=pipeline, status="success", nodes_state={})
        PipelineRun.objects.filter(pk=run.pk).update(
            created_at=timezone.now() - timedelta(days=2)
        )
        reap_stale_runs()
        run.refresh_from_db()
        self.assertEqual(run.status, "success")


class DispatchRunTests(BaseFixtures):
    def test_falls_back_to_thread_when_broker_unavailable(self):
        """没有 Redis / 没起 worker 时不能阻塞请求，也不能丢任务。"""
        captured = {}

        class FakeThread:
            def __init__(self, target=None, args=(), name="", daemon=False):
                captured["target"] = target
                captured["args"] = args
                captured["daemon"] = daemon

            def start(self):
                captured["started"] = True

        with patch("apps.pipelines.tasks.run_pipeline_task.delay", side_effect=OSError("no broker")):
            with patch("apps.pipelines.tasks.threading.Thread", FakeThread):
                channel = dispatch_run(11, 22)

        self.assertEqual(channel, "thread")
        self.assertTrue(captured.get("started"))
        self.assertEqual(captured["args"], (11, 22))
        self.assertTrue(captured["daemon"], "后台线程应为 daemon，避免阻塞进程退出")

    def test_uses_celery_when_available(self):
        with override_settings(CELERY_TASK_ALWAYS_EAGER=False):
            with patch("apps.pipelines.tasks.run_pipeline_task.delay") as delay:
                self.assertEqual(dispatch_run(7, 8), "celery")
        delay.assert_called_once_with(7, 8)

    def test_thread_entry_marks_run_failed_on_exception(self):
        """后台线程崩掉时必须把运行置为 error，不能留下永远 running 的记录。"""
        pipeline = self.make_pipeline()
        run = PipelineRun.objects.create(pipeline=pipeline, status="pending", nodes_state={})
        with patch("apps.pipelines.tasks._execute", side_effect=RuntimeError("boom")):
            from .tasks import _run_in_thread

            _run_in_thread(pipeline.id, run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "error")
        self.assertIn("boom", str(run.stats))


class RunStatusEndpointTests(BaseFixtures):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.pipeline = self.make_pipeline()

    def test_poll_returns_states_and_done_flag(self):
        PipelineRun.objects.create(
            pipeline=self.pipeline,
            status="running",
            nodes_state={"1": {"status": "running"}},
            stats={"uploaded": 1},
        )
        res = self.client.get(f"/api/pipelines/{self.pipeline.id}/run-status/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "running")
        self.assertFalse(res.data["done"])
        self.assertEqual(res.data["nodes"]["1"]["status"], "running")

    def test_done_flag_true_on_terminal_status(self):
        PipelineRun.objects.create(pipeline=self.pipeline, status="success", nodes_state={})
        res = self.client.get(f"/api/pipelines/{self.pipeline.id}/run-status/")
        self.assertTrue(res.data["done"])

    def test_idle_when_no_run_exists(self):
        res = self.client.get(f"/api/pipelines/{self.pipeline.id}/run-status/")
        self.assertEqual(res.data["status"], "idle")
        self.assertIsNone(res.data["run_id"])

    def test_legacy_stream_endpoint_is_gone(self):
        """长连接端点必须已被移除 —— 它会让 8 个并发用户拖垮整个 API。"""
        res = self.client.get(f"/api/pipelines/{self.pipeline.id}/stream/")
        self.assertEqual(res.status_code, 404)

    def test_polling_is_not_throttled_like_writes(self):
        """轮询每 1.5 秒一次，绝不能被算进 120/hour 的写额度，否则跑一次任务就限死自己。"""
        PipelineRun.objects.create(pipeline=self.pipeline, status="running", nodes_state={})
        for _ in range(130):
            res = self.client.get(f"/api/pipelines/{self.pipeline.id}/run-status/")
            self.assertEqual(res.status_code, 200)


class EngineTests(BaseFixtures):
    def test_platform_source_failure_is_not_swallowed(self):
        """吞掉 AdapterError 会让用户看到「success（0 条）」，而真相是平台没实现。"""
        platform = make_platform(
            "strava", name="Strava", auth_type="oauth2", api_base="https://api.test"
        )
        account = PlatformAccount.objects.create(
            user=self.user, platform=platform, platform_user_id="12345"
        )
        pipeline = self.make_pipeline(source_type="strava", source_account=account)

        with self.assertRaises(AdapterError):
            TaskPlanner(pipeline).collect_activities()

    def test_sync_states_created_in_bulk_and_idempotent(self):
        pipeline = self.make_pipeline()
        activities = [self.make_activity(f"骑行 {i}") for i in range(3)]
        engine = PipelineEngine(pipeline, PipelineRun.objects.create(pipeline=pipeline))

        with self.assertNumQueries(3):  # 查平台 + 查已有组合 + 批量插入
            engine._init_sync_states(activities)

        expected = 3 * Platform.objects.filter(is_active=True).count()
        self.assertEqual(ActivitySyncState.objects.count(), expected)

        # 再跑一次不应产生重复
        engine._init_sync_states(activities)
        self.assertEqual(ActivitySyncState.objects.count(), expected)

    def test_source_platform_marked_synced(self):
        pipeline = self.make_pipeline()
        activity = self.make_activity(source_platform="mock")
        engine = PipelineEngine(pipeline, PipelineRun.objects.create(pipeline=pipeline))
        engine._init_sync_states([activity])

        state = ActivitySyncState.objects.get(activity=activity, platform=self.mock)
        self.assertEqual(state.status, "synced")

    def test_content_sync_skipped_without_source_account(self):
        """FIT 来源没有平台账号，拿不到账号类内容 —— 必须记 skipped，不是 success。"""
        pipeline = self.make_pipeline(source_type="fit", sync_content=["route"])
        engine = PipelineEngine(pipeline, PipelineRun.objects.create(pipeline=pipeline))
        engine._sync_content("route", self.account, self.mock, MockAdapter(self.account), False)

        entry = engine.stats["contents"]["route"]
        self.assertEqual(entry["status"], "skipped")
        self.assertEqual(engine.stats["skipped"], 1)
        self.assertEqual(engine.stats["failed"], 0)


class FitUploadSourceTests(BaseFixtures):
    """FIT 源上传到真实平台时，必须交出**原始文件**。

    这里锁住的是一个很容易「看起来正常」的错误：引擎曾在 source_type == "fit"
    时直接 `json.dumps(payload)` 当 FIT 上传。Mock 平台不解析文件，所以一路
    绿灯；换成 Strava 就变成 "Invalid .FIT File Header" —— 一个完全指不回源头
    的错误，用户只会以为自己导入的文件坏了。
    """

    def _prepare(self, code):
        platform = make_platform(
            code, name="Strava", auth_type="oauth2", api_base="https://api.test"
        )
        account = PlatformAccount.objects.create(
            user=self.user, platform=platform, platform_user_id="1"
        )
        pipeline = self.make_pipeline(source_type="fit", sync_content=["activity"])
        engine = PipelineEngine(pipeline, PipelineRun.objects.create(pipeline=pipeline))
        return account, platform, engine

    def test_original_bytes_are_passed_through(self):
        account, platform, engine = self._prepare("strava-a")
        activity = self.make_activity()
        ActivityFitFile.objects.create(activity=activity, data=b"REAL-FIT-BYTES", size=14)

        sent = {}

        class _Adapter:
            def check_exists(self, ts):
                return None

            def upload_fit(self, fit_data, name=""):
                sent["data"] = fit_data
                return "remote-1"

        engine._sync_activity(activity, account, platform, _Adapter(), False)
        self.assertEqual(sent["data"], b"REAL-FIT-BYTES")
        self.assertEqual(engine.stats["uploaded"], 1)

    def test_missing_file_fails_instead_of_sending_json(self):
        account, platform, engine = self._prepare("strava-b")
        activity = self.make_activity()  # 没有 ActivityFitFile

        class _Adapter:
            called = False

            def check_exists(self, ts):
                return None

            def upload_fit(self, fit_data, name=""):
                _Adapter.called = True
                return "remote-2"

        engine._sync_activity(activity, account, platform, _Adapter(), False)

        self.assertFalse(_Adapter.called, "没有原始文件时不该向真实平台上传任何东西")
        self.assertEqual(engine.stats["failed"], 1)


class FileForUploadTests(BaseFixtures):
    """没有原始文件的来源（Strava）怎么把数据交到目标平台。

    Strava 的 api/v3 不提供活动文件下载，而佳明只接收文件。中间这一环必须由
    我们合成 TCX —— 此前引擎是向**目标平台**要文件（`adapter.download_fit`），
    语义上就是错的，Strava 来源下必然失败。
    """

    def _detail(self, activity):
        from apps.activities.models import ActivityFitDetail

        return ActivityFitDetail.objects.create(
            activity=activity,
            file_name="Strava · 1",
            file_size=0,
            file_hash="",
            summary={"duration": 600, "distance_km": 5.0},
            samples=[
                {"t": 0, "distance_km": 0, "lat": 31.20, "lng": 121.40, "speed_kmh": 18.0},
                {"t": 300, "distance_km": 2.5, "lat": 31.25, "lng": 121.45, "speed_kmh": 20.0},
                {"t": 600, "distance_km": 5.0, "lat": 31.30, "lng": 121.50, "speed_kmh": 22.0},
            ],
            track=[[121.40, 31.20], [121.45, 31.25], [121.50, 31.30]],
        )

    def _target(self, code="garmin-file"):
        platform = make_platform(
            code,
            name="佳明",
            auth_type="password",
            capabilities={"upload": True},
            api_base="https://connect.garmin.com",
        )
        account = PlatformAccount.objects.create(
            user=self.user, platform=platform, platform_user_id="42"
        )
        return platform, account

    def test_tcx_is_synthesized_when_source_has_no_file(self):
        platform, account = self._target()
        pipeline = self.make_pipeline(source_type="strava", sync_content=["activity"])
        engine = PipelineEngine(pipeline, PipelineRun.objects.create(pipeline=pipeline))
        activity = self.make_activity(source_platform="strava")
        self._detail(activity)

        sent = {}

        class _Adapter:
            def check_exists(self, ts):
                return None

            def upload_fit(self, data, name=""):
                sent["data"] = data
                return "777"

        engine._sync_activity(activity, account, platform, _Adapter(), False)

        self.assertEqual(engine.stats["uploaded"], 1)
        self.assertTrue(sent["data"].startswith(b"<?xml"), "必须是一份真的 TCX")
        self.assertIn(b"<TrainingCenterDatabase", sent["data"])
        self.assertIn(b"<Trackpoint>", sent["data"])

    def test_existing_activity_counts_as_skipped_not_failed(self):
        from apps.platforms.adapters import ActivityExists

        platform, account = self._target("garmin-dup")
        pipeline = self.make_pipeline(source_type="strava", sync_content=["activity"])
        engine = PipelineEngine(pipeline, PipelineRun.objects.create(pipeline=pipeline))
        activity = self.make_activity(source_platform="strava")
        self._detail(activity)
        # 真实流程里源节点会先把矩阵单元格建好（_init_sync_states），
        # 这里补上，否则没有行可标记
        ActivitySyncState.objects.create(
            activity=activity, platform=platform, status="pending"
        )

        class _Adapter:
            def check_exists(self, ts):
                return None

            def upload_fit(self, data, name=""):
                raise ActivityExists("佳明上已经有这场活动的记录")

        engine._sync_activity(activity, account, platform, _Adapter(), False)

        state = ActivitySyncState.objects.get(activity=activity, platform=platform)
        self.assertEqual(state.status, "synced")
        self.assertEqual(engine.stats["failed"], 0)
        self.assertEqual(engine.stats["skipped"], 1)

    def test_raw_fit_still_wins_over_synthesis(self):
        platform, account = self._target("garmin-raw")
        pipeline = self.make_pipeline(source_type="strava", sync_content=["activity"])
        engine = PipelineEngine(pipeline, PipelineRun.objects.create(pipeline=pipeline))
        activity = self.make_activity(source_platform="strava")
        self._detail(activity)
        ActivityFitFile.objects.create(activity=activity, data=b"REAL-FIT", size=8)

        sent = {}

        class _Adapter:
            def check_exists(self, ts):
                return None

            def upload_fit(self, data, name=""):
                sent["data"] = data
                return "1"

        engine._sync_activity(activity, account, platform, _Adapter(), False)
        self.assertEqual(sent["data"], b"REAL-FIT", "有原始文件时不该退化成合成")
