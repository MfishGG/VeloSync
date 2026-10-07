from django.contrib import admin

from .models import Activity, ActivityFitDetail, ActivitySyncState


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "start_timestamp", "activity_type", "distance", "source_platform")
    list_filter = ("activity_type", "source_platform")
    search_fields = ("name", "user__username")
    date_hierarchy = "start_timestamp"


@admin.register(ActivitySyncState)
class ActivitySyncStateAdmin(admin.ModelAdmin):
    list_display = ("activity", "platform", "status", "synced_at")
    list_filter = ("status", "platform")
    search_fields = ("activity__name",)


@admin.register(ActivityFitDetail)
class ActivityFitDetailAdmin(admin.ModelAdmin):
    list_display = ("activity", "file_name", "file_size", "parsed_at")
    search_fields = ("activity__name", "file_name", "file_hash")
    readonly_fields = ("parsed_at", "created_at")
