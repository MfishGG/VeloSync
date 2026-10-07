# VeloSync 速同 · 微信小程序端

> 与 `frontend`（Web 工作台）功能对等的原生微信小程序，共用同一套 Django 后端 API。
> 技术选型：**原生小程序**（WXML + WXSS + JS，无 Taro / uni-app 依赖），图表用 **Canvas 2D** 手绘，轨迹用 **`map` 组件** 回放。

---

## 一、功能对应表（Web ↔ 小程序）

| 模块 | Web 实现 | 小程序实现 | 备注 |
| --- | --- | --- | --- |
| 登录 / 注册 | React 表单 + JWT | `pages/login` | 账密 / 注册切换 + **微信一键登录**（无 QQ·微博） |
| 仪表盘 | Recharts 饼图 + 折线 | `pages/dashboard` | Canvas 2D（`utils/chart.js` 的 `drawPie` / `drawTrend`） |
| 同步任务列表 | TanStack Query 轮询 | `pages/pipelines` | 短轮询（小程序不支持 SSE） |
| 新建任务向导 | 四步向导 | `pages/pipeline-new` | 四步分步校验，`components/sync-form` 复用 |
| 任务编辑 / 执行图 | React Flow + SSE 实时变色 | `pages/pipeline-edit` | 自绘执行图 + `node--running` 脉冲动画 + 轮询刷新 |
| 活动矩阵 | 二维表格 | `pages/matrix` | `scroll-x` 矩阵 + 点格同步 |
| FIT 上传 / 历史 | `<input type=file>` | `pages/fit` | `wx.chooseMessageFile`（小程序唯一读本地文件途径） |
| FIT 详情图表 | Recharts 双维度 + 叠加 | `pages/fit-detail` | 15 行分图（无数据留空白）+ 多指标叠加 |
| GPS 轨迹回放 | 高德 JS API | `pages/fit-detail` | `map` 组件 polyline + 播放/暂停/倍速/进度条 |
| 平台账号管理 | OAuth 授权跳转 | `pages/accounts` | **三级绑定兜底**，见第四节 |
| 同步日志 | 表格 + 时间轴 | `pages/logs` | 级别 + 任务筛选，上拉加载 |
| 设置 | 表单 | `pages/settings` | 接口地址热切换 + 连通性测试 |

> 坐标纠偏（WGS-84 → GCJ-02）算法与后端 `apps/activities/coords.py`、Web 端 `utils/coords.ts` **同源**，见 `utils/coords.js`。

---

## 二、目录结构

```
wx-frontend/
├── app.js                      # 全局登录态恢复 / 自定义 baseUrl
├── app.json                    # 12 页面 + 5 tabBar + 定位权限声明
├── app.wxss                    # 仅 @import styles/common.wxss
├── config.js                   # ★ 后端地址 / 官方小程序 / 官方 App 链接
├── project.config.json         # urlCheck:false（本地联调免域名校验）
├── sitemap.json
├── styles/common.wxss          # 设计系统（CSS 变量、.card/.btn/.chip/.field/...）
├── utils/
│   ├── auth.js                 # JWT 持久化 + 登录跳转
│   ├── request.js              # api() 自动带 Bearer、401 单飞刷新重试、upload()、poll()
│   ├── coords.js               # WGS-84 → GCJ-02、抽稀 toPolylines、bounds
│   ├── fitMetrics.js           # 15 项 FIT 指标注册表（与后端 METRIC_SPEC 对齐）
│   ├── chart.js                # Canvas 图表基元 + 分图/叠加/饼图/趋势
│   ├── format.js               # 时长/距离/时间/相对时间格式化
│   └── theme.js                # 颜色常量、同步状态、日志级别
├── api/index.js                # 全部接口封装（auth/platforms/pipelines/activities/logs/dashboard）
├── components/sync-form/       # 四段式同步配置表单（step 属性按步渲染）
├── pages/                      # 12 个页面（每页 js/json/wxml/wxss 四件套）
├── assets/
│   ├── brand/                  # logo-512 / logo-144 / logo-96
│   └── tabbar/                 # 5 组 × 2 态 = 10 个 81×81 图标
└── tools/
    ├── make_icons.py           # Pillow 生成品牌图标 + tabBar 图标
    ├── check.js                # 静态自检（JS 语法 / JSON / 四件套 / 图标 / 事件绑定）
    ├── api-smoke.js            # 26 项 API 契约冒烟测试（需后端）
    ├── chart-test.js           # 26 项图表绘制无头测试
    └── make_preview.js         # 生成 preview/index.html 静态预览页（需后端）
```

