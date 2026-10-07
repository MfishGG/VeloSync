# VeloSync 后端 · 微信云托管部署指南

把 Django 后端部署到**微信云托管**，让小程序端可以正式访问（走 HTTPS，无需本地 dev server）。

云托管本质是「给你一个跑 Docker 容器的托管环境」，并自动分配 HTTPS 域名。部署完成后你把该域名登记到小程序后台的「request 合法域名」，真机就能访问了。

---

## 一、前置条件

| 项 | 说明 |
|---|---|
| 微信云托管已开通 | 你已完成 |
| 代码在 GitHub | 仓库：`git@github.com:MfishGG/VeloSync.git`，分支 `master` |
| 后端已容器化 | 仓库内已有 `backend/Dockerfile`（本次新增），容器监听 **80** 端口 |
| 数据库 | 用云托管自带的 MySQL（控制台一键开通） |

> **不需要** Redis：项目 `CELERY_TASK_ALWAYS_EAGER` 默认 `1`（任务同步执行），容器进程内完成，无需 broker。
> **不需要**对象存储：当前无持久化上传文件（FIT 解析后即入库）。

---

## 二、部署步骤

### 0. 如果你当初是用「官方模板」建的服务

云托管新建服务时会引导你选模板，若选了 `WeixinCloud/wxcloudrun-django` 之类的官方示例，
那么**服务里跑的是模板自带的演示代码（那个 `/api/count` 计数器），不是本项目**。
屏幕上显示的 `wx.cloud.callContainer({...})` 也是模板的前端示例，本项目**不需要**。

改法：进入服务的「代码源 / 构建配置」，把代码源改掉：

| 配置项 | 改成 |
|---|---|
| 代码源 | GitHub → `MfishGG/VeloSync` |
| 分支 | `master` |
| **构建目录** | **`backend`** |
| Dockerfile 路径 | `Dockerfile` |
| 端口 | `80` |

保存后重新部署即可。**域名不会变**（域名绑定在服务上，与代码源无关），
所以之前拿到的 `https://xxx.sh.run.tcloudbase.com` 可以继续用。

> 若不想改现有服务，也可以直接新建一个服务、选「代码仓库」而非模板。

### 1. 创建服务（全新）

控制台 → **云托管** → 新建服务，填写：

| 配置项 | 填写值 |
|---|---|
| 服务名称 | `velosync-api` |
| 部署方式 | **代码仓库（GitHub）**，不要选模板 |
| 仓库 | `MfishGG/VeloSync` |
| 分支 | `master` |
| **构建目录** | `backend` ← 关键，Dockerfile 在这个子目录 |
| Dockerfile 路径 | `Dockerfile` |
| 端口 | `80` |
| 最小实例数 | `0`（省钱；有请求才拉起，冷启动约 3~5 秒）|

### 2. 开通 MySQL 并取连接信息

控制台 → **云托管 → MySQL**（或「云数据库」）→ 新建实例，记录以下四项：

- 内网地址（形如 `sh-xxx.sql.tencentcdb.com`，或内网 IP 如 `10.3.101.119`）
- 端口（通常 `3306`）
- 用户名（通常 `root`）
- 密码

同时创建一个库：`velosync`（字符集选 `utf8mb4`）：

