const app = getApp();
const api = require("../../api/index");
const auth = require("../../utils/auth");
const request = require("../../utils/request");
const config = require("../../config");
const env = require("../../utils/env");

const DEVICE_KEY = "velosync_device_id";
const BASE_URL_KEY = "velosync_base_url";

// 发布版必须隐藏「接口地址」编辑入口 —— 它是这里仅存的开发入口，
// 也是唯一还保留的调试通道（设置页的那块已整体移除）。
// 判定逻辑统一走 utils/env，避免多处拷贝漂移出安全缺口。
const isDevVersion = env.isDevVersion;

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
    /** 探测失败的原因文案：域名未登记与断网要分开说，否则排查方向会跑偏 */
    providersFailText: "",

    wxMode: "mock",
    /** 是否成功问过后端。false 时界面不能断言「后端未配置」，只能说「没问到」 */
    wxModeKnown: false,

    /** 后端是否开放演示入口（提审 / 对外演示；DEMO_MODE=0 时为 false） */
    demoAvailable: false,
    demoLoading: false,

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
    this.loadDemoStatus();
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
      .catch((err) => {
        // 连不上后端时给出提示（登录按钮仍可点，会以真实错误信息反馈）。
        // 注意：这里必须把 wxModeKnown 保持为 false —— 否则界面会误报
        // 「后端未配置小程序 AppID」，而真实原因只是网络不通 / 域名没登记。
        const msg = (err && err.message) || "";
        const notInDomain = /domain list/i.test(msg);
        // 正式版只说「网络失败」：域名、服务器域名配置这类词对终端用户没有意义，
        // 也不该把后端域名印在界面上。
        this.setData({
          providersFailed: true,
          providersFailText: this.data.isDev
            ? notInDomain
              ? `当前后端域名未加入小程序的「request 合法域名」：请在微信公众平台 → 开发管理 → 开发设置 → 服务器域名 中配置 ${this.data.baseUrlHost}。`
              : `未连接到后端（${this.data.baseUrlHost}），暂时无法判断登录模式。`
            : "网络连接失败，请检查网络后重试。",
        });
      });
  },

  /**
   * 问后端「演示入口是否开启」。
   *
   * 失败一律按不可用处理：演示入口是锦上添花，连不上后端时不该在界面上多出一个
   * 点了必然失败的按钮。真正的问题（网络不通）由 wxMode 那条提示去讲。
   */
  loadDemoStatus() {
    api.auth
      .demoStatus()
      .then((res) => this.setData({ demoAvailable: !!(res && res.enabled) }))
      .catch(() => this.setData({ demoAvailable: false }));
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
    if (!(err && err.status === 0)) {
      this.setData({ error: msg });
      return;
    }

    /* 网络层失败（status 0）有两种成因，外观一模一样，但排查方向完全相反：
     *   1) 域名没登记进「request 合法域名」—— 开发者工具勾了「不校验合法域名」时
     *      一切正常，一到真机 / 正式版就全挂。最容易被误判成「后端挂了」；
     *   2) 真的连不上（断网、服务停、地址错）。
     * 只能靠 errMsg 区分：前者带 "url not in domain list"。
     */
    const notInDomain = /domain list/i.test(msg);
    const dev = this.data.isDev;
    let text;
    if (notInDomain) {
      // 这是一条配置问题，不是网络问题。正式版里不该对终端用户解释「服务器域名」，
      // 但开发 / 体验版必须说清楚，否则下一个人还会去查后端日志。
      text = dev
        ? `后端域名未登记为「request 合法域名」：请在微信公众平台 → 开发管理 → 开发设置 → 服务器域名，把 ${this.data.baseUrlHost} 加入 request 合法域名。`
        : "网络连接失败，请稍后重试";
    } else {
      text = dev
        ? `无法连接后端（${this.data.baseUrlHost}）：${msg}`
        : "网络连接失败，请检查网络后重试";
    }
    this.setData({ error: text });
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
          // 显式清掉演示标记：上一次可能是从演示入口进来的，
          // 残留标记会让界面一直挂着「演示模式」的提示。
          auth.setDemo(false);
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

  // ---------------- 演示模式（提审 / 对外演示） ----------------

  /**
   * 进入演示账号。
   *
   * 与微信登录的区别只在「怎么拿到身份」：这里直接向后端要一个预置账号的
   * token。它不走 wx.login，因此不需要 AppID、也不需要审核员配置任何平台凭证 ——
   * 而后端为这个账号准备了完整的活动 / 任务 / 日志，进来就是有内容的。
   */
  demoLogin() {
    this.setData({ demoLoading: true, error: "" });
    api.auth
      .demoLogin()
      .then((res) => {
        auth.setDemo(true);
        this.afterLogin(res, "已进入演示模式");
      })
      .catch((err) => this.handleError(err))
      .then(() => this.setData({ demoLoading: false }));
  },
});
