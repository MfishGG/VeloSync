/**
 * VeloSync 小程序全局配置
 *
 * 【后端地址】env / baseUrl
 *   已按环境拆分，用 `env` 一键切换，不必再改 baseUrl 字符串：
 *     - "local"  本地联调：http://127.0.0.1:8000/api
 *                 需在微信开发者工具「详情 → 本地设置」勾选
 *                 「不校验合法域名、web-view、TLS 版本以及 HTTPS 证书」。
 *     - "device" 真机预览（连电脑）：http://<局域网IP>:8000/api
 *                 三个前提：① 后端用 0.0.0.0:8000 启动（默认只监听回环，手机连不上）
 *                           ② 防火墙放行 8000
 *                           ③ 手机端右上角「···」→「打开调试」
 *     - "cloud"  正式环境：微信云托管分配的 HTTPS 域名（见下方 cloudBaseUrl）
 *                 域名须已在小程序后台「开发管理 → 服务器域名 → request 合法域名」登记。
 *
 *   临时改地址：登录页底部与设置页的「接口地址」入口，改完存在本地、
 *   优先级高于本文件（见 utils/request.js 的 setBaseUrl）。
 *
 * 【平台官方小程序】officialMiniPrograms
 *   微信不允许小程序直接唤起第三方 App，官方渠道是「跳转对方的微信小程序」。
 *   拿到对方小程序的原始 appId（wx 开头）后填在这里，绑定时会用 wx.navigateToMiniProgram 跳转。
 *
 * 【平台官方 App 链接】officialAppLinks
 *   跳官方小程序不可用时的兜底：复制 URL Scheme / 下载页，引导用户到系统浏览器打开官方 App。
 */

/** 当前环境：开发时用 local，真机连电脑用 device，正式发布用 cloud */
const env = "cloud";

/** 本地联调地址 */
const LOCAL_BASE_URL = "http://127.0.0.1:8000/api";
/** 真机预览连电脑：换成电脑的局域网地址（手机与电脑需同一 WiFi） */
const DEVICE_BASE_URL = "http://192.168.31.254:8000/api";
/** 生产（微信云托管）地址 */
const CLOUD_BASE_URL = "https://django-xu8d-324494-11-1501612653.sh.run.tcloudbase.com/api";

/** 环境预设：改 env 即可切换 */
const ENV_PRESETS = {
  local: LOCAL_BASE_URL,
  device: DEVICE_BASE_URL,
  cloud: CLOUD_BASE_URL,
};

const config = {
  env,

  /**
   * 配置版本戳：改动 env / 后端地址后，把这里同步改一下（任意字符串）。
   * app.js 用它判断本地缓存的后端地址是否过期，避免「改了配置却仍连旧地址」。
   */
  configStamp: "2026-10-08-cloud-1",

  /** 生产（微信云托管）域名，方便设置页展示与一键切到线上 */
  cloudBaseUrl: CLOUD_BASE_URL,

  /** 由 env 推导；未命中预设时回退到本地地址 */
  baseUrl: ENV_PRESETS[env] || LOCAL_BASE_URL,

  /** 请求超时（毫秒） */
  requestTimeout: 20000,

  /** 平台官方微信小程序（appId 需为对方小程序的原始 id，形如 wx1a2b3c4d5e6f7g8h） */
  officialMiniPrograms: {
    igpsport: { appId: "", path: "" },
    garmin: { appId: "", path: "" },
    strava: { appId: "", path: "" },
    coros: { appId: "", path: "" },
  },

  /** 平台官方 App 兜底链接 */
  officialAppLinks: {
    igpsport: { scheme: "igpsport://", download: "https://www.igpsport.com" },
    garmin: { scheme: "garminconnect://", download: "https://connect.garmin.cn" },
    strava: { scheme: "strava://", download: "https://www.strava.com/mobile" },
    coros: { scheme: "coros://", download: "https://www.coros.com" },
  },

  /** 轨迹回放默认倍速 */
  trackSpeeds: [1, 2, 4, 8],
};

module.exports = config;
