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
# 同一个镜像承担三种角色：web（默认）/ worker / beat。
# 云托管上分别建三个服务、同一个镜像，靠环境变量区分即可 ——
# 这样不必为异步执行再维护第二套构建。
RUN_MODE="${RUN_MODE:-web}"

echo "=============================================="
echo "[entrypoint] 启动 VeloSync 后端（RUN_MODE=${RUN_MODE}）"
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
echo "[entrypoint] TOKEN_ENCRYPTION_KEY: $([ -n "${TOKEN_ENCRYPTION_KEY:-}" ] && echo '<已设置>' || echo '<未设置>')"
echo "[entrypoint] HEALTH_DETAIL_TOKEN: $([ -n "${HEALTH_DETAIL_TOKEN:-}" ] && echo '<已设置>' || echo '<未设置>')"
echo "[entrypoint] CACHE_URL: $([ -n "${CACHE_URL:-}" ] && echo '<已设置>' || echo '<未设置，用进程内缓存>')"
echo "[entrypoint] CELERY_BROKER_URL: ${CELERY_BROKER_URL:-<未设置，默认 redis://127.0.0.1:6379/0>}"
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

# 最小权限：应用不该用 root 连库。ORM 让注入概率很低，但凭据一旦泄漏
# （例如密钥沿用默认值），root 意味着整实例沦陷而不是单库受限。
if [ "${DB_USER:-}" = "root" ]; then
  echo "[entrypoint][警告] DB_USER=root，应用正在以 MySQL 最高权限连接。"
  echo "[entrypoint][警告] 建议另建账号（如 velosync），只授予本库的 CRUD/DDL 权限。"
fi

# 加密密钥如果沿用默认值，Fernet 密钥可由仓库里公开的 SECRET_KEY 派生出来，
# 数据库里的平台 Token 等于明文。这里只提示，不在日志里打印密钥本身。
if [ -z "${TOKEN_ENCRYPTION_KEY:-}" ]; then
  echo "[entrypoint][警告] TOKEN_ENCRYPTION_KEY 未设置，平台 Token 将用由 SECRET_KEY 派生的密钥加密。"
  echo "[entrypoint][警告] 若 DJANGO_SECRET_KEY 也是默认值，则任何人都能复算出该密钥。"
  echo "[entrypoint][警告] 请执行 python manage.py deploy_check 自查。"
fi

# ---------- 0.4 beat 模式：只做定时调度，不迁移、不收集静态 ----------
if [ "${RUN_MODE}" = "beat" ]; then
  echo "[entrypoint] >>> 以 beat 模式启动（只负责定时投递，不处理请求）"
  exec celery -A config beat --loglevel=info
fi

# ---------- 0.5 数据库版本预检 ----------
# Django 5.1 的 MySQL 后端要求 8.0.11+。云托管默认给的可能是 5.7，
# 若不提前拦下，等到 migrate 时会抛一长串 traceback，最后一行才是
# "MySQL 8.0.11 or later is required (found 5.7.x)" —— 容易被淹没。
# 这里用一条 SQL 先探版本，命中就给出可操作的结论并直接退出（不必再跑 migration）。
if [ "${DB_ENGINE:-}" = "mysql" ]; then
  echo "[entrypoint] >>> 预检数据库版本 ..."
  DB_VER="$(python - <<'PYEOF' 2>/dev/null || true
import os, sys
try:
    import pymysql
    conn = pymysql.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "velosync"),
        password=os.getenv("DB_PASSWORD", ""),
        connect_timeout=8,
    )
    with conn.cursor() as cur:
        cur.execute("SELECT VERSION()")
        print(cur.fetchone()[0])
    conn.close()
except Exception:
    sys.exit(0)
PYEOF
)"
  if [ -n "${DB_VER}" ]; then
    echo "[entrypoint] 数据库版本：${DB_VER}"
    # 取出主次版本号，与 Django 要求的 8.0.11 比较
    case "${DB_VER}" in
      5.*|4.*|3.*|1.*|2.*)
        echo ""
        echo "[entrypoint][错误] ================================================"
        echo "[entrypoint][错误] 数据库版本过低：${DB_VER}"
        echo "[entrypoint][错误] Django 5.1 要求 MySQL 8.0.11 或更高，当前是 ${DB_VER}。"
        echo "[entrypoint][错误]"
        echo "[entrypoint][错误] 好消息：连接配置（DB_HOST/DB_PORT/账号密码）是对的，"
        echo "[entrypoint][错误] 否则根本读不到版本号。问题只在数据库版本。"
        echo "[entrypoint][错误]"
        echo "[entrypoint][错误] 解法：微信云托管「不支持 5.7 原地升级到 8.0」，"
        echo "[entrypoint][错误]       需在控制台 MySQL 页面点右上角「销毁数据库」，"
        echo "[entrypoint][错误]       重新开通时版本选 8.0，然后重建 velosync 库。"
        echo "[entrypoint][错误]       详见 backend/DEPLOY.md「常见问题」。"
        echo "[entrypoint][错误] ================================================"
        echo ""
        echo "[entrypoint] gunicorn 仍会启动，可访问 /api/health/ 确认诊断信息。"
        ;;
      *)
        echo "[entrypoint] 版本满足要求（>= 8.0）。"
        ;;
    esac
  else
    echo "[entrypoint][警告] 无法读取数据库版本（可能连不上）。继续尝试迁移，失败时见下方提示。"
  fi
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
  echo "[entrypoint][提示]      —— 注意：销毁重开数据库后内网 IP 会变，务必同步更新 DB_HOST"
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

# ---------- 3. 启动进程：web（gunicorn）或 worker（celery） ----------
if [ "${RUN_MODE}" = "worker" ]; then
  echo "[entrypoint] >>> 以 worker 模式启动 celery（并发 ${CELERY_CONCURRENCY:-2}）"
  exec celery -A config worker \
    --loglevel=info \
    --concurrency="${CELERY_CONCURRENCY:-2}"
fi

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
  --log-level info \
  --access-logformat '%(h)s %(l)s %(u)s %(t)s "%(m)s %(U)s %(H)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)sus'
