# VeloSync（速同）· 跨平台运动数据同步中枢

> 把 iGPSPORT、Garmin、Strava、Coros 等平台的运动记录汇总、去重、分发，让每一条骑行记录在所有平台都有一席之地。
>
> ⚠️ **当前进度**：已完成「演示平台（Mock）」的**端到端全链路**（拉取 → 去重 → 分发 → 日志 → 矩阵）。
> iGPSPORT / Garmin / Strava / COROS **四个真实平台的适配器仍是骨架**——每个方法都会抛
> `AdapterError("...待适配")`，申请到开发者凭证并实现接口后才能真实同步。功能表里的「骨架」二字是
> 有意保留的，请不要按首段理解成「已经能同步这四个平台」。

**技术栈**：React 18 + TypeScript + Vite + React Flow + TanStack Query + Zustand + Recharts + cmdk ｜ Django 5 + DRF + SimpleJWT + Celery + MySQL 8 / SQLite

---

## ✨ 核心功能（已实现）

| 模块             | 说明                                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔐 账号与授权       | JWT 登录/注册；平台 OAuth2 授权绑定（authorize/callback 全流程）、未配置凭证时可按「演示身份」绑定、凭证状态可视化、Token 与 client_secret 均 Fernet 加密存储、**Token 到期自动刷新**（含 refresh token 轮换）、过期/撤销状态如实呈现、解绑时通知平台撤销授权；**退出登录**（侧栏底部 / 设置页 / 命令面板三处入口，二次确认，并清空 token 与全部查询缓存以防换账号串数据）                          |
| 🆔 注册与快捷登录     | 账密注册（用户名/昵称/邮箱/密码确认 + 前后端校验）；微信 · QQ · 微博一键登录注册，同一身份自动复用账号                                                                                                                                      |
| 📦 同步任务        | 四步向导：**数据来源**（FIT 文件 / iGPSPORT / 佳明 / Strava / COROS / 演示）→ **同步内容**（运动记录、汇总指标、采样点、GPS 轨迹、设备信息 / 个人资料、训练课程、路线、体重、睡眠、日常健康、装备、训练计划…）→ **目标账号**（多选）→ **时间范围与选项**。FIT 来源的时间范围受文件自身记录限制，支持**试运行预览** |
| 🕸 执行图可视化      | 结构化配置自动展开为 React Flow 执行图（源 → 时间范围 → 目标账号），节点边框随运行进度实时变色，运行统计（命中/同步/跳过/失败/纠偏点数）可视化                                                                                                             |
| 📊 活动矩阵        | 活动 × 平台二维矩阵，✅已同步 / ⚠️待同步 / ❌失败 / —不适用，点击看详情、右键手动同步                                                                                                                                              |
| 📄 FIT 解析      | 上传 .fit 解析汇总指标；**15 类指标全部预留**（无数据留空白图位），曲线支持**时间 / 距离双维度**与**多指标叠加**；GPS 轨迹用**高德地图**回放；导入历史可查看/删除，按文件哈希去重入库                                                                                     |
| 🧠 智能去重        | ±5 秒时间窗口匹配 + FIT 哈希辅助校验，防止重复上传                                                                                                                                                                  |
| ⚙️ 规则引擎        | 时间范围过滤、仅含 GPS、轨迹点上限抽稀、坐标纠偏、智能去重、冲突策略（跳过/覆盖/副本）、试运行                                                                                                                                              |
| ⚡ 实时进度         | 短轮询运行状态（1.5s）驱动节点边框实时变色（运行中闪烁/成功绿/失败红），并推送执行统计。**刻意不用 SSE**：长连接会独占请求槽位，而全站并发槽位只有 8 个，几个并发打开详情页的用户就能让整个 API（含健康检查）停止响应                                                                                 |
| 📈 仪表盘         | 活动总数、已同步、待同步、同步率，平台分布饼图、30 天趋势折线、最近同步表格                                                                                                                                                         |
| 📜 同步日志        | 表格 + 时间轴双视图，按级别/同步任务筛选                                                                                                                                                                          |
| ⌨️ 命令面板        | Ctrl/Cmd + K：跳转页面、搜索同步任务与活动、刷新数据、退出登录                                                                                                                                                           |
| 🖥 三栏工作台       | 左侧导航可折叠可拖拽调宽，右侧上下文面板随选中对象切换                                                                                                                                                                     |
| 🧩 插件化 Adapter | 平台适配器注册表：Mock 可完整跑通；iGPSPORT/Garmin/Strava/COROS 骨架，申请到凭证后实现接口即接入                                                                                                                               |
| 🧵 异步任务        | `dispatch_run()` 显式解耦执行模型：有 Celery worker 走 Celery，没有则回退后台线程——**绝不把同步任务跑在 HTTP 请求里**（否则撞上 gunicorn `--timeout` 会被杀，记录永远停在 running）。含僵尸运行回收与 Beat 定时轮询                                    |
| 📱 微信小程序端      | `wx-frontend/`：原生小程序（12 页 / 5 tab）。微信一键登录（`code2session`，未配 AppID 自动降级演示身份）、手机号一键绑定（`getPhoneNumber`）、真实头像昵称（微信「头像昵称填写能力」）、微信隐私授权（`requirePrivacyAuthorize`）、Canvas 2D 手绘全部图表、`map` 组件轨迹回放、`wx.chooseMessageFile` 上传 FIT、短轮询运行进度、**三级兜底**完成第三方账号绑定。注意：与 Web 端**功能对等**指核心同步流程，小程序端另有若干刻意差异（见 `wx-frontend/README.md`）             |

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
python manage.py seed_demo        # 演示数据：30 条活动 + 2 条同步任务
python manage.py runserver        # http://127.0.0.1:8000
```

> 想切回 SQLite：把 `.env` 里 `DB_ENGINE=mysql` 改成 `DB_ENGINE=sqlite` 即可，其余不动。

### 2. 启动前端

```bash
cd frontend
corepack enable                   # 启用 yarn（Node ≥ 16.10 自带，仅需一次）
yarn install
yarn dev                          # http://localhost:5173
                                  # /api、/admin、/static 均自动代理到后端 8000
