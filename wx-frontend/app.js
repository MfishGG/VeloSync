const auth = require("./utils/auth");
const cloudrun = require("./utils/cloudrun");

/** 后端地址缓存的键与「配置版本戳」键 */
const BASE_URL_KEY = "velosync_base_url";
const BASE_URL_STAMP = "velosync_base_url_stamp";

App({
  globalData: {
    appName: "VeloSync",
    appSubName: "速同 · 数据同步中枢",
    /** 当前登录用户 */
    user: null,
    /** 当前登录态是否来自「演示模式」入口（提审 / 对外演示） */
    demo: false,
    /** 冷启动时后端是否可达（登录页据此显示黄色提示） */
    backendOk: true,
  },

  onLaunch() {
    // 云托管内网通道：callContainer 需要先 init 才能用。
    // 参数没填时整段跳过 —— 请求层会自动回退到公网 wx.request（本地联调照常）。
    // 正式环境必须填 utils/cloudrun.js 的 env / service，否则真机会因缺少
    // request 合法域名而全部失败（云托管默认域名官方不允许用于正式环境）。
    if (cloudrun.env && wx.cloud && typeof wx.cloud.init === "function") {
      try {
        wx.cloud.init({ env: cloudrun.env, traceUser: false });
      } catch (e) {
        console.warn("[cloud] init 失败，请求将回退公网通道", e);
      }
    }

    // 恢复本地登录态
    auth.load();
    const user = auth.getUser();
    if (user) this.globalData.user = user;
    this.globalData.demo = auth.isDemoMode();

    // 清理历史遗留的自定义后端地址。
    //
    // 登录页曾经提供「改接口地址」入口（开发版/体验版可见），现已整体移除，
    // 因此**没有任何界面能把地址写进这个 key**。这里保留清理而不是直接删掉：
    // 老版本装着这个缓存的用户升级上来时，残留值必须被丢掉 —— 否则那条路径
    // 仍然活着，等于把用户 JWT 送到缓存里那个地址。
    if (wx.getStorageSync(BASE_URL_KEY)) {
      wx.removeStorageSync(BASE_URL_KEY);
      wx.removeStorageSync(BASE_URL_STAMP);
    }
  },

  /** 统一的登录成功回调：写入全局态并跳转到工作台 */
  onLoggedIn(payload) {
    this.globalData.user = payload.user || null;
    // 演示标记以后端响应为准（演示入口的响应里带 demo:true）。
    // 不在这里推断「用户名是不是 demo」—— 那会把一个可配置的名字写死成判定条件。
    this.globalData.demo = !!payload.demo;
    this.globalData.backendOk = true;
  },

  /** 退出登录：清空本地态并回到登录页 */
  onLoggedOut() {
    this.globalData.user = null;
    this.globalData.demo = false;
    wx.reLaunch({ url: "/pages/login/login" });
  },
});