---

## 三、快速开始

### 1. 启动后端

小程序与 Web 共用后端，先按根目录 `README.md` 把后端跑在 `http://127.0.0.1:8000`。

### 2. 用微信开发者工具导入

1. 打开「微信开发者工具」→ **导入项目**
2. 目录选择：`D:\Code\VeloSync\wx-frontend`
3. AppID：先选 **「测试号」**（`project.config.json` 里是 `touristappid`）即可跑通全部功能；正式发布时替换为你在微信公众平台申请的小程序 AppID
4. 后端类型选默认（不使用云服务）

### 3. 打开本地域名校验开关（必须）

开发者工具 → 右上角 **详情 → 本地设置** → 勾选：

> ☑ 不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书

否则 `http://127.0.0.1:8000` 会被拦截（`project.config.json` 已设 `urlCheck: false`，但工具内开关仍需手动确认）。

### 命令行调用（可选，便于自动化）

工具**首次安装时服务端口是关闭的**，直接跑 CLI 会报错：

```bash
CLI="/d/Program Files (x86)/Tencent/微信web开发者工具/cli.bat"
"$CLI" open --project "D:\Code\VeloSync\wx-frontend"
# [error] 工具的服务端口已关闭。要使用命令行调用工具，请手动打开工具 -> 设置 -> 安全设置，将服务端口开启。
```

一次性开启：IDE 内 **设置 → 安全设置 → 服务端口 → 打开**。之后即可无人值守：

```bash
"$CLI" open    --project "D:\Code\VeloSync\wx-frontend"     # 打开项目
"$CLI" preview --project "D:\Code\VeloSync\wx-frontend"     # 生成预览二维码
"$CLI" upload  --project "D:\Code\VeloSync\wx-frontend" -v 1.0.0 -d "描述"
```

> 坑：`微信开发者工具.exe` 本身**不认 `-o` 参数**（直接报 `bad option: -o`），打开项目必须走 `cli.bat open --project`。

### 4. 在手机上真机预览

手机上跑的是**开发版**小程序。要看到它，三个条件必须同时满足：一个能预览的 AppID、手机能连上你的后端、手机端打开调试开关。

#### 4.1 关键前提：`touristappid` 不能预览，要用「测试号」

`project.config.json` 里的 `appid: "touristappid"` 是**游客模式**，只能在电脑模拟器里跑，**点「预览」会提示需要填写 AppID**。

要真机预览，去申请一个**小程序测试号**（免费、无需企业资质、微信扫码即得）：

1. 浏览器打开 <https://mp.weixin.qq.com/wxamp/sandbox?doc=1>
2. 微信扫码 → 立即获得一组测试号（含 AppID 与 AppSecret）
3. 把得到的 **AppID** 填进 `project.config.json` 的 `appid`
4. 顺手把 **AppSecret** 填进 `backend/.env` 的 `WECHAT_MP_APP_ID` / `WECHAT_MP_APP_SECRET` —— 「微信一键登录」会从演示身份切换成真实 `code2session` 登录

