"""
VeloSync（速同）· Django 配置
跨平台运动数据同步中枢 —— React 工作台 + DRF + MySQL/SQLite + Celery
"""
import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

# ---------- 基础 ----------
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "dev-insecure-secret-key-change-me")
DEBUG = os.getenv("DJANGO_DEBUG", "1") == "1"
ALLOWED_HOSTS = [h.strip() for h in os.getenv("DJANGO_ALLOWED_HOSTS", "*").split(",") if h.strip()]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # 第三方
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    # 业务
    "apps.core",
    "apps.accounts",
    "apps.platforms",
    "apps.pipelines",
    "apps.activities",
    "apps.synclogs",
    "apps.dashboard",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# ---------- 数据库（默认 SQLite 便于开发，生产切换 MySQL 8）----------
DB_ENGINE = os.getenv("DB_ENGINE", "sqlite").lower()

if DB_ENGINE == "mysql":
    import pymysql

    pymysql.version_info = (1, 4, 6, "final", 0)  # 兼容 Django 对 mysqlclient 的版本检查
    pymysql.install_as_MySQLdb()
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.mysql",
            "NAME": os.getenv("DB_NAME", "velosync"),
            "USER": os.getenv("DB_USER", "velosync"),
            "PASSWORD": os.getenv("DB_PASSWORD", "velosync"),
            "HOST": os.getenv("DB_HOST", "127.0.0.1"),
            "PORT": os.getenv("DB_PORT", "3306"),
            "OPTIONS": {
                "charset": "utf8mb4",
                # 云数据库会在空闲后主动断开连接；开启 ping 重连，避免
                # "MySQL server has gone away"。配合下面的 CONN_MAX_AGE 使用。
                "init_command": "SET sql_mode='STRICT_TRANS_TABLES'",
            },
            # 复用连接降低握手开销；云托管 MySQL 侧需配合 wait_timeout
            "CONN_MAX_AGE": int(os.getenv("DB_CONN_MAX_AGE", "60")),
            "CONN_HEALTH_CHECKS": True,
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ---------- Django Admin 登录跳转 ----------
# 默认的 /accounts/profile/ 在本项目里是前端路由（React 的 /accounts），
# 直接访问会被前端兜底路由送回主页，所以统一指到 admin 自身。
LOGIN_URL = "/admin/login/"
LOGIN_REDIRECT_URL = "/admin/"
LOGOUT_REDIRECT_URL = "/admin/login/"

# ---------- 国际化 ----------
LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "Asia/Shanghai"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
# collectstatic 的落盘目录：生产容器（微信云托管）由 Dockerfile 指定 STATIC_ROOT 并执行收集
STATIC_ROOT = os.getenv("STATIC_ROOT", str(BASE_DIR / "staticfiles"))
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------- DRF ----------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        # 注意：**不**在这里注册 QueryParamJWTAuthentication。
        # 它会把「URL 里的 access_token」当成对所有接口都有效的凭据，
        # 而 URL 会进 gunicorn 访问日志 —— 等于把 JWT 写进日志系统。
        # 现在只由需要它的视图（PipelineViewSet.get_authenticators）按需挂载，
        # 且仅在 DEBUG 下生效（见 apps/accounts/auth.py）。
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    # 限流：ScopedRateThrottle 只对显式声明了 throttle_scope 的视图生效，
    # 因此挂成默认值不会误伤其它接口。
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {
        # 账密登录与注册是撞库/批量注册的主要入口
        "login": os.getenv("THROTTLE_LOGIN", "10/min"),
        "register": os.getenv("THROTTLE_REGISTER", "5/hour"),
        # 每次调用都要去微信换手机号，会消耗接口额度
        "phone": os.getenv("THROTTLE_PHONE", "10/hour"),
        "profile": os.getenv("THROTTLE_PROFILE", "30/hour"),
        # 试运行预览/运行任务：都要查库拉数据，给个宽松但有上限的额度
        "write": os.getenv("THROTTLE_WRITE", "120/hour"),
        "anon": os.getenv("THROTTLE_ANON", "60/min"),
        "user": os.getenv("THROTTLE_USER", "600/min"),
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=2),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# ---------- CORS ----------
CORS_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]

# ---------- CSRF ----------
# 前端 dev server(5173) 会把 /admin 代理到后端，浏览器带的 Origin 仍是 5173，
# 必须在此登记，否则 Django Admin 登录 POST 会 403 “Origin checking failed”。
CSRF_TRUSTED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CSRF_TRUSTED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000",
    ).split(",")
    if o.strip()
]

# ---------- 缓存 ----------
# 限流、微信 access_token、OAuth state 一次性校验都依赖缓存。
# 默认 LocMemCache 是**进程内**缓存：多 worker 时各进程各算一份，
# 限流额度会被放大成 N 倍、access_token 会重复获取。规模上来后请设
# CACHE_URL（需 redis 包）换成共享缓存。
CACHE_URL = os.getenv("CACHE_URL", "")
if CACHE_URL:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": CACHE_URL,
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "velosync-locmem",
        }
    }