```

> 开发时 `http://localhost:5173/admin/` 与 `http://127.0.0.1:8000/admin/` 都能进 Django Admin。>   
> （`/admin` 未代理时 Vite 会返回 index.html，前端路由匹配不到就回退到主页。）>   
> 经 5173 代理登录后台时，后端需把 `http://localhost:5173` 加入 `CSRF_TRUSTED_ORIGINS`（已默认配置），>   
> 否则 POST 登录表单会被 CSRF「Origin checking failed」拦下并返回 403。

### 3. 登录

| 账号      | 密码            | 用途                        |
| ------- | ------------- | ------------------------- |
| `demo`  | `demo123456`  | 前台工作台（含 30 条演示活动、2 条同步任务） |
| `admin` | `admin123456` | Django Admin 后台 `/admin/` |

### 4. 启用 Redis + Celery 异步（可选）

默认 `CELERY_TASK_ALWAYS_EAGER=1`：任务同步执行，**不需要 Redis**。要真正异步：

```bash
docker compose up -d redis        # 只起 Redis 7（数据库用本地 MySQL，无需容器）
```

把 `backend/.env` 中改为 `CELERY_TASK_ALWAYS_EAGER=0`，然后：

```bash
celery -A config worker -l info -P solo        # Windows 用 solo 池
celery -A config beat -l info                  # 定时调度（自动轮询同步任务）
```

### 5. 启动小程序端（wx-frontend，可选）

`frontend` 与 `wx-frontend` 是**同级的两个客户端**，共用同一后端，功能对等。

1. 微信开发者工具 → **导入项目** → 目录选 `D:\Code\VeloSync\wx-frontend`；
2. AppID 先选「测试号」即可跑通全部功能；
3. 开发者工具「**详情 → 本地设置**」勾选 **「不校验合法域名、web-view、TLS 版本以及 HTTPS 证书」**；
4. 后端保持 `http://127.0.0.1:8000` 运行，小程序 `config.js` 默认 `baseUrl: "http://127.0.0.1:8000/api"`。

真机预览把 `baseUrl` 改成电脑内网 IP（如 `http://192.168.1.5:8000/api`）；开发版/体验版也可在登录页底部的「接口地址」入口运行时修改（该入口在正式版不渲染，「设置」页则任何版本都不再暴露）。  
第三方账号绑定、图标说明、待补资料清单详见 **[`wx-frontend/README.md`](wx-frontend/README.md)**。

