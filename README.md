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
| 📄 FIT 解析        | 上传 .fit 解析汇总指标；曲线支持**时间 / 距离双维度**切换；GPS 轨迹用**高德地图**回放；导入历史可查看/删除，按文件哈希去重入库   |
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
6. **FIT 解析**页上传 .fit 文件：切换**时间/距离**维度看曲线，点播放做**轨迹回放** —— 手上没文件就先跑
   `python backend/tools/make_sample_fit.py`（想看回放效果可用
   `python backend/tools/make_sample_fit.py tools/sample_ride_long.fit 3600` 生成 1 小时数据）；
7. 任意页面按 **Ctrl/Cmd + K** 唤起命令面板。

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
│       ├── activities/         # 活动/同步状态/FIT 详情、去重、坐标转换、FIT 解析
│       ├── synclogs/           # 同步日志
│       ├── dashboard/          # 仪表盘统计
│       └── core/               # seed_demo 管理命令
│   └── tools/                  # make_sample_fit.py：合成样例 FIT（无真实文件时验证用）
└── frontend/
    └── src/
        ├── api/                # fetch 客户端（401 自动刷新）+ 类型 + React Query hooks
        ├── stores/             # Zustand：认证 / UI 状态
        ├── components/         # 三栏布局、命令面板、管道节点、状态图标、高德轨迹回放
        ├── utils/              # 坐标转换(WGS-84↔GCJ-02)、高德加载器、格式化
        └── pages/              # 登录 / 仪表盘 / 管道 / 编辑器 / 矩阵 / FIT 解析 / 账号 / 日志 / 设置
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
POST /api/activities/upload-fit/                  上传并解析 FIT 文件（multipart）
GET  /api/activities/fit-history/                 FIT 导入历史（轻量列表，不含采样点）
GET  /api/activities/{id}/fit/                   该活动的 FIT 解析详情
DELETE /api/activities/{id}/fit/                 删除解析详情（?with_activity=1 连活动一并删除）
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

## 📄 FIT 解析说明

上传入口在前端「FIT 解析」页，也可直接调接口：

```bash
curl -X POST http://127.0.0.1:8000/api/activities/upload-fit/ \
  -H "Authorization: Bearer <access>" -F "file=@ride.fit"
```

解析产物（`ActivityFitDetail`）分四块：

| 字段 | 内容 |
| --- | --- |
| `summary` | 距离 / 时长 / 爬升下降 / 卡路里 / 平均·最大心率 / 平均·最大功率 / NP / 踏频 / 速度 |
| `samples` | 采样序列（时间、累计距离、速度、心率、功率、踏频、海拔、经纬度），上限 30000 点（≈8 小时 1Hz，实际等于全量保留） |
| `track` | GPS 轨迹 `[经度, 纬度]`，上限 30000 点，与采样同源但独立保留全部含 GPS 的点 |
| `device` | 设备厂商 / 序列号（来自 file_id） |

### 双维度曲线

FIT 解析页顶部可切换横轴：**按时间**（X 轴为运动时长，看节奏与心率漂移）或**按距离**
（X 轴为累计里程，方便对比同一段路的功率/海拔表现）。心率·功率图与速度·海拔图同步切换，
鼠标移到曲线上会同步定位地图上的当前位置。

累计距离优先取设备记录的 `distance`；设备不写时按相邻 GPS 点球面距离（Haversine）累加，
保证 X 轴始终有值且单调不减。

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
- 手上没有真实文件时：`python backend/tools/make_sample_fit.py [输出路径] [点数]` 会合成一份合规样例，
  例如 `python backend/tools/make_sample_fit.py tools/sample_ride_long.fit 3600` 生成 1 小时骑行数据用于测试回放；
- 采样点与轨迹点上限均为 30000，超出才等间隔抽稀（`summary.downsampled` 会标记为 `true`）。

## ⚠️ 已知限制（对应设计书 Phase 7 持续迭代）

- iGPSPORT / Garmin / Strava / COROS 真实 API 适配器为骨架（需开发者凭证）；
- FIT 解析依赖 `fitparse`；爬升与 NP 在文件未记录时由采样点推算，与平台官方口径可能略有差异；
- 未配置 `VITE_AMAP_KEY` 时 FIT 页用内置 SVG 轨迹简图（无路网底图、无回放）；
- 超长活动（>30000 采样点）会抽稀，且单次详情响应可能达数 MB，生产建议加分页或抽稀参数；
- SSE 采用轮询 PipelineRun 的简化实现，生产可切换 Redis Pub/Sub；
- 个别受限环境（如沙箱、CI 关闭安装脚本）下 esbuild/rollup 可能缺原生二进制，补装即可：  
  `yarn add -D --ignore-scripts @esbuild/win32-x64 @rollup/rollup-win32-x64-msvc`（macOS/Linux 无需处理）。
