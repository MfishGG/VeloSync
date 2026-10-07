# iGPSPORT 开放平台接入申请材料

> 官方入口：<http://www.igpsport.com/support/app/openapi>
> 提交方式：填好下方资料，**邮件发送至 `global@igpsport.com`**，附件带上应用 Logo。
> 官方原文（照录）：
>
> | Content | Description |
> | --- | --- |
> | Application Name | Within 50 words |
> | Application Logo | 120x120 pixels, PNG format (send as an attachment) |
> | App Introduction | Within 100 words |
> | redirect_url | User authorization redirect address |
> | callback_url | Sports data callback URL |
> | Company name | Company legal entity name |
> | Official website | official website link |
>
> 官方**未要求**项目说明书 / 需求文档 / 软著 / 营业执照。原话是「complete the developer profile」，
> 即上表这 7 项。但邮件里附一段项目说明能显著提高审核通过率（见第五节）。

---

## 一、逐项填写指南（个人开发者）

个人开发者最容易卡住的是 **Company name** 和 **Official website** 这两项 —— 官方给的是企业模板。
下面是按个人身份的可落地填法，**不是编造**，而是如实说明主体性质。

| # | 官方要求 | 你可以这样填 | 说明 |
| --- | --- | --- | --- |
| 1 | Application Name（≤50 词） | `VeloSync（速同）` | 就是产品名。英文名 + 中文名即可，不用长句 |
| 2 | Application Logo | **附件**：`logo-120.png` | 120×120 PNG，已生成，见第二节 |
| 3 | App Introduction（≤100 词） | 见第三节 | 一段话说清「做什么 / 用哪些数据 / 怎么用」 |
| 4 | redirect_url | `https://你的域名/api/accounts/igpsport/callback/` | OAuth 授权后浏览器跳回的地址。见第四节 |
| 5 | callback_url | 同上（或单独一个数据回调地址） | 运动数据推送的接收地址。见第四节 |
| 6 | Company name | `个人开发者（Individual Developer）` | **如实写**。不要编造公司名 —— 被核实会直接拒 |
| 7 | Official website | 有备案域名就填域名；没有就填**项目仓库地址**并注明是个人项目 | 见第四节，这是最难受的一项 |

### 关于 Company name 的实话

官方只列了「公司法定实体名称」这一种，但**不代表个人不能申请**。这份清单是模板，
国内几家骑行平台（iGPSPORT / COROS / 迈金）对小体量开发者都是**邮件人工审核**，
不是自动化表单 —— 你如实写个人、把项目讲清楚，对方大概率会回你「可以用个人身份接入」，
或者明确告诉你需要什么补充。**先发出去问，比卡在这里猜要强得多。**

邮件里建议加一句：

> 本项目为个人独立开发的非商业性运动数据聚合工具，目前处于开发测试阶段，
> 暂无公司主体。如必须以企业主体申请，请告知是否接受以个人身份签署开发者协议。

---

## 二、应用 Logo（已生成）

文件：`wx-frontend/assets/brand/logo-120.png`　规格：120×120 PNG

设计是「速度线 + 环形同步箭头」，主色靛蓝 `#4f46e5`，与小程序/网页端同源。

重新生成（若改过图形）：

```bash
cd wx-frontend && python tools/make_icons.py
```

会同时输出 512 / 144 / 120 / 96 四档，120 那档就是申请用图。

---

## 三、App Introduction 文案（约 95 词，可直接用）

**中文版：**

> VeloSync（速同）是一款跨平台运动数据同步中枢，为同时使用多个骑行/运动平台的用户
> 解决数据分散问题。应用通过 iGPSPORT 开放平台 OAuth 授权，读取用户的骑行记录
> （时间、距离、速度、心率、踏频、功率、GPS 轨迹等），在本应用内统一汇总、去重与可视化，
> 并支持导出 FIT 文件进行分析。所有数据仅用于用户本人的数据管理，不涉及社交分享，
> 不会向第三方转售或用于广告投放。目前已支持 Web 端与微信小程序两个客户端。

**English version（官方页面是英文，建议附上）：**

> VeloSync is a cross-platform workout data synchronization hub. It helps athletes who use
> several cycling and sports platforms keep their data in one place. With OAuth authorization
> via the iGPSPORT Open Platform, VeloSync reads a user's own ride records (time, distance,
> speed, heart rate, cadence, power, and GPS track), then aggregates, de-duplicates, and
> visualizes them, and supports exporting FIT files for further analysis. Data is used solely
> for the user's own record management. We do not share data publicly, resell it, or use it
> for advertising. Available as both a web app and a WeChat Mini Program.

---

## 四、redirect_url / callback_url / Official website

这三项是**技术性最强、也最容易被打回**的部分。核心约束：**必须是对方能访问到的公网地址**。

### 4.1 你项目里对应的真实端点

| 用途 | 项目中的路径 | 说明 |
| --- | --- | --- |
| OAuth 授权跳转（redirect_url） | `/api/accounts/igpsport/callback/` | 后端 `apps/platforms/views.py` 的 `CallbackView` |
| 运动数据回调（callback_url） | `/api/accounts/igpsport/callback/` | 当前实现里两者复用同一端点 |