## 🎬 演示玩法

1. 登录页可**注册**新账号，或点微信 / QQ 图标用**演示身份**一键登录（首次自动建号并绑定，再次使用同一身份直接登录）；
2. 登录后进入**仪表盘**查看统计与趋势；
3. 打开**FIT 解析**页上传 `backend/tools/sample_ride.fit`（或 `make_sample_fit.py` 合成的样例）；
4. 打开**同步任务**页 → 右上角「新建同步任务」→ 四步向导：
   - 数据来源选 **FIT 文件 / 本地记录**（可指定某一份 FIT，或全部本地记录）；
   - 同步内容勾选 运动记录 / 汇总指标 / 采样点 / GPS 轨迹 / 设备信息（其余项标「预留」）；
   - 目标账号勾选已绑定的平台账号；
   - 时间范围选 **文件完整范围**，选项保持默认（**坐标纠偏**与**智能去重**默认开启）；
   - 点「试运行预览」可先看将同步多少条活动、纠偏多少个轨迹点，确认后「创建任务」。
5. 在任务详情页点**运行任务**，左侧配置、右侧执行图与运行统计实时更新（短轮询运行状态）；
6. 到**活动矩阵**右键任一待同步/失败单元格 → 手动同步；
7. **账号**页一键绑定「演示平台 (Mock)」体验授权流程；iGPSPORT / 佳明等未配置 OAuth 凭证的平台，     
   会提示缺哪些凭证，并可点「以演示身份绑定」跑通全链路（详见「接入真实平台」）；
8. **FIT 解析**页上传 .fit 文件：切换**时间/距离**维度看曲线（默认每个指标一行，也可改「叠加」     
   把多个指标画在同一张图对比），点播放做**轨迹回放** —— 手上没文件就先跑     
   `python backend/tools/make_sample_fit.py`（默认样例已写入全部预留字段；想看回放效果可用     
   `python backend/tools/make_sample_fit.py tools/sample_ride_long.fit 3600` 生成 1 小时数据；     
   加第三个参数 `basic` 可生成仅含基础字段的文件，用来看「无数据 → 空白图位」的效果）；
9. 任意页面按 **Ctrl/Cmd + K** 唤起命令面板；面板里的「退出登录」可直接登出。
10. 要退出当前账号，三个入口任选：**侧栏底部**的用户区（头像 + 昵称，右侧登出图标）、**设置页**的红色「退出登录」按钮、**命令面板**输入「退出登录」。      
    三者都会先弹二次确认，确认后清除本地 JWT 并跳回登录页。

## 📁 项目结构

```
VeloSync/
├── .vscode/                    # 团队共享：settings（wxml/wxss 语言关联）/ extensions / tasks（自检与起服务）
├── docker-compose.yml          # MySQL + Redis
├── backend/
│   ├── requirements.txt
│   ├── .env.example
│   ├── config/                 # settings / urls / celery
│   └── apps/
│       ├── accounts/           # JWT 登录注册、第三方登录、手机号/资料、微信小程序登录
│       ├── platforms/          # 平台/账号模型、Fernet 加密（含 client_secret）、OAuth 流程、Token 刷新、适配器
│       ├── pipelines/          # 同步任务/节点/连线/运行记录、规格注册表、执行引擎、试运行规划、过滤器、Celery 任务、运行状态轮询
│       ├── activities/         # 活动/同步状态/FIT 详情、去重、坐标转换、FIT 解析
│       ├── synclogs/           # 同步日志
│       ├── dashboard/          # 仪表盘统计
│       └── core/               # seed_demo 管理命令
│   └── tools/                  # make_sample_fit.py：合成样例 FIT（无真实文件时验证用）
└── frontend/
    ├── public/                 # favicon.svg（品牌图标矢量源）/ favicon-16·32 / apple-touch-icon / logo-512
    ├── tools/                  # make_brand_icons.cjs：从 favicon.svg 渲染各尺寸位图
    └── src/
        ├── api/                # fetch 客户端（401 自动刷新）+ 全局 QueryClient 单例 + 类型 + React Query hooks
        ├── stores/             # Zustand：认证 / UI 状态
        ├── components/         # 三栏布局、命令面板、执行图节点、同步任务向导/表单、状态图标、高德轨迹回放、BrandMark 品牌标识
        ├── utils/              # 坐标转换(WGS-84↔GCJ-02)、高德加载器、格式化
        └── pages/              # 登录 / 仪表盘 / 同步任务 / 任务配置 / 矩阵 / FIT 解析 / 账号 / 日志 / 设置
└── wx-frontend/                # 微信小程序端（原生 WXML/WXSS/JS，与 frontend 功能对等）
    ├── app.json                # 12 页面 + 5 tabBar + 定位权限声明
    ├── config.js               # 后端地址 / 平台官方小程序 appId / 官方 App 兜底链接
    ├── styles/common.wxss      # 设计系统（与 Web 端同一套 token）
    ├── utils/                  # 请求(401 刷新)、坐标纠偏、FIT 指标注册表、Canvas 图表、格式化
    ├── components/sync-form/   # 四段式同步配置表单
    ├── pages/                  # 登录 / 仪表盘 / 同步任务 / 向导 / 任务编辑 / 矩阵 / FIT / FIT详情 / 账号 / 日志 / 设置 / 我的
    ├── assets/                 # 品牌图标（速度线 + 环形同步箭头）+ tabBar 图标
    └── tools/                  # make_icons.py（生成图标）、check.js（静态自检）、api-smoke.js、chart-test.js、make_preview.js（生成静态预览页）
```

