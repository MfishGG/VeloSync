from django.contrib import admin

from .models import Pipeline, PipelineEdge, PipelineNode, PipelineRun


class NodeInline(admin.TabularInline):
    model = PipelineNode
    extra = 0


class EdgeInline(admin.TabularInline):
    model = PipelineEdge
    extra = 0


@admin.register(Pipeline)
class PipelineAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "is_active", "auto_run", "last_run_at", "created_at")
    list_filter = ("is_active", "auto_run")
    search_fields = ("name", "user__username")
    inlines = [NodeInline, EdgeInline]


@admin.register(PipelineRun)
class PipelineRunAdmin(admin.ModelAdmin):
    list_display = ("id", "pipeline", "status", "started_at", "finished_at")
    list_filter = ("status",)
