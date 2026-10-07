const auth = require("./utils/auth");
const request = require("./utils/request");

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
    // 恢复自定义后端地址（设置页可改）
    const saved = wx.getStorageSync("velosync_base_url");
    if (saved) request.setBaseUrl(saved);
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
