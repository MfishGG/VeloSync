from rest_framework import serializers

from apps.platforms.serializers import PlatformAccountSerializer

from .models import Pipeline, PipelineEdge, PipelineNode, PipelineRun


class PipelineNodeSerializer(serializers.ModelSerializer):
    account_detail = PlatformAccountSerializer(source="account", read_only=True)

    class Meta:
        model = PipelineNode
        fields = ["id", "node_type", "account", "account_detail", "config", "position_x", "position_y"]


class PipelineEdgeSerializer(serializers.ModelSerializer):
    source = serializers.IntegerField(source="source_node_id", read_only=True)
    target = serializers.IntegerField(source="target_node_id", read_only=True)

    class Meta:
        model = PipelineEdge
        fields = ["id", "source", "target"]


class PipelineListSerializer(serializers.ModelSerializer):
    node_count = serializers.SerializerMethodField()
    last_run_status = serializers.SerializerMethodField()

    class Meta:
        model = Pipeline
        fields = [
            "id", "name", "description", "is_active", "auto_run",
            "last_run_at", "created_at", "node_count", "last_run_status",
        ]

    def get_node_count(self, obj) -> int:
        return obj.nodes.count()

    def get_last_run_status(self, obj):
        run = obj.runs.first()
        return run.status if run else None


class PipelineDetailSerializer(serializers.ModelSerializer):
    nodes = PipelineNodeSerializer(many=True, read_only=True)
    edges = PipelineEdgeSerializer(many=True, read_only=True)

    class Meta:
        model = Pipeline
        fields = [
            "id", "name", "description", "is_active", "auto_run",
            "last_run_at", "created_at", "nodes", "edges",
        ]


class RunStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = PipelineRun
        fields = ["id", "status", "nodes_state", "started_at", "finished_at"]
