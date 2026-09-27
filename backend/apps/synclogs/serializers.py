from rest_framework import serializers

from .models import SyncLog


class SyncLogSerializer(serializers.ModelSerializer):
    pipeline_name = serializers.CharField(source="pipeline.name", read_only=True, default=None)
    activity_name = serializers.CharField(source="activity.name", read_only=True, default=None)

    class Meta:
        model = SyncLog
        fields = [
            "id", "level", "message", "detail", "created_at",
            "pipeline", "pipeline_name", "activity", "activity_name",
        ]
