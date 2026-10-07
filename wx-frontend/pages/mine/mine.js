const api = require("../../api/index");
const auth = require("../../utils/auth");
const format = require("../../utils/format");

/** 把后端的 social 绑定列表压成页面需要的形状 */
function pickWechat(user) {
  const list = (user && user.social) || [];
  const wx = list.find((s) => s.provider === "wechat");
  if (!wx) return { connected: false };
  return {
    connected: true,
    // openid 以 mock- 开头说明是未配置凭证时期的演示身份
    real: !String(wx.openid || "").startsWith("mock-"),
    providerName: wx.provider_name || "微信",
    nickname: wx.nickname || "",
    openid: wx.openid || "",
    unionid: wx.unionid || "",
    boundAt: wx.bound_at ? format.fmtDateTime(wx.bound_at) : "",
  };
}

Page({
  data: {
    user: null,
    avatarUrl: "",
    /** 微信绑定信息：{ connected, real, providerName, nickname, openid, unionid, boundAt } */
    wx: { connected: false },
    accountCount: 0,
    platformCount: 0,
    version: "1.0.0",
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      auth.redirectToLogin();
      return;
    }
    this.applyUser(auth.getUser());
    this.refreshMe();
    this.loadBadges();
  },

  /** 先用本地缓存的 user 立即渲染，避免头像闪一下空白 */
  applyUser(user) {
    if (!user) return;
    this.setData({ user, avatarUrl: user.avatar || "", wx: pickWechat(user) });
  },

  /** 拉一次 /auth/me/ 拿最新的头像与绑定信息（登录响应里已带，这里作为兜底刷新） */
  refreshMe() {
    api.auth
      .me()
      .then((user) => {
        if (!user) return;
        auth.setUser(user);
        getApp().globalData.user = user;
        this.applyUser(user);
      })
      .catch(() => {
        /* 网络异常时保留缓存渲染 */
      });
  },

  /** 微信头像加载失败（链接过期等）→ 回退到品牌图标 */
  onAvatarError() {
    this.setData({ avatarUrl: "" });
  },

  /** 点 ID 复制到剪贴板 */
  copyId(e) {
    const value = (e.currentTarget.dataset.id || "").trim();
    if (!value) return;
    wx.setClipboardData({
      data: value,
      success: () => wx.showToast({ title: "已复制", icon: "none" }),
    });
  },

  loadBadges() {
    Promise.all([api.platforms.accounts(), api.platforms.list()])
      .then(([accounts, platforms]) => {
        this.setData({
          accountCount: (accounts || []).length,
          platformCount: (platforms || []).length,
        });
      })
      .catch(() => {});
  },

  goAccounts() {
    wx.navigateTo({ url: "/pages/accounts/accounts" });
  },
  goLogs() {
    wx.navigateTo({ url: "/pages/logs/logs" });
  },
  goSettings() {
    wx.navigateTo({ url: "/pages/settings/settings" });
  },

  onLogout() {
    wx.showModal({
      title: "退出登录",
      content: "确定要退出当前账号吗？",
      confirmText: "退出",
      confirmColor: "#ef4444",
      success: (r) => {
        if (!r.confirm) return;
        auth.clear();
        const app = getApp();
        app.onLoggedOut();
      },
    });
  },
});
