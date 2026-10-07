/**
 * VeloSync 小程序全局配置
 *
 * 【后端地址】baseUrl
 *   - 本地联调：保持 http://127.0.0.1:8000/api，
 *     并在微信开发者工具「详情 → 本地设置」勾选「不校验合法域名、web-view、TLS 版本以及 HTTPS 证书」。
 *   - 真机预览：改成电脑内网 IP，例如 http://192.168.31.254:8000/api（手机与电脑同一 WiFi）。
 *     三个前提：① 后端用 0.0.0.0:8000 启动（默认只监听回环，手机连不上）
 *               ② 防火墙放行 8000
 *               ③ 手机端右上角「···」→「打开调试」（urlCheck 只在电脑上生效）
 *     手机上不必改代码 —— 登录页底部的「接口地址」入口未登录也能用，改完存在本地。
 *   - 正式环境：必须是 HTTPS，且域名已在小程序后台「开发管理 → 服务器域名 → request 合法域名」登记。
 *
 * 【平台官方小程序】officialMiniPrograms
 *   微信不允许小程序直接唤起第三方 App，官方渠道是「跳转对方的微信小程序」。
 *   拿到对方小程序的原始 appId（wx 开头）后填在这里，绑定时会用 wx.navigateToMiniProgram 跳转。
 *
 * 【平台官方 App 链接】officialAppLinks
 *   跳官方小程序不可用时的兜底：复制 URL Scheme / 下载页，引导用户到系统浏览器打开官方 App。
 */
const config = {
  baseUrl: "http://127.0.0.1:8000/api",

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
