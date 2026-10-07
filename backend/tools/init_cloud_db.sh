#!/usr/bin/env bash
# ===== VeloSync 云托管数据库初始化 =====
# 用途：在云托管 MySQL 上建库、建表（迁移），可选导入本地数据。
# 用法：
#   1. 在云托管控制台的 WebShell 里执行（容器内已有 Python 环境）；
#   2. 或在本地对远程库执行（需先 export 下面的变量）。
#
# 注意：容器启动时已自动执行 migrate，本脚本主要用于「手动补做迁移」或「灌数据」。

set -euo pipefail

: "${DB_NAME:=velosync}"
: "${DB_USER:?需要设置 DB_USER}"
: "${DB_PASSWORD:?需要设置 DB_PASSWORD}"
: "${DB_HOST:?需要设置 DB_HOST（云托管内网地址）}"
: "${DB_PORT:=3306}"

echo "==> 目标数据库：${DB_HOST}:${DB_PORT}/${DB_NAME}"

# 1. 建库（若不存在）。utf8mb4 以完整支持中文与 emoji
echo "==> 检查 / 创建数据库"
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" \
  -e "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2. 执行迁移
echo "==> 执行 Django 迁移"
python manage.py migrate --noinput

# 3. 可选：创建超级用户（交互式，按需取消注释）
# echo "==> 创建超级用户"
# python manage.py createsuperuser

# 4. 可选：写入演示数据（仅在全新环境需要，会覆盖同名演示账号）
# echo "==> 写入演示数据"
# python manage.py seed_demo

echo "==> 完成。可用以下命令验证："
echo "    python manage.py showmigrations | tail"
