const { offlineText } = require("../../utils/env");
const api = require("../../api/index");
const auth = require("../../utils/auth");
const config = require("../../config");

/**
 * 移动端绑定渠道：
 *   ① 已登记官方小程序 AppID  → wx.navigateToMiniProgram 跳官方小程序授权
 *   ② OAuth 凭证齐全         → 复制授权页链接（https），在系统浏览器完成授权
 *   ③ 以上都缺               → 以「演示身份」绑定，本地也能跑通全链路
 *
 * 第二档曾经是「复制 App 的 URL Scheme」，那条路走不通：iOS Safari 地址栏不接受
 * 自定义 scheme，用户拿到的是打不开的链接。详见 bindViaBrowser 的注释。
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

  /** 错误态的「重新加载」：先清掉旧错误，否则重试成功后红字还挂在那里 */
  reload() {
    this.setData({ error: "" }, () => this.load());
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
                  ? "官方小程序授权"
                  : p.mobile_bind_channel === "oauth"
                    ? "浏览器授权"
                    : "暂未开放",
            /**
             * 面向用户的「绑定方式」：说清点下去会发生什么。
             * 刻意不提「微信不允许唤起第三方 App / 三级兜底」——那是给后台配置者
             * 看的口径（见 admin.py 与 README），终端用户不需要知道这个约束，
             * 只需要知道下一步该做什么。
             */
            bindHint:
              p.auth_type === "mock"
                ? "演示平台，点击后直接绑定，无需授权"
                : p.mobile_bind_channel === "miniprogram"
                  ? `点击「绑定账号」将跳转到 ${p.name} 官方小程序完成授权`
                  : p.mobile_bind_channel === "oauth"
                    ? `点击「绑定账号」将复制授权链接，在浏览器中登录 ${p.name} 完成授权`
                    : `${p.name} 暂未提供官方授权入口，将以演示身份绑定`,
            upload: !!(p.capabilities && p.capabilities.upload),
            boundCount: bound[p.id] || 0,
          })),
          accounts: (accounts || []).map((a) => ({
            id: a.id,
            platformName: a.platform.name,
            platformCode: a.platform.code,
            displayName: a.display_name || a.platform_user_id,
            platformUserId: a.platform_user_id,
            // 后端给的是 active / expired / revoked。直接把枚举值印在界面上，
            // 用户看到的是「状态 active」——英文单词对他来说等于没说。
            statusLabel:
              { active: "有效", expired: "已过期", revoked: "已撤销" }[a.status] ||
              a.status,
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
            err.status === 0 ? offlineText() : err.message,
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
    if (p.oauth_ready) {
      items.push(`复制授权链接，在浏览器完成 ${p.name} 授权`);
      actions.push("browser");
    }
    items.push("以演示身份绑定");
    actions.push("demo");
    items.push("这个平台怎么绑定");
    actions.push("help");

    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const act = actions[res.tapIndex];
        if (act === "mp") this.bindViaMiniProgram(p);
        else if (act === "browser") this.bindViaBrowser(p);
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
          title: "已打开官方小程序",
          content:
            `请在 ${p.name} 官方小程序内完成授权。\n\n` +
            "回到本页后下拉刷新。如果一直没有出现新账号，说明该平台不支持这种方式的绑定，" +
            "可以改用「演示身份」体验完整流程。",
          showCancel: false,
        });
      },
      fail: () => {
        wx.showModal({
          title: "打不开官方小程序",
          content:
            `暂时无法打开 ${p.name} 官方小程序。\n\n` +
            "可以稍后重试，或先用「演示身份」体验绑定与同步流程。",
          showCancel: false,
        });
      },
    });
  },

  /**
   * ② 复制平台授权页链接，在系统浏览器里完成 OAuth
   *
   * 复制的是后端 `/accounts/{code}/authorize/` 生成的 https 授权地址（带一次性
   * state），不是 App 的自定义 scheme。
   *
   * 原来这里复制的是 `strava://` 这类 scheme，让用户粘到浏览器 —— 那条路是错的，
   * 而且是两层错：
   *   1) iOS Safari 地址栏不接受自定义 scheme，会直接判为无效地址；安卓各浏览器
   *      行为也不一致。用户拿到的是一个打不开的链接。
   *   2) 就算侥幸打开 App，也完不成授权 —— 平台 OAuth 本来就是网页流程，
   *      授权码要经浏览器回调到后端才能落库。
   * 现在复制授权页链接，是真正能把账号绑上的路径。
   */
  bindViaBrowser(p) {
    this.setData({ busy: p.code });
    wx.showLoading({ title: "生成授权链接…", mask: true });
    api.platforms
      .authorize(p.code)
      .then((res) => {
        wx.hideLoading();
        this.setData({ busy: "" });
        const url = res && res.authorize_url;
        if (!url) {
          // 演示平台不返回 url（后端已就地建好账号），按绑定成功处理
          this.load();
          wx.showToast({ title: "绑定成功", icon: "success" });
          return;
        }
        wx.setClipboardData({
          data: url,
          success: () => {
            wx.showModal({
              title: `授权 ${p.name}`,
              content:
                "授权链接已复制到剪贴板。请：\n" +
                "1) 打开手机浏览器，粘贴并访问；\n" +
                `2) 登录你的 ${p.name} 账号并同意授权；\n` +
                "3) 看到授权成功后回到本页，下拉刷新。",
              showCancel: false,
              confirmText: "知道了",
            });
          },
        });
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ busy: "" });
        if (err && err.code === "oauth_not_configured") {
          // 凭证在页面加载后被撤掉的情况：不把用户卡在这里，直接给可用的退路
          wx.showModal({
            title: `${p.name} 暂未开通真实授权`,
            content: "该平台暂未开放正式授权，可以先用演示身份体验。",
            confirmText: "演示绑定",
            success: (r) => {
              if (r.confirm) this.demoBind(p, `${p.name} 已用演示身份绑定`);
            },
          });
          return;
        }
        wx.showToast({
          title: (err && err.message) || "生成授权链接失败",
          icon: "none",
        });
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

  /**
   * 「这个平台怎么绑定」。
   *
   * 只讲用户下一步该做什么。凭证字段名、AppID、Django Admin 路径一律不出现 ——
   * 项目既定原则是开发者信息不上屏（见 settings.wxml 与 admin.py），而这一页是
   * 用户绑定账号时最先打开的地方，更不该把后台地址摆在上面。
   */
  showHelp(p) {
    let how;
    if (p.oauth_ready) {
      how =
        "点「绑定账号」后会把授权链接复制到剪贴板：打开手机浏览器粘贴访问，" +
        `登录 ${p.name} 并同意授权，看到「绑定成功」后回到本页下拉刷新。`;
    } else if (p.miniprogram_appid) {
      how = `点「绑定账号」会跳转到 ${p.name} 官方小程序，请在那里完成授权。`;
    } else {
      how =
        `${p.name} 暂时没有开放直接授权，只能用「演示身份」体验绑定与同步流程` +
        "（同步的是演示数据，不会连接你的真实账号）。";
    }
    // 佳明两区是完全独立的账号体系，数据不互通。选错区的表现是「登录成功但没有
    // 我的记录」，用户很难自己想到是区选错了，所以这里必须点明。
    if (p.code === "garmin" || p.code === "garmin_cn") {
      how +=
        "\n\n佳明分国际区与中国区，两套账号完全独立、数据互不相通。" +
        "请选你平时登录的那个区：国际区 connect.garmin.com，中国区 connect.garmin.cn。";
    }
    wx.showModal({
      title: `${p.name} 怎么绑定`,
      content: how,
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
