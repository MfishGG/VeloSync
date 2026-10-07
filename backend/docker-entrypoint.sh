#!/bin/sh
# ===== VeloSync 容器启动脚本 =====
#
# 设计原则：**无论迁移是否成功，都要让 80 端口监听起来**。
#
# 原因（微信云托管的实际行为）：容器端口没有监听时，探针只能报
#   "connection refused"，然后 "Back-off restarting failed container"，
# 控制台里看不到任何 Python 异常 —— 排障时等于盲猜。
# 而 gunicorn 一旦起来，健康检查就会返回 503 + JSON 里的真实错误，
# 云托管的「日志 / 健康检查」处能直接看到原因。
#
# 所以这里刻意不用 `set -e`，也不把 migrate 和 gunicorn 用 && 串起来。

set -u

PORT="${PORT:-80}"
WORKERS="${WEB_CONCURRENCY:-2}"
THREADS="${WEB_THREADS:-4}"

echo "=============================================="
echo "[entrypoint] 启动 VeloSync 后端"
echo "[entrypoint] 时间     : $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "[entrypoint] Python   : $(python --version 2>&1)"
echo "[entrypoint] 监听端口 : ${PORT}"
echo "[entrypoint] DB_ENGINE: ${DB_ENGINE:-<未设置，将回落 sqlite>}"
echo "[entrypoint] DB_HOST  : ${DB_HOST:-<未设置，默认 127.0.0.1>}"
echo "[entrypoint] DB_PORT  : ${DB_PORT:-<未设置，默认 3306>}"
echo "[entrypoint] DB_NAME  : ${DB_NAME:-<未设置，默认 velosync>}"
echo "[entrypoint] DB_USER  : ${DB_USER:-<未设置>}"
echo "[entrypoint] DB_PASSWORD: $([ -n "${DB_PASSWORD:-}" ] && echo '<已设置>' || echo '<未设置>')"
echo "[entrypoint] DJANGO_DEBUG: ${DJANGO_DEBUG:-<未设置，默认 1>}"
echo "[entrypoint] ALLOWED_HOSTS: ${DJANGO_ALLOWED_HOSTS:-<未设置>}"
echo "=============================================="

# ---------- 0. 环境自检：把常见配置错误提前说清楚 ----------
if [ "${DB_ENGINE:-}" != "mysql" ]; then
  echo "[entrypoint][警告] DB_ENGINE 不是 mysql（当前 '${DB_ENGINE:-空}'）。"
  echo "[entrypoint][警告] 容器是无状态的，sqlite 数据重启即丢，生产环境应设为 mysql。"
fi

if [ -n "${MYSQL_ADDRESS:-}" ] && [ -z "${DB_HOST:-}" ]; then
  echo "[entrypoint][错误] 检测到云托管的 MYSQL_ADDRESS='${MYSQL_ADDRESS}'，但 DB_HOST 未设置！"
  echo "[entrypoint][错误] 本项目读的是 DB_HOST / DB_PORT，与 MYSQL_ADDRESS 不是同一个变量。"
  echo "[entrypoint][错误] 且 MYSQL_ADDRESS 是「IP:端口」合体，必须拆成 DB_HOST=<IP> 和 DB_PORT=<端口>。"
fi

# ---------- 1. 迁移（失败不阻断启动，只记录） ----------
echo "[entrypoint] >>> 执行数据库迁移 ..."
if python manage.py migrate --noinput; then
  echo "[entrypoint] <<< 迁移完成"
  MIGRATE_OK=1
else
  MIGRATE_OK=0
  echo "[entrypoint] <<< 迁移失败！(退出码 $?)"
  echo "[entrypoint][提示] 常见原因："
  echo "[entrypoint][提示]   ① DB_HOST/DB_PORT 没填或填错（云数据库是内网地址，不含端口）"
  echo "[entrypoint][提示]   ② 数据库 '${DB_NAME:-velosync}' 还没手动创建（Django 只建表不建库）"
  echo "[entrypoint][提示]   ③ 账号密码不对，或云托管未放行该 MySQL 实例"
  echo "[entrypoint][提示] 服务仍会启动，可访问 /api/health/ 查看具体错误。"
fi

# ---------- 2. 收集静态文件（Django Admin 样式，失败不影响 API） ----------
if [ -d /app/staticfiles ] || [ "${MIGRATE_OK}" = "1" ]; then
  echo "[entrypoint] >>> 收集静态文件 ..."
  python manage.py collectstatic --noinput >/dev/null 2>&1 \
    && echo "[entrypoint] <<< 静态文件就绪" \
    || echo "[entrypoint][警告] collectstatic 失败（不影响 API，仅 Admin 样式可能缺失）"
fi

# ---------- 3. 启动 gunicorn（无论如何都要起来） ----------
echo "[entrypoint] >>> 启动 gunicorn，绑定 0.0.0.0:${PORT} ..."
if [ "${MIGRATE_OK}" = "0" ]; then
  echo "[entrypoint][提醒] 数据库不可用，接口会返回 503；修好环境变量后重新部署即可。"
fi

exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT}" \
  --workers "${WORKERS}" \
  --threads "${THREADS}" \
  --timeout 120 \
  --graceful-timeout 30 \
  --access-logfile - \
  --error-logfile - \
  --log-level info
