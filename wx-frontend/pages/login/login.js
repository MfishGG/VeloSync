const app = getApp();
const api = require("../../api/index");
const auth = require("../../utils/auth");
const request = require("../../utils/request");
const config = require("../../config");

const DEVICE_KEY = "velosync_device_id";
const BASE_URL_KEY = "velosync_base_url";

/**
 * 当前是否为「非正式版」。
 *
 * 发布版里必须隐藏「接口地址」编辑入口 —— 它本来只是开发期方便联调的设计，
 * 但在正式版里等于一条 Token 外泄通道：任何诱导（截图教程、群消息
 * 「改下地址就能用」）都能让用户在不知情下把 `Authorization: Bearer <JWT>`
 * 发到攻击者服务器。而终端用户看到「接口地址」这种词也只会困惑。
 */
function isDevVersion() {
  try {
    const info = wx.getAccountInfoSync ? wx.getAccountInfoSync().miniProgram || {} : {};
    return (info.envVersion || "develop") !== "release";
  } catch (e) {
    return false; // 拿不到就按正式版处理（宁可少一个开发入口，也不外泄凭据）
  }
}

/** 从完整 URL 中取出主机部分，供界面提示用 */
function hostOf(url) {
  const m = String(url || "").match(/^https?:\/\/([^/]+)/i);
  return m ? m[1] : String(url || "");
}

/** 生成/读取一个稳定的设备标识：未配置小程序 AppID 时用它派生演示账号 */
function deviceId() {
  let id = wx.getStorageSync(DEVICE_KEY);
  if (!id) {
    id = "dev-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    wx.setStorageSync(DEVICE_KEY, id);
  }
  return id;
}

