# iGPSPORT 开放平台申请 · 邮件正文（可直接复制修改）

**收件人**：global@igpsport.com
**主题**：Application for iGPSPORT Open Platform Developer Access - VeloSync

**附件**：logo-120.png（120×120 PNG，本文件同目录）

**注意**：文中 `【】` 标记处需要你替换成自己的真实信息，其余可直接用。

---

## 正文

Dear iGPSPORT Open Platform Team,

I would like to apply for developer access to the iGPSPORT Open Platform (OAuth 2.0)
for my personal project, **VeloSync**.

Please find the developer profile below, as required on
http://www.igpsport.com/support/app/openapi

---

**Application Name**

VeloSync (速同)

**Application Logo**

Attached — `logo-120.png`, 120x120 pixels, PNG format.

**App Introduction**

VeloSync is a cross-platform workout data synchronization hub. It helps athletes who use
several cycling and sports platforms keep their data in one place. With OAuth authorization
via the iGPSPORT Open Platform, VeloSync reads a user's own ride records (time, distance,
speed, heart rate, cadence, power, and GPS track), then aggregates, de-duplicates, and
visualizes them, and supports exporting FIT files for further analysis. Data is used solely
for the user's own record management. We do not share data publicly, resell it, or use it
for advertising. Available as both a web app and a WeChat Mini Program.

**redirect_url**

https://【你的域名】/api/accounts/igpsport/callback/

**callback_url**

https://【你的域名】/api/accounts/igpsport/callback/

**Company name**

Individual Developer (personal, non-commercial project)

**Official website**

【你的官网地址，或你的代码仓库地址，例如 https://github.com/你的账号/velosync】
（本项目为个人开发，正式站点正在备案中。）

---

**Additional Information**

VeloSync is a personal, non-commercial project developed independently to solve a common
problem: ride data scattered across iGPSPORT, Garmin, Strava, and COROS.

Technical overview:

- Backend: Django + MySQL, OAuth 2.0 authorization flow
  (authorize → callback → encrypted token storage)
- Clients: Web application and WeChat Mini Program
- iGPSPORT capabilities already implemented:
  - OAuth 2.0 account binding
  - Reading the user's activity list and per-activity details
  - FIT file parsing (time/distance dual-axis charts, heart rate / cadence / power
    graphs, and GPS track playback)
  - Cross-platform de-duplication and synchronization

Intended use: managing workout data for myself and a small number of test users only.
No commercialization, no data resale, no advertising.

If a corporate entity is strictly required for developer access, could you please let me
know whether an individual developer application can be accepted, or what additional
documents would be needed? I am happy to provide further details.

Thank you for your time and consideration.

Best regards,
【你的姓名】
【你的邮箱 / 手机号】