后端基址由 `.env` 的 `SOCIAL_REDIRECT_BASE_URL` 决定，完整地址 = 基址 + 上表路径：

```ini
SOCIAL_REDIRECT_BASE_URL=https://你的域名
# → redirect_url = https://你的域名/api/accounts/igpsport/callback/
```

> 代码里 `AuthorizeView` 用 `request.build_absolute_uri()` 动态拼 `redirect_uri`
> （见 `apps/platforms/views.py`），所以改回调基址只需改 `SOCIAL_REDIRECT_BASE_URL`，不用动代码。

### 4.2 三种方案，按你的实际情况选

| 方案 | 可行性 | 怎么做 |
| --- | --- | --- |
| **A. 内网穿透** | ⭐ 推荐先走这条 | 用 cpolar / ngrok / frp 把本地 8000 映射成公网 HTTPS 域名，拿到的域名直接当 redirect_url 填。免费版域名会变，够用于**联调验证**，但正式上线要换成稳定的 |
| **B. 买域名 + 服务器 + 备案** | 正式上线的唯一路径 | 国内服务器需 ICP 备案（约 2–3 周）。备案主体个人也能办，不需要公司。备案下来后 `https://你的域名` 就是合法的 redirect_url 与 official website |
| **C. 只填仓库地址** | 用于**先把申请发出去** | Official website 填 GitHub/Gitee 仓库地址，注明「个人项目，尚未备案」。审核方可能同意先给测试凭证，也可能要求你补备案 —— 试了才知道 |

> **注意**：`redirect_url` 填 `http://127.0.0.1:8000/...` 通常会被拒（对方回调不到你本机）。
> 但 OAuth2 的授权码模式在联调阶段可以用 `localhost` —— 建议**先按 A 方案拿一个公网地址**填进去。

### 4.3 Official website 的诚实填法

个人项目没有官网时，**不要编一个打不开的域名**。建议：

```
Official website: https://github.com/<你的账号>/velosync
（个人开发项目，开源仓库地址；正式站点备案中）
```

如果连仓库都没有，就把这句话写进邮件正文，让 Official website 一栏留空并说明原因。
**留空+解释 比 编造假域名 安全得多。**

---

## 五、建议附上的项目说明（非必须，但强烈建议）

官方没要求，但邮件审核场景下，「说不清是什么」是最常见的打回理由。
建议在邮件正文里附这样一段（可精简）：

```
VeloSync 是一个个人开发的跨平台运动数据同步工具，用于解决「骑行数据散落在
iGPSPORT / 佳明 / Strava / COROS 多个平台」的问题。

技术上：后端 Django + MySQL，通过 OAuth2.0 授权接入各平台开放接口，
读取用户本人的运动记录并归一到统一数据模型；前端提供 Web 与微信小程序两个客户端。
已实现的 iGPSPORT 相关能力：
  - OAuth2.0 授权绑定（authorize → callback → token 加密存储）
  - 读取用户骑行活动列表与单次活动详情
  - FIT 文件解析（时间/距离双维度曲线、心率/踏频/功率图表、GPS 轨迹回放）
  - 多平台数据去重与同步

申请用途：仅用于我本人及少量测试用户的运动数据管理，无商业化计划，
不对外提供数据转售、不做广告投放。恳请开通开发者测试权限，感谢。
```

---

## 六、申请流程与时间预期

1. 准备好 `logo-120.png`（附件）
2. 按第三节文案填好 App Introduction（中英各一份）
3. 决定 redirect_url / callback_url（建议先用内网穿透拿公网域名）
4. 邮件发至 `global@igpsport.com`，主题建议：
   `Application for iGPSPORT Open Platform Developer Access - VeloSync`
5. 等待回复（邮件人工审核，通常数个工作日；对方会就技术细节进一步沟通）
6. 拿到 `client_id` / `client_secret` 后，填入 Django Admin → 平台 → iGPSPORT，
   或执行 `python manage.py set_platform_oauth igpsport --client-id ... --client-secret ...`

拿到凭证后，「账号管理」页的 iGPSPORT 就会从「演示身份绑定」自动切换为**真实 OAuth 授权**。

---

## 七、如果被拒 / 长期无回复

国内运动平台的开放接口对小开发者普遍收紧，这是行业现状，不是你项目的问题。替代路径：

| 路径 | 说明 |
| --- | --- |
| **FIT 文件导入** | 项目已支持 —— 用户在 iGPSPORT App 里导出 FIT，从小程序聊天记录或网页上传。**完全不需要开放平台权限**，是目前最可靠的兜底 |
| 官方 App 导出 | iGPSPORT App 内可导出单次活动，配合 FIT 导入已经能覆盖大部分使用场景 |
| 其他平台 | Strava 的开放平台申请流程更标准化；佳明有公开的 Connect IQ / Health API 文档 |

> 也就是说：**iGPSPORT 授权拿不到，不影响项目可用**。FIT 导入链路已经跑通并通过测试。
