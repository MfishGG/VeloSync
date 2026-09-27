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
            "OPTIONS": {"charset": "utf8mb4"},
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

# ---------- 国际化 ----------
LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "Asia/Shanghai"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------- DRF ----------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        # 支持 ?access_token= 的 JWT 认证，专供 EventSource(SSE) 使用
        "apps.accounts.auth.QueryParamJWTAuthentication",
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
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

# ---------- Celery ----------
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://127.0.0.1:6379/0")
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
# 开发默认 EAGER（同步执行，无需 Redis）；生产设为 0 并启动 celery worker / beat
CELERY_TASK_ALWAYS_EAGER = os.getenv("CELERY_TASK_ALWAYS_EAGER", "1") == "1"
CELERY_BEAT_SCHEDULE = {
    # 每 5 分钟轮询开启 auto_run 的管道
    "poll-source-platforms": {
        "task": "apps.pipelines.tasks.scheduled_auto_run",
        "schedule": 300.0,
    },
}

# ---------- 安全 ----------
# 平台 Token 加密密钥（Fernet）。留空则从 SECRET_KEY 派生（仅开发用）。
TOKEN_ENCRYPTION_KEY = os.getenv("TOKEN_ENCRYPTION_KEY", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

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

SPECTACULAR_SETTINGS = {
    "TITLE": "VeloSync API",
    "DESCRIPTION": "跨平台运动数据同步中枢 —— 活动汇总 / 去重 / 分发",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}
