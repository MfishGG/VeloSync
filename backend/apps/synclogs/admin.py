from django.contrib import admin

from .models import SyncLog


@admin.register(SyncLog)
class SyncLogAdmin(admin.ModelAdmin):
    list_display = ("level", "message", "user", "pipeline", "created_at")
    list_filter = ("level",)
    search_fields = ("message", "user__username")
