from django.contrib import admin

from .models import Activity, ActivitySyncState


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
