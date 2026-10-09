const auth = require("./utils/auth");
const request = require("./utils/request");
const config = require("./config");
const env = require("./utils/env");

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

    // 恢复自定义后端地址（仅开发版/体验版的登录页可改；设置页的那个入口已移除）。
    // 加版本戳：config.js 改了 cloudBaseUrl / env 后，旧缓存要自动失效，
    // 否则改了配置却仍连旧地址（这是很容易踩的坑）。
    //
    // 正式版必须丢弃而不是读取：该入口在正式版不存在，缓存里若还有地址，
    // 只可能是被诱导写入的残留值，读它等于把用户 JWT 送到攻击者服务器。
    // 这层判断放在 onLaunch 而不是某个页面里 —— 启动即生效，不依赖用户走了哪条路径。
    const isDev = env.isDevVersion();
    const saved = wx.getStorageSync(BASE_URL_KEY);
    const savedStamp = wx.getStorageSync(BASE_URL_STAMP);
    if (saved && isDev && savedStamp === config.configStamp) {
      request.setBaseUrl(saved);
    } else if (saved) {
      // 配置已变、或当前是正式版：丢弃缓存，回落到 config.baseUrl
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
