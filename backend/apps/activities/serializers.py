from rest_framework import serializers

from .models import Activity, ActivityFitDetail, ActivitySyncState


class ActivityFitDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityFitDetail
        fields = [
            "id", "activity", "file_name", "file_size", "file_hash",
            "device", "summary", "samples", "track", "parsed_at", "created_at",
        ]
        read_only_fields = ["id", "parsed_at", "created_at"]


class FitHistorySerializer(serializers.ModelSerializer):
    """FIT 导入历史（列表用，刻意不含 samples / track，避免大响应）"""

    activity_id = serializers.IntegerField(source="activity.id", read_only=True)
    activity_name = serializers.CharField(source="activity.name", read_only=True)
    activity_type = serializers.CharField(source="activity.activity_type", read_only=True)
    start_timestamp = serializers.DateTimeField(source="activity.start_timestamp", read_only=True)
    distance = serializers.FloatField(source="activity.distance", read_only=True)
    duration = serializers.IntegerField(source="activity.duration", read_only=True)
    source_platform = serializers.CharField(source="activity.source_platform", read_only=True)
    sample_count = serializers.SerializerMethodField()
    track_point_count = serializers.SerializerMethodField()
    has_gps = serializers.SerializerMethodField()
    device_name = serializers.SerializerMethodField()

    class Meta:
        model = ActivityFitDetail
        fields = [
            "id", "activity_id", "activity_name", "activity_type", "start_timestamp",
            "distance", "duration", "source_platform",
            "file_name", "file_size", "file_hash", "parsed_at", "created_at",
            "sample_count", "track_point_count", "has_gps", "device_name",
        ]

    def get_sample_count(self, obj) -> int:
        return (obj.summary or {}).get("sample_count", len(obj.samples or []))

    def get_track_point_count(self, obj) -> int:
        return len(obj.track or [])

    def get_has_gps(self, obj) -> bool:
        return bool(obj.track)

    def get_device_name(self, obj) -> str:
        return (obj.device or {}).get("manufacturer") or ""


class ActivitySyncStateSerializer(serializers.ModelSerializer):
    platform_code = serializers.CharField(source="platform.code", read_only=True)
    platform_name = serializers.CharField(source="platform.name", read_only=True)

    class Meta:
        model = ActivitySyncState
        fields = [
            "id", "platform", "platform_code", "platform_name",
            "remote_activity_id", "status", "error_message", "synced_at",
        ]


class ActivitySerializer(serializers.ModelSerializer):
    sync_states = ActivitySyncStateSerializer(many=True, read_only=True)

    class Meta:
        model = Activity
        fields = [
            "id", "name", "start_timestamp", "activity_type", "duration", "distance",
            "source_platform", "source_activity_id", "fit_hash", "created_at", "sync_states",
        ]
