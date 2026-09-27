from django.apps import AppConfig


class SynclogsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.synclogs"
    verbose_name = "同步日志"
