# VeloSync（速同）· 跨平台运动数据同步中枢

> 将 iGPSPORT、Garmin、Strava、Coros 等平台的运动记录自动汇总、去重、分发，让每一条骑行记录在所有平台都有一席之地。

**技术栈**：React 18 + TypeScript + Vite + React Flow + TanStack Query + Zustand + Recharts + cmdk ｜ Django 5 + DRF + SimpleJWT + Celery + MySQL 8 / SQLite

---

## ✨ 核心功能（已实现）

| 模块             | 说明                                                                             |
| -------------- | ------------------------------------------------------------------------------ |
| 🔐 账号与授权       | JWT 登录/注册；平台 OAuth2 授权绑定（authorize/callback 全流程）、Token Fernet 加密存储、状态监控、解绑/重授权 |
| 🆔 注册与快捷登录     | 账密注册（用户名/昵称/邮箱/密码确认 + 前后端校验）；微信 · QQ · 微博一键登录注册，同一身份自动复用账号                     |
| 🕸 可视化管道       | React Flow 画布：源（蓝）/过滤器（琥珀）/目标（绿）三类节点，拖拽连线、节点配置面板、整体 PUT 保存、位置持久化               |
| 📊 活动矩阵        | 活动 × 平台二维矩阵，✅已同步 / ⚠️待同步 / ❌失败 / —不适用，点击看详情、右键手动同步                             |
| 🧠 智能去重        | ±5 秒时间窗口匹配 + FIT 哈希辅助校验，防止重复上传                                                 |
| ⚙️ 规则引擎        | 按运动类型 / 距离区间 / 日期范围过滤，可组合                                                      |
| ⚡ 实时进度         | SSE（EventSource）推送管道运行状态，节点边框实时变色（运行中闪烁/成功绿/失败红）                               |
| 📈 仪表盘         | 活动总数、已同步、待同步、同步率，平台分布饼图、30 天趋势折线、最近同步表格                                        |
| 📜 同步日志        | 表格 + 时间轴双视图，按级别/管道筛选                                                           |
| ⌨️ 命令面板        | Ctrl/Cmd + K：跳转页面、搜索管道与活动、刷新数据                                                 |
| 🖥 三栏工作台       | 左侧导航可折叠可拖拽调宽，右侧上下文面板随选中对象切换                                                    |
| 🧩 插件化 Adapter | 平台适配器注册表：Mock 可完整跑通；iGPSPORT/Garmin/Strava/COROS 骨架，申请到凭证后实现接口即接入              |
| 🧵 异步任务        | Celery 任务 + Beat 定时轮询（每 5 分钟）+ 失败指数退避重试；开发模式 EAGER 免 Redis                     |

## 🚀 快速开始

### 0. 环境要求

- Python ≥ 3.10（推荐 3.12+）
- Node.js ≥ 18
- MySQL 8（后端默认连本地 `localhost:3306` 的 `velosync` 库；也可切回 SQLite 免安装）
- 前端使用 **yarn** 管理（`corepack enable` 一次即可，无需单独安装）
- 可选：Docker（MySQL + Redis）、Redis（生产模式 Celery 需要）

### 1. 启动后端（本地 MySQL 8 · localhost:3306/velosync）

`backend/.env` 已预置本地 MySQL 连接（`root` / `123456`，库 `velosync`）。若库不存在先建一次：

```sql
CREATE DATABASE velosync CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

```bash
cd backend

# Windows
python -m venv .venv
.venv\Scripts\activate
# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
python manage.py migrate          # 建表到 MySQL velosync
python manage.py seed_demo        # 演示数据：30 条活动 + 2 条管道
python manage.py runserver        # http://127.0.0.1:8000
```

> 想切回 SQLite：把 `.env` 里 `DB_ENGINE=mysql` 改成 `DB_ENGINE=sqlite` 即可，其余不动。

### 2. 启动前端

```bash
cd frontend
corepack enable                   # 启用 yarn（Node ≥ 16.10 自带，仅需一次）
yarn install
yarn dev                          # http://localhost:5173（/api 自动代理到 8000）
```

### 3. 登录

| 账号      | 密码           | 用途                        |
| ------- | ------------ | ------------------------- |
| `demo`  | `demo123456` | 前台工作台（含 30 条演示活动、2 条管道）   |
| `admin` |              | Django Admin 后台 `/admin/` |

### 4. 启用 Redis + Celery 异步（可选）

默认 `CELERY_TASK_ALWAYS_EAGER=1`：任务同步执行，**不需要 Redis**。要真正异步：

```bash
docker compose up -d redis        # 只起 Redis 7（数据库用本地 MySQL，无需容器）
```

把 `backend/.env` 中改为 `CELERY_TASK_ALWAYS_EAGER=0`，然后：

```bash
celery -A config worker -l info -P solo        # Windows 用 solo 池
celery -A config beat -l info                  # 定时调度（自动轮询管道）
```

## 🎬 演示玩法

1. 登录页可**注册**新账号，或点微信 / QQ 图标用**演示身份**一键登录（首次自动建号并绑定，再次使用同一身份直接登录）；
2. 登录后进入**仪表盘**查看统计与趋势；
3. 打开**管道**页 → 进入「演示回环（Mock 目标）」画布 → 点**运行管道**，观察节点边框随 SSE 实时变色，跑完 toast 提示执行结果；
4. 到**活动矩阵**右键任一待同步/失败单元格 → 手动同步；
5. **账号**页一键绑定「演示平台 (Mock)」体验授权流程；
6. 任意页面按 **Ctrl/Cmd + K** 唤起命令面板。

## 📁 项目结构

```
VeloSync/
├── docker-compose.yml          # MySQL + Redis
├── backend/
│   ├── requirements.txt
│   ├── .env.example
│   ├── config/                 # settings / urls / celery
│   └── apps/
│       ├── accounts/           # JWT 登录注册 + 查询参数认证（SSE 用）
│       ├── platforms/          # 平台/账号模型、Fernet 加密、OAuth 流程、适配器
│       ├── pipelines/          # 管道/节点/连线/运行记录、执行引擎、过滤器、Celery 任务、SSE
│       ├── activities/         # 活动/同步状态、去重、坐标转换、FIT 工具
│       ├── synclogs/           # 同步日志
│       ├── dashboard/          # 仪表盘统计
│       └── core/               # seed_demo 管理命令
└── frontend/
    └── src/
        ├── api/                # fetch 客户端（401 自动刷新）+ 类型 + React Query hooks
        ├── stores/             # Zustand：认证 / UI 状态
        ├── components/         # 三栏布局、命令面板、管道节点、状态图标
        └── pages/              # 登录 / 仪表盘 / 管道 / 编辑器 / 矩阵 / 账号 / 日志 / 设置