## 🔌 API 一览（OpenAPI：`/api/docs/`）

```
POST /api/auth/login/ | refresh/ | register/      GET /api/auth/me/
GET  /api/auth/social/providers/                  快捷登录方式（?channel=web|miniprogram，
                                                  默认只返回 web；小程序专用项带 channel=miniprogram）
GET  /api/auth/wx/miniprogram/                    小程序登录模式（GET）/ wx.login 一键登录（POST）
POST /api/auth/social/login/                      第三方登录注册，直接返回 JWT
GET  /api/auth/social/{provider}/authorize/       取授权地址（演示模式无地址）
GET  /api/auth/social/{provider}/callback/        OAuth 回调 → 签发 JWT 回跳前端
GET  /api/platforms/                              平台列表
GET|DELETE /api/accounts/                         账号管理
GET  /api/accounts/{platform}/authorize/          获取授权 URL（未配置凭证时返回 400 + code=oauth_not_configured）
POST /api/accounts/{platform}/demo-bind/          未配置凭证时以演示身份绑定（本地体验用）
GET  /api/accounts/{platform}/callback/           OAuth 回调
CRUD /api/pipelines/                             同步任务（PUT 支持画布 nodes+edges 或结构化配置，
                                                 结构化配置会自动重建执行图）
GET  /api/pipelines/sync-spec/                   规格目录：数据来源 / 同步内容 / 选项 / 可选账号与 FIT 记录
POST /api/pipelines/sync-preview/                未保存配置的试运行预览（新建向导用）
POST /api/pipelines/{id}/preview/                按当前或临时覆盖的配置试运行预览（不写入数据）
POST /api/pipelines/{id}/run/                     执行
GET  /api/pipelines/{id}/run-status/             轮询运行状态（节点状态 + 执行统计 stats）
GET  /api/activities/ | matrix/                   活动与矩阵
POST /api/activities/upload-fit/                  上传并解析 FIT 文件（multipart）
GET  /api/activities/fit-history/                 FIT 导入历史（轻量列表，不含采样点）
GET  /api/activities/{id}/fit/                   该活动的 FIT 解析详情
DELETE /api/activities/{id}/fit/                 删除解析详情（?with_activity=1 连活动一并删除）
POST /api/activities/{id}/sync/                   手动补同步
GET  /api/logs/                                   日志
GET  /api/dashboard/stats/                        仪表盘统计
```

## 🛠 接入真实平台

### 1. 先看平台凭证状态

平台账号绑定需要各平台开放平台的 OAuth 凭证（`authorize_url` / `token_url` / `client_id` / `client_secret`）。  
仓库里 **iGPSPORT / Garmin / Strava / COROS 的凭证是留空的**，所以在「账号管理」页点「绑定账号」会提示  
「尚未配置 OAuth 凭证」。查看当前状态与各平台申请入口：


