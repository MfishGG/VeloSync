# ===== VeloSync 后端 · 微信云托管镜像 =====
# 微信云托管要求：容器监听 80 端口，无状态（重启后本地文件丢失）
FROM python:3.13-slim

# 时区与编码；保持镜像精简，只装必要系统依赖
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=Asia/Shanghai \
    LANG=C.UTF-8 \
    PORT=80

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

# 入口脚本需要可执行位（Windows 下 checkout 出来的文件默认没有 +x）
RUN chmod +x /app/docker-entrypoint.sh

# 收集静态文件（Django Admin 样式等）。DEBUG=0 时需要，缺失会导致 admin 无样式
RUN STATIC_ROOT=/app/staticfiles python manage.py collectstatic --noinput || true

# 微信云托管默认从 80 端口访问；容器内也用 80，避免映射歧义
EXPOSE 80

# 健康检查：云托管会据此判断实例是否就绪。
# start-period 给足迁移 + 首次启动的时间，避免慢启动被误判为失败。
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/api/health/" || exit 1

# 启动：入口脚本负责 迁移 → 收集静态 → 起 gunicorn。
# 关键：迁移失败时也会把 gunicorn 起起来，让 /api/health/ 返回真实错误，
# 否则云托管只会报 "connection refused"，看不到任何原因。
ENTRYPOINT ["/app/docker-entrypoint.sh"]
