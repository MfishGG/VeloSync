from rest_framework import serializers

from .models import Activity, ActivitySyncState


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
