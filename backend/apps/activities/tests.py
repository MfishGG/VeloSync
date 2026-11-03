"""活动导出的回归测试（原始 FIT 下载、TCX 合成、平台拉取）。"""
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.platforms.adapters import AdapterError
from apps.platforms.models import PlatformAccount
from apps.platforms.testing import make_platform

from .models import Activity, ActivityFitDetail, ActivityFitFile
from .pull import streams_to_detail
from .tcx import build_tcx

TCX_NS = "{http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2}"

SAMPLE_STREAMS = {
    "time": [0, 30, 60, 90],
    "latlng": [[39.9, 116.4], [39.901, 116.401], [39.902, 116.402], [39.903, 116.403]],
    "distance": [0, 250, 500, 760],
    "altitude": [45.5, 46.0, 47.2, 46.8],
    "velocity_smooth": [8.0, 9.0, 8.5, 8.8],
    "heartrate": [120, 135, 142, 138],
    "cadence": [85, 88, 90, 87],
    "watts": [180, 210, 220, 205],
    "temp": [22, 22, 23, 23],
}

SAMPLE_META = {
    "start_timestamp": datetime(2026, 11, 1, 0, 0, tzinfo=dt_timezone.utc),
    "activity_type": "cycling",
    "distance": 0.76,
    "duration": 90,
    "device_name": "Garmin Edge 530",
}


class StreamsMappingTests(SimpleTestCase):
    """Strava streams → 本项目 samples/track 的换算。

    这两个换算错了不会报错，只会让轨迹跑到海里、速度差 3.6 倍，
    而且从界面上完全看不出是哪一步的问题。
    """

    def test_latlng_is_reordered_to_lng_lat(self):
        detail = streams_to_detail(SAMPLE_STREAMS, SAMPLE_META)
        # 本项目 track 约定 [lng, lat]（与 GeoJSON 一致），Strava 给的是 [lat, lng]
        self.assertEqual(detail["track"][0], [116.4, 39.9])
        self.assertEqual(detail["samples"][0]["lat"], 39.9)
        self.assertEqual(detail["samples"][0]["lng"], 116.4)

    def test_velocity_is_converted_to_kmh(self):
        detail = streams_to_detail(SAMPLE_STREAMS, SAMPLE_META)
        # 8 m/s = 28.8 km/h
        self.assertAlmostEqual(detail["samples"][0]["speed_kmh"], 28.8, places=2)

    def test_summary_matches_fit_shape(self):
        summary = streams_to_detail(SAMPLE_STREAMS, SAMPLE_META)["summary"]
        # 与 FIT 解析产出的键保持一致，前端才能共用同一套渲染
        for key in (
            "start_time", "activity_type", "distance_km", "duration",
            "avg_heart_rate", "max_heart_rate", "avg_power", "max_power",
            "avg_speed_kmh", "sample_count", "track_point_count",
            "has_gps", "metrics", "available_metrics",
        ):
            self.assertIn(key, summary)
        self.assertEqual(summary["activity_type"], "cycling")
        self.assertEqual(summary["max_heart_rate"], 142)
        self.assertEqual(summary["sample_count"], 4)
        self.assertEqual(summary["track_point_count"], 4)

    def test_missing_streams_are_tolerated(self):
        """只有时间序列也要能出结果（室内骑行没有 GPS、心率带没连上等）。"""
        detail = streams_to_detail({"time": [0, 10]}, SAMPLE_META)
        self.assertFalse(detail["summary"]["has_gps"])
        self.assertEqual(detail["track"], [])
        self.assertNotIn("heart_rate", detail["samples"][0])


