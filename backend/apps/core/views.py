"""健康检查：供容器编排（微信云托管 / K8s）探测实例就绪状态。"""
import os

from django.conf import settings
from django.db import connection
from django.http import JsonResponse


def health(request):
    """GET /api/health/

    返回 200 表示进程存活且数据库可连通；数据库异常时返回 503，
    让编排系统据此把该实例摘除，避免流量打到不可用实例上。

    **默认只回 status / database 两个字段。**

    早期版本会把内网 IP、数据库名、数据库账号、引擎与精确版本一并吐出来，
    而这个接口是**匿名**的（容器 HEALTHCHECK 在容器内跑，外部根本不需要），
    等于给攻击者送侦察情报。现在详细诊断信息只在以下两种情况下返回：

    - `settings.DEBUG` 为真（本地开发）；
    - 请求带 `X-Health-Token` 且与 `HEALTH_DETAIL_TOKEN` 一致（线上排障用）。

    出故障时（503）仍然附带 `detail` + `hint`，因为那时候最需要可读的线索，
    且此时实例本就不可用、不构成额外泄漏。
    """
    db_ok = True
    db_error = ""
    db_version = ""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT VERSION()")
            row = cursor.fetchone()
            db_version = str(row[0]) if row else ""
    except Exception as exc:  # noqa: BLE001 —— 健康检查需吞掉一切异常并如实上报
        db_ok = False
        db_error = str(exc)[:300]

    payload: dict = {
        "status": "ok" if db_ok else "degraded",
        "database": "ok" if db_ok else "error",
    }

    if db_error:
        # 故障时给出可读线索；这里不含凭据，只有错误文本与版本。
        payload["detail"] = db_error
        payload["hint"] = _hint(db_error, db_version)

    if _detail_allowed(request):
        payload["config"] = _config_snapshot(db_version)
        if db_error:
            payload["config"]["server_version"] = db_version

    return JsonResponse(payload, status=200 if db_ok else 503)


def _detail_allowed(request) -> bool:
    """是否允许返回详细诊断信息。"""
    if settings.DEBUG:
        return True
    expected = getattr(settings, "HEALTH_DETAIL_TOKEN", "")
    if not expected:
        return False
    return request.headers.get("X-Health-Token", "") == expected


def _config_snapshot(db_version: str = "") -> dict:
    """容器实际读到的非凭据配置，便于在控制台确认「环境变量到底生效没有」。"""
    snapshot = {
        "engine": os.getenv("DB_ENGINE", "sqlite"),
        "host": os.getenv("DB_HOST", ""),
        "port": os.getenv("DB_PORT", ""),
        "name": os.getenv("DB_NAME", ""),
        "user": os.getenv("DB_USER", ""),
        "password_set": bool(os.getenv("DB_PASSWORD")),
        "debug": os.getenv("DJANGO_DEBUG", ""),
    }
    if db_version:
        snapshot["server_version"] = db_version
    return snapshot


def _hint(error: str, server_version: str = "") -> str:
    """把常见数据库连接错误翻成人能看懂的一句话。"""
    low = error.lower()
    if "8.0.11 or later is required" in low or "notsupportederror" in low:
        return (
            f"数据库版本过低（当前 {server_version or '未知'}），Django 5.1 要求 MySQL 8.0.11+。"
            "云托管不支持 5.7 原地升级，请在控制台 MySQL 页面「销毁数据库」后"
            "重新开通并选择 8.0，再重建 velosync 库。详见 backend/DEPLOY.md。"
        )
    if "unknown database" in low:
        return "数据库不存在。Django 的 migrate 只建表不建库，请先手动执行 CREATE DATABASE velosync CHARACTER SET utf8mb4;"
    if "access denied" in low:
        return "账号或密码错误。请检查 DB_USER / DB_PASSWORD 是否与云托管 MySQL 一致。"
    if "connection refused" in low or "can't connect" in low or "timed out" in low:
        return "连不上数据库。请检查 DB_HOST（云托管 MySQL 的内网地址，不含端口）与 DB_PORT 是否正确，以及该 MySQL 实例是否已放行云托管服务。"
    if "no module named" in low:
        return "缺少数据库驱动（PyMySQL）。请确认 requirements.txt 已包含 PyMySQL 并重新构建镜像。"
    return "请对照 backend/DEPLOY.md 的「环境变量」一节逐项核对。"