```sql
CREATE DATABASE IF NOT EXISTS velosync
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

> ⚠️ **库必须先手动创建**。Django 的 `migrate` 只能建表，不能建库；库不存在时容器启动会在
> `migrate` 阶段报 `Unknown database 'velosync'`，健康检查失败、部署回滚。表结构则由容器自动建立。

> ⚠️ **变量名易错点**：云托管开通 MySQL 后会默认注入一批变量，形如：
> ```json
> { "MYSQL_ADDRESS": "10.3.101.119:3306", "MYSQL_USERNAME": "root", "MYSQL_PASSWORD": "xxx" }
> ```
> 那是**模板的命名**，本项目代码并不读取它们（`settings.py` 读的是 `DB_*`）。
> 而且 `MYSQL_ADDRESS` 把 **IP 与端口合在一起**，与本项目 `DB_HOST` / `DB_PORT` 分离的写法不同，
> **必须拆开重填**，否则连不上库（会拿默认值 `127.0.0.1` 去连，报 Connection refused）。

### 3. 配置环境变量

在服务的「高级设置 → 环境变量」中填入。**推荐直接用 JSON 模式整段替换**：

```json
{
  "DJANGO_SECRET_KEY": "<随机长字符串，务必换掉>",
  "DJANGO_DEBUG": "0",
  "DJANGO_ALLOWED_HOSTS": "*",
  "DB_ENGINE": "mysql",
  "DB_NAME": "velosync",
  "DB_USER": "root",
  "DB_PASSWORD": "<云托管 MySQL 密码>",
  "DB_HOST": "<云托管 MySQL 内网地址，不含端口>",
  "DB_PORT": "3306",
  "CELERY_TASK_ALWAYS_EAGER": "1",
  "WECHAT_MP_APP_ID": "wxd12e39be6f29d81e",
  "WECHAT_MP_APP_SECRET": "<你的小程序 AppSecret>",
  "TOKEN_ENCRYPTION_KEY": "<Fernet key>"
}
```

> 云托管默认注入的 `MYSQL_*` / `COS_*` 变量**无需保留**——项目不读它们。

关于两个需要自行生成的密钥：

- **`DJANGO_SECRET_KEY`**：本地 `.env` 里那个 `dev-insecure-...` 绝不能用于生产。生成新的：
  ```bash
  python -c "from django.core.management.utils import get_random_secret_key as k; print(k())"
  ```
- **`TOKEN_ENCRYPTION_KEY`**：用于加密存库的平台 Token。生成：
  ```bash
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  ```
  ⚠️ **这个 key 一旦丢失，已存库的平台 Token 将无法解密**。请单独备份。留空则由 `SECRET_KEY` 派生——但那样改了 `SECRET_KEY` 就会导致 Token 全部失效，所以生产建议显式设置。

### 4. 部署

点「部署」→ 云托管会：拉取代码 → 构建镜像（装依赖 + collectstatic）→ 启动容器（自动执行 `migrate`）→ 健康检查 `/api/health/`。

首次构建约 3~6 分钟。

### 5. 建管理员账号（可选）

若需要用 Django Admin 管理数据，部署后在云托管控制台「WebShell / 终端」里执行：

```bash
python manage.py createsuperuser
```

### 6. 验证

```bash
curl https://<你的云托管域名>/api/health/
# 期望：{"status": "ok", "database": "ok"}
```

### 7. 小程序端对接

本项目的小程序用的是**普通 HTTPS 请求**（`utils/request.js` 里的 `wx.request`），
因此走的是「登记合法域名」这条路，**不需要** `wx.cloud.callContainer`。

> 云托管控制台会展示一段 `wx.cloud.callContainer({ config: { env }, ... })` 示例代码，
> 那是「免域名内网调用」的另一种方式，用它可以不配域名，但**需要改造所有请求代码**、
> 且必须在 `app.json` 中声明 `cloud: true`。本项目**不用它**，忽略该示例即可。

对接步骤：

1. 记下云托管分配的域名，形如 `velosync-api-xxx.ap-shanghai.run.tcloudbase.com`。
   在服务详情的「域名地址」处可看到（本项目那个是 `django-xu8d-...` 之类）。
2. 小程序后台 → **开发管理 → 开发设置 → 服务器域名 → request 合法域名**，添加：
   ```
   https://<你的云托管域名>
   ```
   ⚠️ 必须是 `https://` 开头、**不带路径**、**不带端口**。
3. 改小程序配置 `wx-frontend/config.js`：
   ```js
   baseUrl: "https://<你的云托管域名>/api",
   ```
4. 开发者工具重新编译 → 真机预览即可。

> 云托管默认提供 HTTPS，无需自己申请证书，正好满足小程序「必须 HTTPS」的要求。

---

## 三、常见问题

**Q：构建失败，报找不到 requirements.txt？**
检查「构建目录」是否填了 `backend`——Dockerfile 与 requirements.txt 都在这个子目录下。

**Q：容器启动后健康检查失败？**
多为数据库连不上。确认 `DB_HOST` 用的是**内网地址**（云托管与 MySQL 需在同一地域），且 MySQL 已放行云托管的内网访问。

**Q：小程序报「不在以下 request 合法域名列表中」？**
说明第 7 步的域名没登记，或登记后未重新编译。注意域名必须 `https://` 开头、不带路径。

**Q：`MySQL server has gone away`？**
已在 `settings.py` 开启 `CONN_MAX_AGE=60` + `CONN_HEALTH_CHECKS=True` 缓解。若仍频繁出现，把 `DB_CONN_MAX_AGE` 调小（如 `0`，即每次请求新建连接）。

**Q：冷启动太慢？**
把「最小实例数」从 0 调到 1，代价是常驻计费。

**Q：想更新代码？**
推送到 GitHub `master` 后，在云托管控制台点「重新部署」（或配置自动部署监听分支）。
