from rest_framework import serializers

from apps.activities.models import ActivityFitDetail
from apps.platforms.models import PlatformAccount
from apps.platforms.serializers import PlatformAccountSerializer

from .models import Pipeline, PipelineEdge, PipelineNode, PipelineRun
from .spec import (
    SOURCE_SPECS,
    content_label,
    normalize_contents,
    normalize_options,
    normalize_time_range,
    source_label,
)


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


class _SyncTaskFieldsMixin:
    """同步任务结构化字段的读写（写入时按 spec 规范化）。"""

    source_type = serializers.ChoiceField(
        choices=[c["code"] for c in SOURCE_SPECS], required=False
    )
    source_account = serializers.PrimaryKeyRelatedField(
        queryset=PlatformAccount.objects.all(), required=False, allow_null=True
    )
    source_fit_detail = serializers.PrimaryKeyRelatedField(
        queryset=ActivityFitDetail.objects.all(), required=False, allow_null=True
    )
    target_accounts = serializers.PrimaryKeyRelatedField(
        queryset=PlatformAccount.objects.all(), many=True, required=False
    )
    sync_content = serializers.ListField(child=serializers.CharField(), required=False)
    time_range = serializers.DictField(required=False)
    options = serializers.DictField(required=False)


class SyncTaskConfigSerializer(_SyncTaskFieldsMixin, serializers.ModelSerializer):
    """结构化同步配置的读写序列化器（含可读的展示字段）。"""

    source_label = serializers.SerializerMethodField()
    content_labels = serializers.SerializerMethodField()
    target_accounts_detail = PlatformAccountSerializer(source="target_accounts", many=True, read_only=True)
    source_account_detail = PlatformAccountSerializer(source="source_account", read_only=True)
    source_fit_name = serializers.SerializerMethodField()
    time_summary = serializers.SerializerMethodField()

    class Meta:
        model = Pipeline
        fields = [
            "id", "name", "description", "is_active", "auto_run",
            "source_type", "source_label", "source_account", "source_account_detail",
            "source_fit_detail", "source_fit_name",
            "target_accounts", "target_accounts_detail",
            "sync_content", "content_labels", "time_range", "time_summary", "options",
        ]

    def get_source_label(self, obj) -> str:
        return source_label(obj.source_type)

    def get_content_labels(self, obj) -> list[str]:
        return [content_label(k) for k in (obj.sync_content or [])]

    def get_source_fit_name(self, obj):
        if not obj.source_fit_detail_id:
            return None
        detail = obj.source_fit_detail
        return detail.file_name or f"活动 #{detail.activity_id}"

    def get_time_summary(self, obj) -> str:
        tr = obj.time_range or {}
        mode = tr.get("mode") or "file"
        if mode == "file":
            return "FIT 文件完整时间范围"
        if mode == "all":
            return "全部时间"
        if mode == "recent":
            return f"最近 {tr.get('days') or 30} 天"
        start, end = tr.get("start"), tr.get("end")
        if start or end:
            return f"{start or '不限'} ~ {end or '不限'}"
        return "自定义区间"

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)

        source_type = attrs.get("source_type", getattr(self.instance, "source_type", "fit"))
        if "sync_content" in attrs:
            attrs["sync_content"] = normalize_contents(source_type, attrs["sync_content"])
        if "time_range" in attrs:
            attrs["time_range"] = normalize_time_range(source_type, attrs["time_range"])
        if "options" in attrs:
            attrs["options"] = normalize_options(attrs["options"])

        if user is not None and user.is_authenticated:
            account = attrs.get("source_account")
            if account is not None and account.user_id != user.id:
                raise serializers.ValidationError({"source_account": "只能选择自己绑定的平台账号"})
            for acc in attrs.get("target_accounts") or []:
                if acc.user_id != user.id:
                    raise serializers.ValidationError({"target_accounts": "只能选择自己绑定的平台账号"})
            detail = attrs.get("source_fit_detail")
            if detail is not None and detail.activity.user_id != user.id:
                raise serializers.ValidationError({"source_fit_detail": "只能选择自己的 FIT 记录"})
        return attrs


class PipelineListSerializer(serializers.ModelSerializer):
    node_count = serializers.SerializerMethodField()
    last_run_status = serializers.SerializerMethodField()
    source_type = serializers.CharField(read_only=True)
    source_label = serializers.SerializerMethodField()
    content_labels = serializers.SerializerMethodField()
    target_count = serializers.SerializerMethodField()
    target_summary = serializers.SerializerMethodField()
    time_summary = serializers.SerializerMethodField()

    class Meta:
        model = Pipeline
        fields = [
            "id", "name", "description", "is_active", "auto_run",
            "last_run_at", "created_at", "node_count", "last_run_status",
            "source_type", "source_label", "content_labels",
            "target_count", "target_summary", "time_summary",
        ]

    def get_node_count(self, obj) -> int:
        return obj.nodes.count()

    def get_last_run_status(self, obj):
        run = obj.runs.first()
        return run.status if run else None

    def get_source_label(self, obj) -> str:
        return source_label(obj.source_type)

    def get_content_labels(self, obj) -> list[str]:
        return [content_label(k) for k in (obj.sync_content or [])]

    def get_target_count(self, obj) -> int:
        return obj.target_accounts.count()

    def get_target_summary(self, obj) -> str:
        names = [
            f"{a.platform.name}·{a.display_name or a.platform_user_id}"
            for a in obj.target_accounts.select_related("platform")[:3]
        ]
        total = obj.target_accounts.count()
        if total > len(names):
            names.append(f"等 {total} 个")
        return "、".join(names)

    def get_time_summary(self, obj) -> str:
        return SyncTaskConfigSerializer.get_time_summary(self, obj)


class PipelineDetailSerializer(SyncTaskConfigSerializer):
    nodes = PipelineNodeSerializer(many=True, read_only=True)
    edges = PipelineEdgeSerializer(many=True, read_only=True)

    class Meta(SyncTaskConfigSerializer.Meta):
        fields = SyncTaskConfigSerializer.Meta.fields + ["last_run_at", "created_at", "nodes", "edges"]


class RunStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = PipelineRun
        fields = ["id", "status", "nodes_state", "stats", "started_at", "finished_at"]
