const api = require("../../api/index");
const auth = require("../../utils/auth");
const config = require("../../config");

/**
 * 移动端绑定三级兜底（微信不允许小程序直接唤起第三方 App）：
 *   ① 已登记官方小程序 AppID  → wx.navigateToMiniProgram 跳官方小程序授权
 *   ② 只有 URL Scheme        → 复制链接，引导用户在系统浏览器唤起官方 App
 *   ③ 两者都缺               → 以「演示身份」绑定，本地也能跑通全链路
 */
Page({
  data: {
    loading: true,
    error: "",
    message: "",
    platforms: [],
    accounts: [],
    boundIds: {},
    busy: "",
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      auth.redirectToLogin();
      return;
    }
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ error: "" });
    return Promise.all([api.platforms.list(), api.platforms.accounts()])
      .then(([platforms, accounts]) => {
        const bound = {};
        (accounts || []).forEach((a) => {
          bound[a.platform.id] = (bound[a.platform.id] || 0) + 1;
        });
        this.setData({
          platforms: (platforms || []).map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            auth_type: p.auth_type,
            oauth_ready: p.oauth_ready,
            oauth_missing: p.oauth_missing || [],
            hint: p.credential_hint,
            miniprogram_appid: p.miniprogram_appid,
            app_scheme: p.app_scheme,
            channel: p.mobile_bind_channel,
            channelLabel:
              p.auth_type === "mock"
                ? "演示平台"
                : p.mobile_bind_channel === "miniprogram"
                  ? "可跳官方小程序"
                  : p.mobile_bind_channel === "app"
                    ? "可唤起官方 App"
                    : "仅演示绑定",
            channelTint:
              p.auth_type === "mock"
                ? "chip--primary"
                : p.mobile_bind_channel === "demo"
                  ? "chip--warning"
                  : "chip--success",
            upload: !!(p.capabilities && p.capabilities.upload),
            boundCount: bound[p.id] || 0,
          })),
          accounts: (accounts || []).map((a) => ({
            id: a.id,
            platformName: a.platform.name,
            platformCode: a.platform.code,
            displayName: a.display_name || a.platform_user_id,
            platformUserId: a.platform_user_id,
            status: a.status,
            isDemo: /^(mock|demo)-/.test(a.platform_user_id || ""),
            created: String(a.created_at || "").slice(0, 10),
          })),
          loading: false,
        });
      })
      .catch((err) =>
        this.setData({
          loading: false,
          error:
            err.status === 0
              ? "无法连接后端服务，请先启动 Django（127.0.0.1:8000）"
              : err.message,
        }),
      );
  },

  /** 点「绑定」→ 按平台能力弹出可选渠道 */
  onBind(e) {
    const code = e.currentTarget.dataset.code;
    const p = this.data.platforms.find((x) => x.code === code);
    if (!p) return;

    if (p.auth_type === "mock") {
      this.demoBind(p, "演示平台已直接绑定");
      return;
    }

    const actions = [];
    const items = [];
    if (p.miniprogram_appid) {
      items.push(`跳转 ${p.name} 官方小程序授权`);
      actions.push("mp");
    }
    if (p.app_scheme) {
      items.push(`复制链接，用浏览器打开 ${p.name} App`);
      actions.push("app");
    }
    items.push("以演示身份绑定（本地跑通）");
    actions.push("demo");
    items.push("查看凭证配置指引");
    actions.push("help");

    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const act = actions[res.tapIndex];
        if (act === "mp") this.bindViaMiniProgram(p);
        else if (act === "app") this.bindViaApp(p);
        else if (act === "demo") this.demoBind(p, `${p.name} 已用演示身份绑定`);
        else this.showHelp(p);
      },
      fail: () => {},
    });
  },

  /** ① 跳转平台官方小程序 */
  bindViaMiniProgram(p) {
    const local = (config.officialMiniPrograms || {})[p.code] || {};
    wx.navigateToMiniProgram({
      appId: p.miniprogram_appid,
      path: local.path || "",
      extraData: { from: "velosync", action: "bind", platform: p.code },
      envVersion: "release",
      success: () => {
        wx.showModal({
          title: "已跳转官方小程序",
          content:
            `请在 ${p.name} 官方小程序内完成授权。授权完成后回到本页下拉刷新，` +
            `若账号仍未出现，可用「以演示身份绑定」先跑通流程。`,
          showCancel: false,
        });
      },
      fail: (err) => {
        wx.showModal({
          title: "跳转失败",
          content: `无法打开 ${p.name} 官方小程序（${(err && err.errMsg) || "未知原因"}）。\n` +
            "可由后台在「平台 → 移动端绑定渠道」中核对官方小程序 AppID。",
          showCancel: false,
        });
      },
    });
  },

  /** ② 复制 URL Scheme，引导到系统浏览器打开官方 App */
  bindViaApp(p) {
    const scheme = p.app_scheme || ((config.officialAppLinks || {})[p.code] || {}).scheme || "";
    if (!scheme) {
      this.showHelp(p);
      return;
    }
    wx.setClipboardData({
      data: scheme,
      success: () => {
        wx.showModal({
          title: `唤起 ${p.name} App`,
          content:
            `已将链接「${scheme}」复制到剪贴板。\n\n` +
            "微信内无法直接打开其它 App 的链接，请：\n" +
            "1) 退出微信，打开系统浏览器；\n" +
            "2) 粘贴并访问该链接，即可唤起官方 App；\n" +
            "3) 在 App 内完成账号授权。",
          showCancel: false,
          confirmText: "知道了",
        });
      },
    });
  },

  /** ③ 演示身份绑定 */
  demoBind(p, tip) {
    this.setData({ busy: p.code });
    wx.showLoading({ title: "绑定中…", mask: true });
    api.platforms
      .demoBind(p.code)
      .then(() => {
        wx.hideLoading();
        this.setData({ busy: "" });
        wx.showToast({ title: tip || "绑定成功", icon: "success" });
        this.load();
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ busy: "" });
        wx.showToast({ title: err.message || "绑定失败", icon: "none" });
      });
  },

  /** 凭证配置指引 */
  showHelp(p) {
    const missing = (p.oauth_missing || []).join("、") || "无";
    wx.showModal({
      title: `${p.name} 绑定说明`,
      content:
        `当前绑定渠道：${p.channelLabel}\n` +
        `OAuth 凭证：${p.oauth_ready ? "已配置" : `未配置（缺 ${missing}）`}\n\n` +
        "在微信小程序内绑定第三方平台的方式：\n" +
        "① 官方小程序：在后台「平台 → 移动端绑定渠道」填 miniprogram_appid；\n" +
        "② 官方 App：填 app_scheme，复制链接到浏览器唤起；\n" +
        "③ 演示身份：无需凭证，用于本地跑通全链路。\n\n" +
        "Django Admin：/admin/platforms/platform/",
      showCancel: false,
      confirmText: "知道了",
    });
  },

  onUnbind(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: "解绑账号",
      content: `确定解绑「${name}」？解绑后需要重新授权才能同步到该平台。`,
      confirmText: "解绑",
      confirmColor: "#ef4444",
      success: (r) => {
        if (!r.confirm) return;
        api.platforms
          .removeAccount(id)
          .then(() => {
            wx.showToast({ title: "已解绑", icon: "success" });
            this.load();
          })
          .catch((err) => wx.showToast({ title: err.message || "解绑失败", icon: "none" }));
      },
    });
  },
});
