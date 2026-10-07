# ===== VeloSync 后端 · 微信云托管镜像 =====
# 微信云托管要求：容器监听 80 端口，无状态（重启后本地文件丢失）
FROM python:3.13-slim

# 时区与编码；libpq 之外的编译依赖尽量不装，保持镜像精简
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=Asia/Shanghai \
    LANG=C.UTF-8

WORKDIR /app

# 系统依赖：curl 供健康检查，tzdata 供时区
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl tzdata \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

# 先装依赖，利用 Docker 层缓存：requirements 不变时无需重装
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# 再拷代码
COPY . .

# 收集静态文件（Django Admin 样式等）。DEBUG=0 时需要，缺失会导致 admin 无样式
RUN STATIC_ROOT=/app/staticfiles python manage.py collectstatic --noinput || true

# 微信云托管默认从 80 端口访问；容器内也用 80，避免映射歧义
EXPOSE 80

# 健康检查：云托管会据此判断实例是否就绪
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://127.0.0.1:80/api/health/ || exit 1

# 启动：先迁移再拉起 gunicorn。
# 单容器单进程模型下，迁移放这里最简单；多实例时建议改为独立执行一次。
CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn config.wsgi:application --bind 0.0.0.0:80 --workers 2 --threads 4 --timeout 120 --access-logfile - --error-logfile -"]
