const auth = require("../../utils/auth");
const env = require("../../utils/env");

Page({
  data: {
    user: null,
    version: "1.0.0",
    /** 运行环境摘要（平台 · 机型 · 基础库 · 环境版本），用户反馈问题时报这个 */
    envInfo: "",
  },

  onLoad() {
    const sys = wx.getSystemInfoSync();
    this.setData({
      user: auth.getUser(),
      envInfo: `${sys.platform} · ${sys.model} · 基础库 ${sys.SDKVersion || "-"} · ${env.getEnvVersion()}`,
    });
  },

  onClearCache() {
    wx.showModal({
      title: "清除本地缓存",
      content: "将清除登录态与本地数据（服务端数据不受影响），清除后需要重新登录。",
      confirmText: "清除",
      confirmColor: "#ef4444",
      success: (r) => {
        if (!r.confirm) return;
        wx.clearStorageSync();
        auth.clear();
        const app = getApp();
        app.onLoggedOut();
      },
    });
  },

  onAbout() {
    wx.showModal({
      title: "关于 VeloSync 速同",
      content:
        "跨平台运动数据同步中枢\n" +
        "把 iGPSPORT、Garmin、Strava、COROS 等平台的运动记录汇总、去重、分发。\n\n" +
        "当前已打通「演示平台」的完整链路（拉取 → 去重 → 分发 → 日志）；\n" +
        "四个真实平台的适配器仍在接入中，绑定后暂无法真实拉取/上传数据。\n\n" +
        "小程序端 v" +
        this.data.version,
      showCancel: false,
      confirmText: "知道了",
    });
  },
});