class TcxExportTests(TestCase):
    """TCX 合成与导出接口。

    这是「Strava → 佳明」链路的必经环节：Strava 不给文件，Garmin 只收文件。
    """

    def setUp(self):
        self.user = User.objects.create_user("tcx", "t@example.test", "pw-12345")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.activity = Activity.objects.create(
            user=self.user,
            name="晨骑",
            start_timestamp=SAMPLE_META["start_timestamp"],
            activity_type="cycling",
            duration=90,
            distance=0.76,
            source_platform="strava",
            source_activity_id="123456",
        )

    def _add_detail(self, streams=SAMPLE_STREAMS):
        payload = streams_to_detail(streams, SAMPLE_META)
        return ActivityFitDetail.objects.create(
            activity=self.activity,
            file_name="Strava · 123456",
            summary=payload["summary"],
            samples=payload["samples"],
            track=payload["track"],
            device=payload["device"],
        )

    def _url(self, pk=None):
        return f"/api/activities/{pk or self.activity.id}/export-tcx/"

    def test_returns_well_formed_tcx(self):
        self._add_detail()

        resp = self.client.get(self._url())

        self.assertEqual(resp.status_code, 200)
        self.assertIn("tcx", resp["Content-Type"])
        root = ET.fromstring(resp.content)
        self.assertEqual(root.tag, f"{TCX_NS}TrainingCenterDatabase")
        activity_el = root.find(f"{TCX_NS}Activities/{TCX_NS}Activity")
        self.assertEqual(activity_el.get("Sport"), "Biking")
        self.assertEqual(len(root.findall(f".//{TCX_NS}Trackpoint")), 4)

    def test_trackpoint_children_follow_schema_order(self):
        """TCX 的元素顺序由 schema 固定，调换会通不过 Garmin 的校验。"""
        self._add_detail()

        root = ET.fromstring(self.client.get(self._url()).content)
        point = root.find(f".//{TCX_NS}Trackpoint")
        tags = [child.tag.replace(TCX_NS, "") for child in point]
        self.assertEqual(
            tags,
            [
                "Time",
                "Position",
                "AltitudeMeters",
                "DistanceMeters",
                "HeartRateBpm",
                "Cadence",
                "Extensions",
            ],
        )

    def test_without_detail_is_explicit(self):
        resp = self.client.get(self._url())
        self.assertEqual(resp.status_code, 409)
        self.assertIn("采样点", resp.json()["detail"])

    def test_no_timed_samples_is_rejected(self):
        ActivityFitDetail.objects.create(
            activity=self.activity,
            summary={"duration": 90},
            samples=[{"distance_km": 0.1, "lat": 39.9, "lng": 116.4}],
            track=[[116.4, 39.9]],
        )
        resp = self.client.get(self._url())
        self.assertEqual(resp.status_code, 409)

    def test_other_users_activity_is_not_reachable(self):
        self._add_detail()
        other = User.objects.create_user("other2", "o2@example.test", "pw-12345")
        c = APIClient()
        c.force_authenticate(user=other)

        self.assertEqual(c.get(self._url()).status_code, 404)

    def test_build_tcx_marks_gps_less_activity_without_position(self):
        detail = self._add_detail({"time": [0, 30], "heartrate": [120, 130], "distance": [0, 100]})
        xml = build_tcx(self.activity, detail)

        self.assertNotIn("<Position>", xml)
        self.assertIn("<HeartRateBpm><Value>120</Value></HeartRateBpm>", xml)


class FakeAdapter:
    """只实现读取能力的假适配器，用来隔离网络。"""

    def __init__(self, items, streams=None, error=None):
        self.items = items
        self.streams = streams or SAMPLE_STREAMS
        self.error = error
        self.stream_calls = 0

    def fetch_activities(self, since=None):
        if self.error:
            raise self.error
        return self.items

    def fetch_activity_streams(self, remote_id):
        self.stream_calls += 1
        return self.streams


