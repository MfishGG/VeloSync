const api = require("../../api/index");
const auth = require("../../utils/auth");
const request = require("../../utils/request");
const config = require("../../config");

const BASE_URL_KEY = "velosync_base_url";
const BASE_URL_STAMP = "velosync_base_url_stamp";

Page({
  data: {
    baseUrl: "",
    editing: false,
    draftUrl: "",
    testing: false,
    testResult: "",
    testOk: false,
    user: null,
    adminUrl: "http://127.0.0.1:8000/admin/",
    docsUrl: "http://127.0.0.1:8000/api/docs/",
    version: "1.0.0",
    envInfo: "",
    /** 当前环境（local / device / cloud），便于排查「为什么连的是这个地址」 */
    envName: "",
  },

  onLoad() {
    // 与 app.js 一致：版本戳不匹配说明配置已更新，忽略过期缓存
    const saved = wx.getStorageSync(BASE_URL_KEY);
    const savedStamp = wx.getStorageSync(BASE_URL_STAMP);
    const stored = saved && savedStamp === config.configStamp ? saved : config.baseUrl;
    const env = wx.getAccountInfoSync
      ? (wx.getAccountInfoSync().miniProgram || {}).envVersion || "develop"
      : "develop";
    const sys = wx.getSystemInfoSync();
    this.setData({
      baseUrl: stored,
      draftUrl: stored,
      user: auth.getUser(),
      envName: config.env,
      envInfo: `${sys.platform} · ${sys.model} · 基础库 ${sys.SDKVersion || "-"} · ${env}`,
    });
    this.updateDevUrls(stored);
  },

  updateDevUrls(baseUrl) {
    const root = String(baseUrl).replace(/\/api\/?$/, "");
    this.setData({ adminUrl: `${root}/admin/`, docsUrl: `${root}/api/docs/` });
  },

  onEdit() {
    this.setData({ editing: true, draftUrl: this.data.baseUrl, testResult: "" });
  },

  onCancelEdit() {
    this.setData({ editing: false });
  },

  onUrlInput(e) {
    this.setData({ draftUrl: e.detail.value });
  },

  onUrlConfirm(e) {
    this.setData({ draftUrl: e.detail.value });
  },

  onSaveUrl() {
    const url = String(this.data.draftUrl || "").trim();
    if (!/^https?:\/\/.+/i.test(url)) {
      wx.showToast({ title: "请填写完整地址，如 http://127.0.0.1:8000/api", icon: "none" });
      return;
    }
    const normalized = url.replace(/\/+$/, "");
    wx.setStorageSync(BASE_URL_KEY, normalized);
    // 打上当前配置版本戳，避免下次冷启动被判为过期缓存
    wx.setStorageSync(BASE_URL_STAMP, config.configStamp);
    request.setBaseUrl(normalized);
    this.setData({ baseUrl: normalized, editing: false, testResult: "" });
    this.updateDevUrls(normalized);
    wx.showToast({ title: "已保存", icon: "success" });
  },

  onResetUrl() {
    const def = config.baseUrl;
    wx.setStorageSync(BASE_URL_KEY, def);
    wx.setStorageSync(BASE_URL_STAMP, config.configStamp);
    request.setBaseUrl(def);
    this.setData({ baseUrl: def, draftUrl: def, editing: false, testResult: "" });
    this.updateDevUrls(def);
    wx.showToast({ title: "已恢复默认", icon: "success" });
  },

  /** 连通性测试：走一个免鉴权接口 */
  onTest() {
    this.setData({ testing: true, testResult: "" });
    api.auth
      .wxMiniProgramMode()
      .then((res) => {
        this.setData({
          testing: false,
          testOk: true,
          testResult: `连接正常 · 小程序登录模式：${res.mode === "oauth" ? "已配置 AppID" : "演示身份"}`,
        });
      })
      .catch((err) => {
        this.setData({
          testing: false,
          testOk: false,
          testResult:
            err.status === 0
              ? "无法连接：请确认后端已启动，且开发者工具已勾选「不校验合法域名」"
              : `连接失败：${err.message}`,
        });
      });
  },

  onCopy(e) {
    const value = e.currentTarget.dataset.value;
    wx.setClipboardData({
      data: value,
      success: () => wx.showToast({ title: "已复制", icon: "success" }),
    });
  },

  onClearCache() {
    wx.showModal({
      title: "清除本地缓存",
      content:
        "将清除登录态与接口地址设置（服务端数据不受影响），清除后需要重新登录。",
      confirmText: "清除",
      confirmColor: "#ef4444",
      success: (r) => {
        if (!r.confirm) return;
        const keep = {};
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
        "把 iGPSPORT、Garmin、Strava、COROS 等平台的运动记录汇总、去重、分发，\n" +
        "让每一条记录在所有平台都有一席之地。\n\n" +
        "小程序端 v" +
        this.data.version,
      showCancel: false,
      confirmText: "知道了",
    });
  },
});