```bash
cd backend && ./.venv/Scripts/python.exe manage.py set_platform_oauth --list
```

| 平台 | 申请入口 |
| --- | --- |
| iGPSPORT | iGPSPORT APP Open Platform（www.igpsport.com/support/app/openapi，OAuth2.0，邮件申请 global@igpsport.com） |
| Garmin | Garmin Connect Developer Program（developer.garmin.com） |
| Strava | Strava API Settings（www.strava.com/settings/api） |
| COROS | COROS 开放平台（open.coros.com） |

> **iGPSPORT 申请材料已备好**：官方要求的 7 项开发者资料（应用名称 / Logo / 简介 / redirect_url /
> callback_url / Company name / Official website）的逐项填法、Logo（120×120 PNG，已生成
> `wx-frontend/assets/brand/logo-120.png`）、中英文简介文案、redirect/callback 的公网地址方案，
> 以及可直接发送的邮件正文，见 **[`docs/igpsport-开放平台申请材料.md`](docs/igpsport-开放平台申请材料.md)**。
> 官方**未要求**项目说明书、软著或营业执照，但个人开发者需如实说明主体性质。
>
> 即使拿不到开放平台权限也不影响使用：**FIT 文件导入链路已完整跑通**（见「FIT 解析说明」）。

### 2-A. 还没有凭证 —— 用「演示身份」绑定（本地体验）

在「账号管理」页点「绑定账号」后，会出现引导面板，点 **「以演示身份绑定」** 即可。
后端会签发一个 `demo-token`，账号列表中标记为「演示身份」，用于跑通
**绑定 → 新建同步任务 → 运行 → 看日志** 整条链路（平台侧不会收到真实请求，因此同步一定会失败并在日志里给出原因）。
也可以用接口直接绑定：`POST /api/accounts/{platform}/demo-bind/`。

### 2-B. 已拿到凭证 —— 写入平台数据

**Django Admin**（`/admin/platforms/platform/`）里打开对应平台，在「OAuth 凭证」分组填写；或命令行写入：

```bash
cd backend
./.venv/Scripts/python.exe manage.py set_platform_oauth strava \
  --authorize-url https://www.strava.com/oauth/authorize \
  --token-url    https://www.strava.com/oauth/token \
  --api-base     https://www.strava.com/api/v3 \
  --client-id    你的ClientID --client-secret 你的ClientSecret \
  --scopes       read,activity:read_all,activity:write

# 回退到"未配置"状态
./.venv/Scripts/python.exe manage.py set_platform_oauth strava --clear
```

凭证齐备（`authorize_url` / `token_url` / `client_id` 三者都有）后，「绑定账号」会跳转平台真实授权页，
授权回调写入加密 Token；此时 `demo-bind` 会被拒绝（返回 400），避免误用。

### 3. 补充适配器与内容能力

1. 在 `apps/platforms/adapters.py` 对应适配器中实现 `fetch_activities / download_fit / upload_fit / check_exists`（运动记录）；
2. 账号类内容（个人资料 / 训练课程 / 路线 / 体重 / 睡眠 / 日常健康 / 装备 / 训练计划）按需实现
   `fetch_content(key, since, until)` 与 `push_content(key, payload)`，并在 `CONTENT_SUPPORT` 中登记；
   未实现的平台在运行时会记一条「已预留」日志并跳过，不会中断任务；
3. 重新授权账号 → 新建同步任务 → 运行。

**同步任务配置**（`apps/pipelines/spec.py` 是唯一事实来源，前端向导按它渲染）：
数据来源 `SOURCE_SPECS`、同步内容 `CONTENT_SPECS`（按来源分组，`implemented: false` 即前端标「预留」）、
同步选项 `OPTION_SPECS`（坐标纠偏 / 智能去重 / 冲突策略 / 仅含 GPS / 轨迹点上限 / 回填远端 ID / 遇错中止 / 试运行）。

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
- **渠道隔离**：并非所有登录方式两端通用。`wechat_mp`（小程序 `wx.login` → `code2session`）只在微信小程序里拿得到 `code`，因此不属于 `SOCIAL_AUTH_PROVIDERS`，被登记在 `social.MINIPROGRAM_ONLY` 中。`GET /api/auth/social/providers/` **默认只下发 `channel: "web"` 的项**，小程序端显式传 `?channel=miniprogram` 才会附上 `wechat_mp`。网页端即便直接调用也会收到可读的 400 提示（`wechat_mp 仅支持微信小程序端调用…`），而不是渲染出一个点了必然失败的按钮。

