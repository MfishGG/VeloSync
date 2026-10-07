"""VeloSync URL 总路由。"""
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.core.views import health

urlpatterns = [
    path("admin/", admin.site.urls),
    # 健康检查（容器编排探测用，无需认证）
    path("api/health/", health, name="health"),
    # 认证
    path("api/auth/", include("apps.accounts.urls")),
    # 平台与账号（/api/platforms/ + /api/accounts/...）
    path("api/", include("apps.platforms.urls")),
    # 管道
    path("api/pipelines/", include("apps.pipelines.urls")),
    # 活动与矩阵
    path("api/activities/", include("apps.activities.urls")),
    # 同步日志
    path("api/logs/", include("apps.synclogs.urls")),
    # 仪表盘统计
    path("api/dashboard/", include("apps.dashboard.urls")),
    # OpenAPI
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]