```

## 🔌 API 一览（OpenAPI：`/api/docs/`）

```
POST /api/auth/login/ | refresh/ | register/      GET /api/auth/me/
GET  /api/auth/social/providers/                  快捷登录方式（含 oauth/mock 模式）
POST /api/auth/social/login/                      第三方登录注册，直接返回 JWT
GET  /api/auth/social/{provider}/authorize/       取授权地址（演示模式无地址）
GET  /api/auth/social/{provider}/callback/        OAuth 回调 → 签发 JWT 回跳前端
GET  /api/platforms/                              平台列表
GET|DELETE /api/accounts/                         账号管理
GET  /api/accounts/{platform}/authorize/          获取授权 URL
GET  /api/accounts/{platform}/callback/           OAuth 回调
CRUD /api/pipelines/（PUT 整体保存 nodes+edges）   管道
POST /api/pipelines/{id}/run/                     执行
GET  /api/pipelines/{id}/stream/?access_token=    SSE 实时进度
GET  /api/activities/ | matrix/                   活动与矩阵
POST /api/activities/{id}/sync/                   手动补同步
GET  /api/logs/                                   日志
GET  /api/dashboard/stats/                        仪表盘统计
```

## 🛠 接入真实平台

1. 在 Django Admin（或 seed 数据）中补充平台 `client_id / client_secret / authorize_url / token_url / api_base`；
2. 在 `apps/platforms/adapters.py` 对应适配器中实现 `fetch_activities / download_fit / upload_fit / check_exists`；
3. 绑定账号 → 搭建管道 → 运行。

FIT 解析（fitparse）与 GCJ-02 ↔ WGS-84 坐标转换已内置（`apps/activities/fit_utils.py`、`coords.py`），供轨迹纠偏与元数据补全使用。

## 🔑 接入真实微信 / QQ 登录

快捷登录默认处于**演示模式**：没有凭证也能一键登录（用于体验流程）。要接真实账号，去对应开放平台申请网站应用后，把凭证写进 `backend/.env` 重启即可，**代码无需改动**：

```
WECHAT_APP_ID=wx1234567890
WECHAT_APP_SECRET=xxxxxxxx
QQ_APP_ID=1020xxxxxx
QQ_APP_SECRET=xxxxxxxx
# 回调基址必须与开放平台登记的回调域名一致（外网可访问）
SOCIAL_REDIRECT_BASE_URL=https://your-domain.com
```

机制说明：

- 凭证齐全 → `/api/auth/social/{provider}/authorize/` 返回真实授权地址，前端跳转 → 平台回调后端 `callback/` → code 换 openid → 签发 JWT → 回跳 `/auth/callback` 落地登录；
- 凭证为空 → 接口返回 `mode: "mock"`，前端弹出演示身份框，提交后走同一套绑定逻辑；
- 两种模式共用 `SocialAccount`（provider + openid 唯一），同一身份始终映射到同一账号；
- 新增平台只需在 `settings.SOCIAL_AUTH_PROVIDERS` 注册 + 在 `apps/accounts/social.py` 实现换取逻辑，前端按钮由接口自动渲染。

## ⚠️ 已知限制（对应设计书 Phase 7 持续迭代）

- iGPSPORT / Garmin / Strava / COROS 真实 API 适配器为骨架（需开发者凭证）；
- 前端矩阵当前一次加载 200 条活动（生产建议虚拟滚动 + 后端游标分页）；
- SSE 采用轮询 PipelineRun 的简化实现，生产可切换 Redis Pub/Sub；
- 个别受限环境（如沙箱、CI 关闭安装脚本）下 esbuild/rollup 可能缺原生二进制，补装即可：  
  `yarn add -D --ignore-scripts @esbuild/win32-x64 @rollup/rollup-win32-x64-msvc`（macOS/Linux 无需处理）。
