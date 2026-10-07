"""健康检查：供容器编排（微信云托管 / K8s）探测实例就绪状态。"""
import os

from django.db import connection
from django.http import JsonResponse


def health(request):
    """GET /api/health/

    返回 200 表示进程存活且数据库可连通；数据库异常时返回 503，
    让编排系统据此把该实例摘除，避免流量打到不可用实例上。

    注意：这个接口本身**不依赖数据库**（Django 未执行任何查询也能响应），
    所以即使配置写错，它也能返回可读的诊断信息 —— 这正是排查部署问题的入口。
    """
    db_ok = True
    db_error = ""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception as exc:  # noqa: BLE001 —— 健康检查需吞掉一切异常并如实上报
        db_ok = False
        db_error = str(exc)[:300]

    payload = {
        "status": "ok" if db_ok else "degraded",
        "database": "ok" if db_ok else "error",
        # 回显非敏感配置，便于在云托管控制台直接确认「容器到底读到了什么」
        "config": {
            "engine": os.getenv("DB_ENGINE", "sqlite"),
            "host": os.getenv("DB_HOST", ""),
            "port": os.getenv("DB_PORT", ""),
            "name": os.getenv("DB_NAME", ""),
            "user": os.getenv("DB_USER", ""),
            "password_set": bool(os.getenv("DB_PASSWORD")),
            "debug": os.getenv("DJANGO_DEBUG", ""),
        },
    }
    if db_error:
        payload["detail"] = db_error
        payload["hint"] = _hint(db_error)

    return JsonResponse(payload, status=200 if db_ok else 503)


def _hint(error: str) -> str:
    """把常见数据库连接错误翻成人能看懂的一句话。"""
    low = error.lower()
    if "unknown database" in low:
        return "数据库不存在。Django 的 migrate 只建表不建库，请先手动执行 CREATE DATABASE velosync CHARACTER SET utf8mb4;"
    if "access denied" in low:
        return "账号或密码错误。请检查 DB_USER / DB_PASSWORD 是否与云托管 MySQL 一致。"
    if "connection refused" in low or "can't connect" in low or "timed out" in low:
        return "连不上数据库。请检查 DB_HOST（云托管 MySQL 的内网地址，不含端口）与 DB_PORT 是否正确，以及该 MySQL 实例是否已放行云托管服务。"
    if "no module named" in low:
        return "缺少数据库驱动（PyMySQL）。请确认 requirements.txt 已包含 PyMySQL 并重新构建镜像。"
    return "请对照 backend/DEPLOY.md 的「环境变量」一节逐项核对。"