> 官方文档原话：测试号「可以在开发者工具创建项目进行开发测试，**以及真机预览体验**」。
> 参见 [申请测试号](https://developers.weixin.qq.com/miniprogram/dev/devtools/sandbox.html)。

#### 4.2 让手机能访问到你的后端

`127.0.0.1` 在手机上指向**手机自己**，必须换成电脑的内网 IP：

```bash
# 1. 查内网 IP（本机当前为 192.168.31.254）
ipconfig | findstr /i "IPv4"

# 2. 后端必须以 0.0.0.0 启动 —— 默认只监听回环，手机连不上
cd backend && ./.venv/Scripts/python.exe manage.py runserver 0.0.0.0:8000
```

```powershell
# 3. 放行防火墙（首次需要，管理员身份运行）
New-NetFirewallRule -DisplayName "VeloSync Dev 8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
```

然后在**手机上**打开小程序（此时连不上，属正常）→ 点登录页底部的 **「接口地址：… · 修改」** → 填 `http://192.168.31.254:8000/api` → **测试连接** → 保存。

> 登录页这个入口**未登录也能用**，是专门为真机调试加的 —— 否则会被登录拦截挡在「我的 → 设置」外面，形成死锁。
> 开发者工具里保持 `http://127.0.0.1:8000/api` 即可，两边各存各的地址，互不影响。

#### 4.3 手机端必须「打开调试」

`project.config.json` 里的 `urlCheck: false` **只在电脑上生效**。真机上 http 请求默认会被域名校验拦掉，报 `url not in domain list`。

手机扫码打开预览版后，点右上角 **「···」→「打开调试」**，小程序会自动重启并放行。

> 官方文档同样这么说：「在真机上如需跳过网络请求域名的校验，需要点击右上角选项，选择『打开调试』即可」。
> 将来换成已备案的 HTTPS 域名后，这一步就不需要了。

#### 4.4 三种环境的地址对照

| 场景 | `config.js` 的 `baseUrl` | 额外要求 |
| --- | --- | --- |
| 开发者工具模拟器 | `http://127.0.0.1:8000/api` | 勾选「不校验合法域名」 |
| 真机预览 | `http://192.168.31.254:8000/api` | 后端跑 `0.0.0.0:8000`；防火墙放行 8000；手机端点「打开调试」；与电脑同一 WiFi |
| 正式发布 | `https://api.你的域名/api` | 必须 HTTPS；域名在「开发管理 → 开发设置 → 服务器域名 → request 合法域名」登记 |

> **定位权限**：地图组件带 `show-location`（显示「我的位置」蓝点），需要 `scope.userLocation` 授权，因此 `app.json` 声明了 `requiredPrivateInfos: ["getLocation"]`。若小程序后台未配置「用户隐私保护指引」，蓝点可能不显示 —— **不影响轨迹回放**（polyline / markers / include-points 都不依赖定位）。

### 5. 不装开发者工具，先看界面长什么样

小程序必须跑在微信自己的运行时里，**浏览器和 VS Code 都不能真正渲染它**。但「看界面」不需要真运行时 —— 只要拿到「页面数据 + WXML + WXSS」就能还原。本仓库为此提供了一个生成器：

```bash
cd wx-frontend
node tools/make_preview.js          # 需要后端已在 127.0.0.1:8000
```

它会在 `preview/index.html` 生成一份**单文件、自包含**的静态预览：

| 用到的 | 说明 |
| --- | --- |
| 真实页面逻辑 | 用一份最小 `wx` 垫片在 Node 里真实执行各页面的 `onLoad` / `onShow`，对接真实后端拿数据 |
| 真实 WXML | 自带的 WXML 渲染器，支持 `wx:for` / `wx:if` / `wx:elif` / `wx:else` / `{{}}`，自定义组件会展开它自己的 WXML 并跑一遍 `observers` + `attached` |
| 真实 WXSS | `rpx → px`（750rpx = 375px），公共样式全局、页面样式按 `[data-page]` 作用域隔离 |
| 真实图标 | 品牌图与 tabBar 图标内联成 data URI，所以是**一个文件**，拷到哪都能打开 |
| 图表 | `utils/chart.js` / `fitMetrics.js` 原样内联进页面，用真实采样数据补绘饼图、30 天趋势、15 行分图/叠加图；轨迹用 GCJ-02 纠偏后的点手绘 |

打开方式：浏览器 / VS Code 里右键 `preview/index.html` → **Open with Live Preview**（或直接拖进 Chrome）。
顶部有 12 个页面的切换标签，右侧是 375×760 的设备框（含模拟状态栏、导航栏、tabBar）。

> **它是静态快照**：点击无效、输入框只读、`position: fixed` 被收进设备框。用途是**看视觉与信息结构**，不是替代开发者工具的真机调试。
> 后端地址可用环境变量覆盖：`VELOSYNC_API=http://192.168.1.5:8000/api node tools/make_preview.js`。

---

## 四、第三方账号绑定的实现与限制（重要）

### 4.1 微信的硬限制

微信小程序 **不允许**直接唤起第三方 App（`garminconnect://`、`strava://` 这类 URL Scheme 在小程序内无效）。可行的官方通道是 **`wx.navigateToMiniProgram` 跳转对方已上架的小程序**。

因此小程序端实现了 **三级兜底**，按顺序尝试，失败自动降级：

| 级别 | 方式 | 触发条件 | 用户看到什么 |
| --- | --- | --- | --- |
| ① 跳官方小程序 | `wx.navigateToMiniProgram({ appId, path })` | `config.js → officialMiniPrograms[平台].appId` 已填写 | 直接跳到 iGPSPORT / 佳明 官方小程序完成授权，返回后点「我已完成授权」 |
| ② 复制链接开 App | `wx.setClipboardData` + 引导到系统浏览器 | ① 不可用（未填 appId / 对方未上架） | 复制官方链接 → 打开手机浏览器 → 唤起官方 App 登录 → 回来点「我已完成授权」 |
| ③ 演示身份 | `POST /api/platforms/{id}/demo-bind/` | ① ② 都不可用（本地未配 OAuth 凭证） | 一键绑定「演示身份」，本地/演示环境可直接跑通全流程 |

对应代码：`pages/accounts/accounts.js` 的 `bindViaMiniProgram()` / `bindViaApp()` / `demoBind()` / `showHelp()`。

### 4.2 微信一键登录

`pages/login` 走 `wx.login()` 拿 `code` → `POST /api/auth/wx/miniprogram/`：

- 后端已配置 `WECHAT_MP_APP_ID` + `WECHAT_MP_APP_SECRET` → 调微信 `code2session` 换取 `openid/unionid`，真实登录（拿到 `unionid` 时与 Web 端微信登录 **复用同一账号**）；
- 未配置 → **自动降级为演示身份**，用本地 `deviceId` 生成稳定假身份，保证开发期不阻塞。

**小程序端只提供微信登录**，不含 QQ / 微博按钮（那两个仅在 Web 端）。登录页底部会按 `/api/auth/wx/miniprogram/` 返回的 `mode` 显示绿色「已接入微信真实登录」或蓝色「当前为演示模式」提示。

### 4.3 个人信息页（`pages/mine`）

顶部展示**微信真实头像**（`GET /api/auth/me/` 的 `avatar` 字段，取自第一个有头像的第三方绑定），
头像加载失败（微信头像链接会过期）自动回退到品牌图标。

下方「微信账号」卡片展示绑定详情，全部来自 `/api/auth/me/` 的 `social` 数组：

| 展示项 | 来源字段 |
| --- | --- |
| 昵称 | `social[].nickname` |
| UnionID | `social[].unionid`（有才显示） |
| OpenID | `social[].openid`（点击可复制） |
| 绑定时间 | `social[].bound_at` |
| 徽标 | `openid` 以 `mock-` 开头 → 黄色「演示身份」，否则绿色「真实登录」 |

未绑定时卡片显示引导文案。后端 `_token_pair()` 与 `MeView` 都会 `prefetch_related("social_accounts")`，
所以登录响应里就已带齐这些字段，页面无需二次请求。

> **为什么 `wechat_mp` 不在网页端出现**：它依赖 `wx.login()` 返回的 `code`，浏览器里拿不到。
> 后端把它登记在 `social.MINIPROGRAM_ONLY`，`GET /api/auth/social/providers/` **默认只返回网页端可用的项**；
> 只有显式带 `?channel=miniprogram` 才会附上 `wechat_mp`（响应中带 `channel: "miniprogram"`）。

---

## 五、图标说明

品牌主色 **靛蓝 `#4f46e5`**，图形语义为 **「速度线 + 环形同步箭头」**（速度 → 斜向流线，同步 → 环抱双向箭头）。

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `assets/brand/logo-512.png` | 512×512 | 小程序后台「小程序头像」上传 |
| `assets/brand/logo-144.png` | 144×144 | 分享卡片 / 高清界面 |
| `assets/brand/logo-96.png` | 96×96 | 列表缩略 |
| `assets/tabbar/{dashboard,sync,matrix,fit,mine}.png` | 81×81 | tabBar 未选中（灰 `#94a3b8`） |
| `assets/tabbar/*-on.png` | 81×81 | tabBar 选中（靛蓝 `#4f46e5`） |

重新生成（脚本用 4× 超采样抗锯齿，依赖 Pillow）：

```bash
# 使用隔离环境，避免污染后端 venv
C:/Users/小鱼/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/make_icons.py
```

> **与 Web 端同源**：Web 端使用同一套几何参数的矢量版本，见 `frontend/public/favicon.svg`
> 与 `frontend/src/components/BrandMark.tsx`。改动图形时两边都要同步。
>
> **一个坑**：Pillow 的 `draw.arc()` 线宽是**向内**扩展的，所以这里环形箭头的外沿就等于半径
> `0.325`；而 SVG 的 `stroke` 以路径为中心线，路径半径要写 `0.325 − 描边/2`。两边视觉对不上时先查这点。

---

## 六、自测脚本

```bash
cd wx-frontend

# 静态自检：JS 语法 / JSON 合法性 / 页面四件套 / 图标资产 / WXML 事件绑定
node tools/check.js

# 图表绘制逻辑无头测试（mock Canvas，26 项）
node tools/chart-test.js

# API 契约冒烟测试（需后端已启动，26 项）
node tools/api-smoke.js

# 生成浏览器可打开的静态预览页（需后端已启动）
node tools/make_preview.js
```

`check.js` 不依赖后端，适合放进 pre-commit 或 CI；后三个需要后端在 `127.0.0.1:8000`。

覆盖范围：图表基元（刻度/坐标轴/数值缩写）、15 项指标注册表与双维度取值、分图模式（15 行 + 无数据空白图位）、叠加模式（多指标 + 图例）、饼图/趋势图边界（空数据 / 全 0 不产生 NaN）、坐标纠偏与抽稀。

---

## 七、需要你提供的资料

> 以下不是跑起来的必要条件（缺省会自动降级到演示模式），但补齐后才能对接真实平台。

### 7.1 微信小程序（用于「微信一键登录」真实生效）—— ✅ 已配置

| 项 | 说明 | 填到哪里 | 当前值 |
| --- | --- | --- | --- |
| **小程序 AppID** | 微信公众平台 → 开发管理 → 开发设置 | `wx-frontend/project.config.json → appid` | `wxd12e39be6f29d81e` |
| **小程序 AppID** | 与上面同一个 | `backend/.env → WECHAT_MP_APP_ID` | 同上 |
| **小程序 AppSecret** | 同上页面「重置」获取 | `backend/.env → WECHAT_MP_APP_SECRET` | 已配置 |

两项都就位后，`GET /api/auth/wx/miniprogram/` 返回 `{"enabled": true, "mode": "oauth"}`，
「微信一键登录」即走真实 `code2session`，拿到真实 openid / 昵称 / 头像。

> **验证凭证是否有效**：用一个无效 code 打微信接口，返回 `40029 invalid code` 就说明
> AppID/Secret 已被微信接受（`40125` = Secret 错，`40013` = AppID 错）。
>
> **限制**：测试号拿不到 `unionid`，所以「小程序登录」与「网页扫码登录」共用账号这一能力
> 需要正式小程序 + 微信开放平台才能验证。

### 7.2 各平台官方小程序 appId（用于「跳官方小程序」绑定，级别 ①）

| 平台 | 需要什么 | 填到哪里 |
| --- | --- | --- |
| iGPSPORT | 官方小程序的**原始 AppID**（wx 开头） | `config.js → officialMiniPrograms.igpsport` |
| 佳明 Garmin | 同上 | `config.js → officialMiniPrograms.garmin` |
| Strava | 同上 | `config.js → officialMiniPrograms.strava` |
| COROS | 同上 | `config.js → officialMiniPrograms.coros` |

获取方式：微信里搜到该品牌官方小程序 → 右上角「···」→「关于」→ 复制「AppID」。
> 若某平台未上架小程序，该项留空即可，会自动走级别 ②。

### 7.3 平台 OAuth 凭证（用于真实数据同步）

| 平台 | 需要 | 填到哪里 |
| --- | --- | --- |
| iGPSPORT | `client_id` / `client_secret` / `authorize_url` / `token_url` | Django Admin → 平台 → 对应字段，或用 `python manage.py set_platform_oauth` |
| 佳明 Garmin | 同上（Garmin Connect 开发者计划） | 同上 |
| Strava | 同上（Strava API 应用） | 同上 |
| COROS | 同上 | 同上 |

### 7.4 正式发布还要有

- 已备案的 **HTTPS 域名**（`request 合法域名`，微信要求 ICP 备案）
- 小程序的 **类目**（工具类）与 **隐私协议**（涉及定位 `getLocation`，需在公众平台「用户隐私保护指引」中声明）

---

## 八、已知限制

| 限制 | 原因 | 现状 |
| --- | --- | --- |
| 无法直接唤起第三方 App | 微信小程序平台限制 | 三级兜底（见第四节） |
| 无 SSE 实时推送 | 小程序不支持 `EventSource` | 改为短轮询 `pollRun()`，1.2s 间隔、30 次上限 |
| 无法读取手机本地文件 | 沙箱限制 | 用 `wx.chooseMessageFile` 从聊天记录选 `.fit` |
| 轨迹地图底图为腾讯地图 | 小程序 `map` 组件内置 | 与 Web 端高德底图风格不同，坐标已统一为 GCJ-02 |
| 图表能力弱于 Recharts | Canvas 手绘 | 已覆盖 15 指标分图 + 多指标叠加 + 饼图/趋势 |
| 本地 `127.0.0.1` 仅开发者工具可用 | 真机无法访问回环地址 | 真机改用内网 IP 或 HTTPS 域名 |
| 浏览器 / VS Code 无法渲染小程序 | 没有 WXML 渲染层与 `wx.*` 运行时 | 用 `tools/make_preview.js` 生成静态预览页看界面（见第三节第 5 小节），真机调试仍需微信开发者工具 |

---

## 九、在 VS Code 里开发

VS Code 能写、能调，但**不能渲染**小程序界面 —— 没有 WXML 渲染层，也没有 `wx.*` 运行时。要真正跑起来，只能用微信开发者工具。它在这个项目里能帮上忙的是：

| 能力 | 怎么用 |
| --- | --- |
| WXML / WXSS 高亮、补全、格式化 | 根目录 `.vscode/settings.json` 已把 `*.wxml` 关联到 html、`*.wxss` 关联到 css，并打开 Emmet；再装扩展 `qiu8310.minapp-vscode`（WXML Language Service）可获得标签、属性、自定义组件补全 |
| 跑自测 | `Ctrl/Cmd + Shift + P` → **Tasks: Run Task**，已预置「小程序：全量静态校验 / API 契约冒烟测试 / 图表绘制测试 / 生成静态预览页」 |
| 一键起服务 | 同一菜单里有「后端：启动开发服务器 (127.0.0.1:8000)」「Web 前端：启动开发服务器 (5173)」 |
| 调试页面逻辑 | 页面 JS 就是普通 CommonJS，VS Code 调试器可直接对 `tools/*.js` 打断点（`api-smoke.js` / `chart-test.js` / `make_preview.js`） |

`.vscode/` 下只有 `settings.json` / `extensions.json` / `tasks.json` 进版本库（`.gitignore` 用 `!.vscode/xxx` 白名单放行），个人状态与缓存仍然忽略。

其他可选扩展：`miniprogramlab.devtool`（较新的 WXML 语言工具）、`wechat-miniprogram` 官方系列。注意**不要同时装多个 WXML 扩展**，会互相抢语言服务。