class PullActivitiesTests(TestCase):
    """从平台账号拉取活动入库。"""

    def setUp(self):
        self.user = User.objects.create_user("puller", "p@example.test", "pw-12345")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.platform = make_platform(code="strava", name="Strava")
        self.account = PlatformAccount.objects.create(
            user=self.user,
            platform=self.platform,
            platform_user_id="athlete-1",
            display_name="测试车手",
        )

    def _items(self, count=1, start=None):
        start = start or (timezone.now() - timedelta(days=1))
        return [
            {
                "remote_id": str(1000 + i),
                "name": f"骑行 {i}",
                "start_timestamp": start - timedelta(hours=i),
                "activity_type": "cycling",
                "duration": 3600,
                "distance": 30.0,
                "fit_hash": "",
            }
            for i in range(count)
        ]

    def _pull(self, body=None):
        return self.client.post(
            "/api/activities/pull/",
            {"account_id": self.account.id, **(body or {})},
            format="json",
        )

    def test_imports_activities_and_details(self):
        adapter = FakeAdapter(self._items(2))
        with patch("apps.activities.pull.get_adapter", return_value=adapter):
            resp = self._pull({"days": 7, "detail_limit": 2})

        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data["fetched"], 2)
        self.assertEqual(data["imported"], 2)
        self.assertEqual(data["detail_imported"], 2)
        self.assertEqual(Activity.objects.filter(user=self.user).count(), 2)
        self.assertEqual(ActivityFitDetail.objects.count(), 2)
        self.assertTrue(Activity.objects.first().source_activity_id)

    def test_second_pull_does_not_duplicate(self):
        adapter = FakeAdapter(self._items(1))
        with patch("apps.activities.pull.get_adapter", return_value=adapter):
            self._pull()
            second = self._pull()

        self.assertEqual(second.json()["duplicate"], 1)
        self.assertEqual(second.json()["imported"], 0)
        self.assertEqual(Activity.objects.filter(user=self.user).count(), 1)

    def test_detail_limit_caps_stream_requests(self):
        """详情是一次 API 调用，必须受读限流约束。"""
        adapter = FakeAdapter(self._items(5))
        with patch("apps.activities.pull.get_adapter", return_value=adapter):
            resp = self._pull({"detail_limit": 2})

        self.assertEqual(resp.json()["detail_imported"], 2)
        self.assertEqual(resp.json()["detail_skipped"], 3)
        self.assertEqual(adapter.stream_calls, 2)
        self.assertEqual(ActivityFitDetail.objects.count(), 2)

    def test_platform_error_is_relayed(self):
        """限流/授权失效必须原样传出，否则用户不知道该等还是该重新授权。"""
        adapter = FakeAdapter([], error=AdapterError("Strava 读取限流（429）"))
        with patch("apps.activities.pull.get_adapter", return_value=adapter):
            resp = self._pull()

        self.assertEqual(resp.status_code, 502)
        self.assertIn("限流", resp.json()["detail"])

    def test_demo_account_is_rejected(self):
        demo = PlatformAccount.objects.create(
            user=self.user,
            platform=make_platform(code="garmin"),
            platform_user_id="demo-abc",
        )
        resp = self.client.post(
            "/api/activities/pull/", {"account_id": demo.id}, format="json"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("演示身份", resp.json()["detail"])

    def test_other_users_account_is_not_reachable(self):
        other = User.objects.create_user("other3", "o3@example.test", "pw-12345")
        c = APIClient()
        c.force_authenticate(user=other)
        resp = c.post("/api/activities/pull/", {"account_id": self.account.id}, format="json")
        self.assertEqual(resp.status_code, 404)



class ExportFitTests(TestCase):
    """导出必须吐**原始字节**。

    用解析结果重建 TCX/GPX 是个看起来更「通用」的方案，但 track 没有时间戳、
    samples 是降采样的，重建出来的文件导回任何平台都基本不可用。所以这里锁死
    「内容与存入时逐字节相同」。
    """

    def setUp(self):
        self.user = User.objects.create_user("exporter", "e@example.test", "pw-12345")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.activity = Activity.objects.create(
            user=self.user,
            name="晨骑",
            start_timestamp=timezone.now(),
            source_platform="fit",
        )

    def _url(self):
        return f"/api/activities/{self.activity.id}/export-fit/"

    def test_returns_original_bytes(self):
        ActivityFitFile.objects.create(activity=self.activity, data=b"FIT-BYTES", size=9)

        resp = self.client.get(self._url())

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content, b"FIT-BYTES")
        self.assertIn("attachment", resp["Content-Disposition"])
        # 活动名可能是中文，必须走 RFC 5987 的 filename*
        self.assertIn("filename*=UTF-8''", resp["Content-Disposition"])

    def test_missing_file_is_explicit(self):
        resp = self.client.get(self._url())
        self.assertEqual(resp.status_code, 409)
        self.assertIn("原始 FIT", resp.json()["detail"])

    def test_other_users_activity_is_not_reachable(self):
        ActivityFitFile.objects.create(activity=self.activity, data=b"X", size=1)
        other = User.objects.create_user("other", "o@example.test", "pw-12345")
        c = APIClient()
        c.force_authenticate(user=other)

        self.assertEqual(c.get(self._url()).status_code, 404)