Page({
  data: {
    loading: false,
    error: "",
    providersFailed: false,

    wxMode: "mock",
    /** 是否成功问过后端。false 时界面不能断言「后端未配置」，只能说「没问到」 */
    wxModeKnown: false,

    // 后端接口地址（真机预览时可在登录前直接改，不至于进不去设置页）
    baseUrl: "",
    baseUrlHost: "",
    editingBase: false,
    draftUrl: "",
    baseTesting: false,
    baseTestOk: false,
    baseTestErr: "",
    baseMode: "mock",
    /** 是否非正式版。只有非正式版才渲染接口地址编辑入口 */
    isDev: true,
  },

  onLoad() {
    const isDev = isDevVersion();
    const stored = wx.getStorageSync(BASE_URL_KEY) || request.getBaseUrl() || config.baseUrl;
    // 正式版：清掉可能残留的自定义地址，强制回到 config.baseUrl
    if (!isDev && wx.getStorageSync(BASE_URL_KEY)) {
      wx.removeStorageSync(BASE_URL_KEY);
      request.setBaseUrl(config.baseUrl);
    }
    const effective = isDev ? stored : config.baseUrl;
    this.setData({
      isDev,
      baseUrl: effective,
      draftUrl: effective,
      baseUrlHost: hostOf(effective),
    });
    this.loadWxMode();
  },

  onShow() {
    // 已登录直接进工作台
    if (auth.isLoggedIn()) {
      wx.switchTab({ url: "/pages/dashboard/dashboard" });
    }
  },

  loadWxMode() {
    api.auth
      .wxMiniProgramMode()
      .then((res) => {
        if (res && res.mode) this.setData({ wxMode: res.mode, wxModeKnown: true });
      })
      .catch(() => {
        // 连不上后端时给出提示（登录按钮仍可点，会以真实错误信息反馈）。
        // 注意：这里必须把 wxModeKnown 保持为 false —— 否则界面会误报
        // 「后端未配置小程序 AppID」，而真实原因只是网络不通 / 域名没登记。
        this.setData({ providersFailed: true });
      });
  },

  // ---------------- 后端接口地址（仅非正式版可用） ----------------
  editBase() {
    if (!this.data.isDev) return; // 正式版不提供编辑入口
    this.setData({
      editingBase: true,
      draftUrl: this.data.baseUrl,
      baseTestOk: false,
      baseTestErr: "",
    });
  },

  cancelBaseEdit() {
    this.setData({ editingBase: false, baseTestOk: false, baseTestErr: "" });
  },

  onBaseInput(e) {
    this.setData({ draftUrl: e.detail.value, baseTestOk: false, baseTestErr: "" });
  },

  /** 规范化草稿地址；返回 null 表示不合法（已弹提示） */
  normalizeDraft() {
    const url = String(this.data.draftUrl || "")
      .trim()
      .replace(/\/+$/, "");
    if (!/^https?:\/\/.+/i.test(url)) {
      this.toast("请填写完整地址，如 http://192.168.1.5:8000/api");
      return null;
    }
    return url;
  },

  /** 测连通性：临时切到草稿地址，测完无论成败都还原（只有「保存」才真正生效） */
  testBaseUrl() {
    const url = this.normalizeDraft();
    if (!url) return;
    const prev = request.getBaseUrl();
    request.setBaseUrl(url);
    this.setData({ baseTesting: true, baseTestOk: false, baseTestErr: "" });
    api.auth
      .wxMiniProgramMode()
      .then((res) => {
        this.setData({ baseTestOk: true, baseTestErr: "", baseMode: (res && res.mode) || "mock" });
      })
      .catch((err) => {
        this.setData({ baseTestErr: (err && err.message) || "连接失败" });
      })
      .then(() => {
        request.setBaseUrl(prev);
        this.setData({ baseTesting: false });
      });
  },

  saveBaseUrl() {
    if (!this.data.isDev) return; // 双保险：即使被绕过 UI 也不允许改写
    const url = this.normalizeDraft();
    if (!url) return;
    wx.setStorageSync(BASE_URL_KEY, url);
    request.setBaseUrl(url);
    this.setData({
      baseUrl: url,
      baseUrlHost: hostOf(url),
      editingBase: false,
      baseTestOk: false,
      baseTestErr: "",
      error: "",
    });
    this.toast("接口地址已保存");
    this.loadWxMode();
  },

  toast(msg, icon) {
    wx.showToast({ title: msg, icon: icon || "none", duration: 2000 });
  },

  /** 登录成功后的统一收尾 */
  afterLogin(payload, tip) {
    auth.setTokens(payload.access, payload.refresh);
    auth.setUser(payload.user);
    app.onLoggedIn(payload);
    this.toast(tip || "登录成功", "success");
    setTimeout(() => wx.switchTab({ url: "/pages/dashboard/dashboard" }), 500);
  },

  handleError(err) {
    const msg = (err && err.message) || "操作失败";
    const offline = err && err.status === 0;
    this.setData({
      error: offline
        ? `无法连接后端（${this.data.baseUrlHost}）：请确认地址正确、后端已启动、手机与电脑处于同一网络`
        : msg,
    });
  },

  // ---------------- 微信一键登录（唯一登录方式） ----------------
  wxLogin() {
    this.setData({ loading: true, error: "" });
    const identity = deviceId();
    const mockMode = this.data.wxMode === "mock";
    const send = (code) =>
      api.auth
        .wxMiniProgramLogin({ code: code || "", identity, nickname: "微信用户" })
        .then((res) => {
          const tip =
            res.mode === "mock" ? "已用演示身份登录" : res.created ? "微信登录成功" : "登录成功";
          this.afterLogin(res, tip);
        })
        .catch((err) => this.handleError(err))
        .then(() => this.setData({ loading: false }));

    wx.login({
      success: (r) => send(r.code),
      fail: () => {
        // 已配置小程序凭证时，空 code 后端必然报错，直接给出可操作的提示
        if (mockMode) {
          send(""); // 演示模式：wx.login 可能失败，用 deviceId 兜底照常登录
        } else {
          this.setData({ loading: false });
          this.handleError({ message: "获取微信登录凭证失败，请确认小程序 AppID 配置正确后重试" });
        }
      },
    });
  },
});
