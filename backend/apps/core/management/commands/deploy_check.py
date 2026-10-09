"""生产部署自检：把「代码里看不出来、只能在环境变量里错」的项逐条验一遍。

用法：
    python manage.py deploy_check

退出码：有 FAIL 项时为 1，便于接进 CI 或部署流水线。

为什么需要这个命令：审查中有几项**无法从外部验证** —— 例如
`TOKEN_ENCRYPTION_KEY` 是否沿用默认派生、`DB_USER` 是不是 root。
这些错误都不会立刻报错，而是以「Token 解不开」「整库权限过大」的形式潜伏，
上线很久之后才以难以联想的方式暴露。所以给一个能在容器内一键自检的入口。
"""
from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection

from apps.platforms.crypto import key_source

#: 仓库里公开的默认值，出现即等于没有配置
DEFAULT_SECRET = "dev-insecure-secret-key-change-me"

FAIL = "FAIL"
WARN = "WARN"
OK = "OK"


class Command(BaseCommand):
    help = "检查生产环境关键配置（密钥 / 权限 / 缓存 / 执行模型）"

    def handle(self, *args, **options):
        results: list[tuple[str, str, str]] = []

        # ---- 密钥 ----
        if settings.SECRET_KEY == DEFAULT_SECRET:
            results.append(
                (
                    FAIL,
                    "DJANGO_SECRET_KEY",
                    "仍是仓库里公开的默认值。任何人都能用它签名会话 / 派生加密密钥。",
                )
            )
        else:
            results.append((OK, "DJANGO_SECRET_KEY", "已改为自定义值"))

        source = key_source()
        if source == "env":
            results.append((OK, "TOKEN_ENCRYPTION_KEY", "已显式设置"))
        elif settings.SECRET_KEY == DEFAULT_SECRET:
            results.append(
                (
                    FAIL,
                    "TOKEN_ENCRYPTION_KEY",
                    "未设置，且 SECRET_KEY 是公开默认值 → Fernet 密钥可被任何人复算，"
                    "平台 Token 等同明文存储。请立即设置 TOKEN_ENCRYPTION_KEY。",
                )
            )
        else:
            results.append(
                (
                    WARN,
                    "TOKEN_ENCRYPTION_KEY",
                    "未设置，由 SECRET_KEY 派生。可用，但轮换 SECRET_KEY 会导致所有已存 Token 解不开；"
                    "建议显式设置一个独立的 Fernet 密钥。",
                )
            )

        # ---- 运行模式 ----
        if settings.DEBUG:
            results.append((FAIL, "DJANGO_DEBUG", "为 1，生产必须为 0，否则堆栈会外泄"))
        else:
            results.append((OK, "DJANGO_DEBUG", "已关闭"))

        if "*" in settings.ALLOWED_HOSTS:
            results.append(
                (WARN, "DJANGO_ALLOWED_HOSTS", "含 *，建议收紧为实际域名")
            )
        else:
            results.append((OK, "DJANGO_ALLOWED_HOSTS", "、".join(settings.ALLOWED_HOSTS)))

        # ---- 数据库 ----
        db_user = (settings.DATABASES.get("default", {}).get("USER") or "").lower()
        if db_user == "root":
            results.append(
                (
                    WARN,
                    "DB_USER",
                    "用的是 root。建议另建账号只授予本库权限，缩小凭据泄漏后的影响面。",
                )
            )
        else:
            results.append((OK, "DB_USER", settings.DATABASES["default"].get("USER", "")))

        # ---- 缓存 ----
        cache_backend = settings.CACHES["default"]["BACKEND"]
        if "locmem" in cache_backend:
            results.append(
                (
                    WARN,
                    "CACHE_URL",
                    "使用进程内缓存：限流额度会被放大成 worker 数倍，微信 access_token 会重复获取。"
                    "多实例部署请设 CACHE_URL 指向 Redis。",
                )
            )
        else:
            results.append((OK, "CACHE_URL", cache_backend))

        # ---- 执行模型 ----
        if settings.CELERY_TASK_ALWAYS_EAGER:
            results.append(
                (
                    FAIL,
                    "CELERY_TASK_ALWAYS_EAGER",
                    "为 1，同步任务会在 HTTP 请求内执行，超时会被 gunicorn 杀掉。应设为 0 并启动 worker。",
                )
            )
        else:
            results.append((OK, "CELERY_TASK_ALWAYS_EAGER", "已关闭（走 worker 或后台线程）"))

        # ---- 健康检查详情 ----
        if getattr(settings, "HEALTH_DETAIL_TOKEN", ""):
            results.append((OK, "HEALTH_DETAIL_TOKEN", "已设置，可带 X-Health-Token 查看详情"))
        else:
            results.append(
                (WARN, "HEALTH_DETAIL_TOKEN", "未设置，/api/health/ 只回 status（故障时仍回错误原因）")
            )

        # ---- 前端回调地址 ----
        frontend = getattr(settings, "FRONTEND_URL", "")
        if frontend.startswith("https://"):
            results.append((OK, "FRONTEND_URL", frontend))
        else:
            results.append((WARN, "FRONTEND_URL", f"{frontend}（非 https，OAuth 回调会退到 http）"))

        # ---- 数据库连通与版本 ----
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT VERSION()")
                row = cursor.fetchone()
                results.append((OK, "数据库", f"连通，版本 {row[0] if row else '未知'}"))
        except Exception as exc:  # noqa: BLE001
            results.append((FAIL, "数据库", f"连不上：{exc}"))

        # ---- 输出 ----
        icon = {OK: "✓", WARN: "!", FAIL: "✗"}
        self.stdout.write("")
        for level, name, message in results:
            self.stdout.write(f"  [{icon[level]}] {level:<4} {name:<26} {message}")

        fails = sum(1 for level, _, _ in results if level == FAIL)
        warns = sum(1 for level, _, _ in results if level == WARN)
        self.stdout.write("")
        self.stdout.write(f"结果：{len(results) - fails - warns} 项通过，{warns} 项建议，{fails} 项必须修复")
        self.stdout.write("")
        if fails:
            raise SystemExit(1)