# ---------- Celery ----------
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://127.0.0.1:6379/0")
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
# 默认 **0**：不要把同步任务放在 HTTP 请求里同步执行。
# gunicorn 的 --timeout 120 到点会直接杀掉 worker，响应永不返回，
# PipelineRun 永久停在 running。生产请起 celery worker（+ beat 跑定时轮询）；
# 没起 worker 时 dispatch_run 会自动回退到后台线程，至少不会阻塞请求。
CELERY_TASK_ALWAYS_EAGER = os.getenv("CELERY_TASK_ALWAYS_EAGER", "0") == "1"
# 单次同步的硬上限：即便平台侧卡住，也不至于让一个 run 永远挂着
CELERY_TASK_TIME_LIMIT = int(os.getenv("CELERY_TASK_TIME_LIMIT", "1800"))
CELERY_TASK_SOFT_TIME_LIMIT = int(os.getenv("CELERY_TASK_SOFT_TIME_LIMIT", "1500"))
CELERY_BEAT_SCHEDULE = {
    # 每 5 分钟轮询开启 auto_run 的管道（需要运行 celery beat 才生效）
    "poll-source-platforms": {
        "task": "apps.pipelines.tasks.scheduled_auto_run",
        "schedule": 300.0,
    },
    # 每 10 分钟回收卡在 running 的僵尸运行记录
    "reap-stale-runs": {
        "task": "apps.pipelines.tasks.reap_stale_runs",
        "schedule": 600.0,
    },
}

# ---------- 安全 ----------
# 平台 Token 加密密钥（Fernet）。留空则从 SECRET_KEY 派生（仅开发用）。
TOKEN_ENCRYPTION_KEY = os.getenv("TOKEN_ENCRYPTION_KEY", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
# 平台 OAuth 回调的固定基址。各平台要求 redirect_uri 与后台登记值**逐字匹配**，
# 显式配置比每次靠请求头推导可靠。留空则用 request.build_absolute_uri()。
PLATFORM_REDIRECT_BASE_URL = os.getenv("PLATFORM_REDIRECT_BASE_URL", "")

# 云托管在负载均衡层终止 TLS，转发到容器是明文 HTTP。
# 不声明这两项的话 request.scheme 恒为 http，
# request.build_absolute_uri() 会生成 http:// 的 redirect_uri ——
# 各平台都要求 HTTPS 且逐字匹配，真实 OAuth 必然失败。
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True

# /api/health/ 的详细诊断信息（内网 IP、库名、账号、版本）默认不外泄，
# 只有带这个 token 的请求或 DEBUG 模式才返回。留空 = 仅 DEBUG 可见。
HEALTH_DETAIL_TOKEN = os.getenv("HEALTH_DETAIL_TOKEN", "")

# 单个运行的存活上限（分钟）。超过则被 reap_stale_runs 判定为僵尸并置为 error。
PIPELINE_RUN_TIMEOUT_MINUTES = int(os.getenv("PIPELINE_RUN_TIMEOUT_MINUTES", "30"))

# ---------- 第三方快捷登录（微信 / QQ / 微博）----------
# 填入 app_id / app_secret 即走真实 OAuth2；留空时为演示（mock）模式，仍可一键登录注册体验流程。
SOCIAL_AUTH_PROVIDERS = {
    "wechat": {
        "name": "微信",
        "app_id": os.getenv("WECHAT_APP_ID", ""),
        "app_secret": os.getenv("WECHAT_APP_SECRET", ""),
        "scope": "snsapi_login",
    },
    "qq": {
        "name": "QQ",
        "app_id": os.getenv("QQ_APP_ID", ""),
        "app_secret": os.getenv("QQ_APP_SECRET", ""),
        "scope": "get_user_info",
    },
    "weibo": {
        "name": "微博",
        "app_id": os.getenv("WEIBO_APP_ID", ""),
        "app_secret": os.getenv("WEIBO_APP_SECRET", ""),
    },
}
# 第三方回调的后端基址（真实 OAuth 时须为平台登记的公网域名）
SOCIAL_REDIRECT_BASE_URL = os.getenv("SOCIAL_REDIRECT_BASE_URL", "http://127.0.0.1:8000")

# ---------- 微信小程序登录 ----------
# 小程序用 wx.login() 拿 code，后端用 code2session 换 openid。
# 两个都留空时自动降级为「演示身份」登录（用客户端提供的稳定 device id 生成 openid），
# 便于在没有小程序 AppID 的情况下先跑通整条链路。
WECHAT_MINIPROGRAM = {
    "app_id": os.getenv("WECHAT_MP_APP_ID", ""),
    "app_secret": os.getenv("WECHAT_MP_APP_SECRET", ""),
}

SPECTACULAR_SETTINGS = {
    "TITLE": "VeloSync API",
    "DESCRIPTION": "跨平台运动数据同步中枢 —— 活动汇总 / 去重 / 分发",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    # drf-spectacular 的 Schema/Swagger 视图默认是 AllowAny（显式覆盖，绕过全局
    # IsAuthenticated），本机实测 /api/schema/ 匿名可拿到全部 34 个接口的清单。
    # 这本身不是漏洞，但等于把完整攻击面地图公开，配合其它信息就是有效的侦察跳板。
    "SERVE_PERMISSIONS": ["rest_framework.permissions.IsAdminUser"],
    "SERVE_AUTHENTICATION": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
}