## 📱 微信小程序端（wx-frontend）

`wx-frontend/` 与 `frontend/` 同级，是**同一后端的第二个客户端**，功能对等，但受微信平台能力限制，部分实现方式不同：

| 能力 | Web 端 | 小程序端 |
| --- | --- | --- |
| 实时进度 | 短轮询运行状态（1.5s） | **短轮询** `pollRun()`（1.2s × 30 次） |
| 图表 | Recharts | **Canvas 2D** 手绘（`utils/chart.js`：分图 / 叠加 / 饼图 / 趋势） |
| 轨迹回放 | 高德 JS API | 内置 **`map` 组件** + polyline（坐标同为 GCJ-02） |
| 上传 FIT | `<input type=file>` | **`wx.chooseMessageFile`** 从聊天记录选择 |
| 微信登录 | 开放平台网站应用 OAuth | **`wx.login()` → `code2session`**（未配 AppID 自动降级演示身份） |

> 小程序端**只保留微信登录**（不含 QQ / 微博入口），登录后「我的」页展示微信真实头像与 OpenID / UnionID。
> `/api/auth/me/` 已扩展返回 `avatar` 与 `social[]`（provider / openid / unionid / avatar_url / bound_at），
> 登录响应同样带齐，无需二次请求。

### 第三方账号绑定：三级兜底

微信小程序**不允许直接唤起第三方 App**（`garminconnect://`、`strava://` 在小程序内无效），所以按顺序降级：

1. **跳官方小程序** —— `wx.navigateToMiniProgram`（需在 `config.js` 填对方小程序原始 AppID）；
2. **复制链接开 App** —— `wx.setClipboardData` 复制官方链接 → 浏览器唤起官方 App；
3. **演示身份** —— `POST /api/platforms/{id}/demo-bind/`，本地未配 OAuth 凭证时一键跑通。

### 待补资料（缺省会自动降级，不阻塞本地开发）

| 项 | 填到哪里 | 状态 |
| --- | --- | --- |
| 小程序 AppID | `wx-frontend/project.config.json → appid` | ✅ 已配置 |
| 小程序 AppID + AppSecret | `backend/.env → WECHAT_MP_APP_ID` / `WECHAT_MP_APP_SECRET` | ✅ 已配置 |
| 各平台官方小程序 AppID | `wx-frontend/config.js → officialMiniPrograms` | ⬜ 待补 |
| 各平台 OAuth 凭证 | Django Admin → 平台 → 对应字段 | ⬜ 待补 |
| 微信开放平台网站应用（网页扫码登录用） | `backend/.env → WECHAT_APP_ID` / `WECHAT_APP_SECRET` | ⬜ 待补（需企业主体） |

小程序端细节、图标生成、自测脚本与真机调试，详见 **[`wx-frontend/README.md`](wx-frontend/README.md)**。

### 怎么查看小程序界面

