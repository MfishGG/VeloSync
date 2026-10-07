"""健康检查：供容器编排（微信云托管 / K8s）探测实例就绪状态。"""
from django.db import connection
from django.http import JsonResponse


def health(request):
    """GET /api/health/

    返回 200 表示进程存活且数据库可连通；数据库异常时返回 503，
    让编排系统据此把该实例摘除，避免流量打到不可用实例上。
    """
    db_ok = True
    db_error = ""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception as exc:  # noqa: BLE001 —— 健康检查需吞掉一切异常并如实上报
        db_ok = False
        db_error = str(exc)[:200]

    payload = {"status": "ok" if db_ok else "degraded", "database": "ok" if db_ok else "error"}
    if db_error:
        payload["detail"] = db_error
    return JsonResponse(payload, status=200 if db_ok else 503)
