const auth = require("./utils/auth");
const request = require("./utils/request");
const config = require("./config");

/** 后端地址缓存的键与「配置版本戳」键 */
const BASE_URL_KEY = "velosync_base_url";
const BASE_URL_STAMP = "velosync_base_url_stamp";

App({
  globalData: {
    appName: "VeloSync",
    appSubName: "速同 · 数据同步中枢",
    /** 当前登录用户 */
    user: null,
    /** 冷启动时后端是否可达（登录页据此显示黄色提示） */
    backendOk: true,
  },

  onLaunch() {
    // 恢复本地登录态
    auth.load();
    const user = auth.getUser();
    if (user) this.globalData.user = user;

    // 恢复自定义后端地址（设置页可改）。
    // 加版本戳：config.js 改了 cloudBaseUrl / env 后，旧缓存要自动失效，
    // 否则改了配置却仍连旧地址（这是很容易踩的坑）。
    const saved = wx.getStorageSync(BASE_URL_KEY);
    const savedStamp = wx.getStorageSync(BASE_URL_STAMP);
    if (saved && savedStamp === config.configStamp) {
      request.setBaseUrl(saved);
    } else if (saved) {
      // 配置已变，丢弃过期缓存，回落到 config.baseUrl
      wx.removeStorageSync(BASE_URL_KEY);
      wx.removeStorageSync(BASE_URL_STAMP);
    }
  },

  /** 统一的登录成功回调：写入全局态并跳转到工作台 */
  onLoggedIn(payload) {
    this.globalData.user = payload.user || null;
    this.globalData.backendOk = true;
  },

  /** 退出登录：清空本地态并回到登录页 */
  onLoggedOut() {
    this.globalData.user = null;
    wx.reLaunch({ url: "/pages/login/login" });
  },
});