小程序必须跑在微信运行时里，**浏览器和 VS Code 都不能真正渲染它**，只能用[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（本机尚未安装）。

但「看界面」不必装工具：

```bash
cd wx-frontend && node tools/make_preview.js    # 需后端已启动
```

生成 `preview/index.html` —— **单文件、自包含**的静态预览。它用真实 WXML + 真实 WXSS 渲染，页面数据由一份最小 `wx` 垫片在 Node 里真实执行各页面的 `onLoad`/`onShow` 从后端取回；12 个页面一屏切换，含模拟状态栏 / 导航栏 / tabBar；图表由小程序自己的 `utils/chart.js` 按真实采样数据补绘。浏览器或 VS Code 的 Live Preview 均可直接打开。

> 定位是**看视觉与信息结构**的静态快照，不能替代开发者工具的真机调试（点击无效、输入只读）。

VS Code 在本仓库里承担的是「写 + 调」：`.vscode/` 已预置 WXML/WXSS 语言关联、推荐的 WXML 扩展，以及「静态自检 / API 冒烟 / 图表测试 / 生成预览 / 启动前后端」等任务（`Ctrl+Shift+P` → Tasks: Run Task）。

## 🎨 品牌图标

设计语言 **「速度线 + 环形同步箭头」**：靛蓝对角渐变圆角方块（`#818cf8 → #4338ca`）+ 白色环形双向同步箭头 + 内部三条长度递减的圆头速度线（速度 → 斜向流线，同步 → 环抱双向箭头）。主色 `#4f46e5`。

三个载体共用同一套几何参数（按 64×64 归一化）：

| 载体 | 文件 | 说明 |
| --- | --- | --- |
| Web 界面 | `frontend/src/components/BrandMark.tsx` | 内联 SVG 组件，用于侧栏顶部与登录页 |
| Web favicon | `frontend/public/favicon.svg` | 浏览器标签页 / 书签图标（位图副本由脚本生成） |
| 小程序 | `wx-frontend/assets/brand/logo-*.png` | 512 / 144 / 96 三档 |

要调整图形，改 `frontend/public/favicon.svg` 与 `BrandMark.tsx` 两处几何参数，然后重新生成位图：

```bash
# Web：从 favicon.svg 渲染 favicon-16 / favicon-32 / apple-touch-icon / logo-512
cd frontend && NODE_PATH=<装了 @resvg/resvg-js 的 node_modules> node tools/make_brand_icons.cjs

# 小程序：Pillow 生成品牌图标 + tabBar 图标
cd wx-frontend && python tools/make_icons.py
```

> 注意：Pillow 的 `draw.arc()` 线宽是**向内**扩展的，所以小程序版环的外沿等于半径。SVG 的 `stroke` 以路径为中心线，路径半径需写「外沿半径 − 描边一半」。两边对不上时先查这一点。

## 📄 FIT 解析说明

上传入口在前端「FIT 解析」页，也可直接调接口：

```bash
curl -X POST http://127.0.0.1:8000/api/activities/upload-fit/ \
  -H "Authorization: Bearer <access>" -F "file=@ride.fit"
```

解析产物（`ActivityFitDetail`）分四块：

| 字段 | 内容 |
| --- | --- |
| `summary` | 距离 / 时长 / 爬升下降 / 卡路里 / 平均·最大心率 / 平均·最大功率 / NP / 踏频 / 速度；另含 `metrics`（**全部 15 个指标槽位的统计**）与 `available_metrics`（本文件实际含哪些） |
| `samples` | 采样序列（时间、累计距离 + 下表各指标 + 经纬度），上限 30000 点（≈8 小时 1Hz，实际等于全量保留）；文件里没有的指标键会被剔除，避免 JSON 里塞满 null |
| `track` | GPS 轨迹 `[经度, 纬度]`，上限 30000 点，与采样同源但独立保留全部含 GPS 的点 |
| `device` | 设备厂商 / 序列号（来自 file_id） |

### 指标图表：预留全部模块 + 分图 / 叠加

后端注册表（`apps/activities/fit_utils.py` 的 `METRIC_SPEC`）预留了 FIT 常见的 15 类采样指标，
前端注册表（`frontend/src/utils/fitMetrics.ts`）与之**一一对应**：

| 分组 | 指标 |
| --- | --- |
| 基础 | 心率 bpm、功率 W、踏频 rpm、速度 km/h、海拔 m、坡度 %、温度 °C、累计消耗 kcal |
| 骑行进阶 | 扭矩效率 %、踩踏平顺度 %、累计做功 W |
| 跑步姿态 | 垂直振幅 mm、触地时间 ms、步幅 mm |
| 生理 | 肌氧饱和度 % |

展示规则：

- **分图模式（默认）**：每个指标**各占一行**（心率、速度、踏频等地位相同），单图带平均值参考线，
  标题右侧标注平均 / 峰值；
- **叠加模式**：勾选任意多个指标叠到一张图里，每项一条独立纵轴（左侧第一项、右侧第二项，
  其余隐藏刻度但比例正确），适合看心率与功率的相关性；
- **无数据也保留图位**：文件里没记录的指标画成空白图并标注「预留 · 无数据」，而不是隐藏卡片；
  不想看可以用「显示无数据指标」开关关掉。

横轴可切换 **按时间**（看节奏与心率漂移）或 **按距离**（对比同一段路的表现），全部图表同步切换；
鼠标移到曲线上会同步定位地图上的当前位置。累计距离优先取设备记录的 `distance`，设备不写时按相邻
GPS 点球面距离（Haversine）累加，保证 X 轴始终有值且单调不减。

### 导入历史与删除

FIT 页「导入历史」表格列出所有已导入记录（活动名、开始时间、距离、时长、文件名、点位、导入时间），
当前正在查看的那条会高亮。每行可**查看**（切换详情）或**删除**。

删除会弹出**二次确认弹窗**（ESC / 点遮罩可取消），并给出一个可选项：

- 默认只删**解析详情**（曲线与轨迹不可再查看，重新上传即可恢复）；
- 勾选「同时删除活动记录」则连活动本身一起删，该活动会从活动矩阵、仪表盘统计中移除，
  级联删除其同步状态行 —— **不可恢复**。

接口：`DELETE /api/activities/{id}/fit/`，带 `?with_activity=1` 时连活动一并删除。

### 🗺️ 轨迹回放（高德地图）

轨迹用高德 JS API 2.0 绘制，支持播放 / 暂停 / 重置、1×~32× 倍速、拖动进度条跳到任意点，
已走过的路径高亮显示，并实时显示当前点的时刻 / 里程 / 速度 / 心率 / 功率 / 海拔。

配置方法（不配也能用，会自动降级为内置 SVG 轨迹简图）：

```bash
cd frontend
cp .env.example .env
```

```ini
VITE_AMAP_KEY=你的Web端Key
VITE_AMAP_SECURITY_CODE=你的安全密钥   # JS API 2.0 必填
```

Key 在[高德控制台](https://console.amap.com/dev/key/app)申请，服务平台选 **Web端(JS API)**，
改完重启 dev server（`yarn dev`）。

> 坐标系说明：FIT 记录的是 WGS-84，国内地图用 GCJ-02，直接叠加会有 300~600 m 偏移，
> 前端绘制前统一用 `frontend/src/utils/coords.ts` 做转换（后端 `apps/activities/coords.py` 是同一套算法）。

实现要点：

- fitparse 已处理时间与缩放，但**坐标是半圆值、距离是米、速度是 m/s**，解析时统一换算成度 / km / km/h；
- session 缺字段时（很多码表不写全）从采样点推算：爬升按海拔正差累积、NP 按 30 秒移动平均四次方均值；
- 入库去重：先按文件 SHA256 匹配，再按 ±5 秒开始时间窗匹配，都没有才新建活动并初始化各平台同步状态；
- 手上没有真实文件时：`python backend/tools/make_sample_fit.py [输出路径] [点数] [basic]` 会合成一份
  合规样例，例如 `python backend/tools/make_sample_fit.py tools/sample_ride_long.fit 3600` 生成 1 小时
  骑行数据用于测试回放；末尾加 `basic` 则只写基础字段（用于验证空白图位）；
- 采样点与轨迹点上限均为 30000，超出才等间隔抽稀（`summary.downsampled` 会标记为 `true`）。

## ⚠️ 已知限制（对应设计书 Phase 7 持续迭代）

- iGPSPORT / Garmin / Strava / COROS 真实 API 适配器为骨架（需开发者凭证）；
- FIT 解析依赖 `fitparse`；爬升与 NP 在文件未记录时由采样点推算，与平台官方口径可能略有差异；
- 未配置 `VITE_AMAP_KEY` 时 FIT 页用内置 SVG 轨迹简图（无路网底图、无回放）；
- 超长活动（>30000 采样点）会抽稀，且单次详情响应可能达数 MB，生产建议加分页或抽稀参数；
- 长连接方案已**主动移除**：SSE 端点会独占请求槽位（全站仅 8 个），几个并发用户即可让 API 含健康检查一起失活，故统一改为短轮询 `run-status`；
- 个别受限环境（如沙箱、CI 关闭安装脚本）下 esbuild/rollup 可能缺原生二进制，补装即可：  
  `yarn add -D --ignore-scripts @esbuild/win32-x64 @rollup/rollup-win32-x64-msvc`（macOS/Linux 无需处理）。
