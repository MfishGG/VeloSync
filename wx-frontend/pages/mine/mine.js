const api = require("../../api/index");
const auth = require("../../utils/auth");
const format = require("../../utils/format");
const avatar = require("../../utils/avatar");
const privacy = require("../../utils/privacy");

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

/**
 * 决定顶部展示的名字。
 * 微信在新版权限收紧后常返回「微信用户」这类泛化占位昵称，
 * 直接展示会和账号来源标签语义重复，此时改用本地用户名（或邮箱前缀）更有辨识度。
 */
const GENERIC_WX_NAMES = ["微信用户", "微信", "WeChat User", "wechat"];

function pickDisplayName(user, wx) {
  const raw = ((user && user.nickname) || "").trim();
  const isGeneric = !raw || GENERIC_WX_NAMES.indexOf(raw) >= 0;
  if (raw && !isGeneric) return raw;

  // 回退顺序：本地用户名 → 邮箱前缀 → 兜底文案
  const username = ((user && user.username) || "").trim();
  if (username) return username;
  const email = ((user && user.email) || "").trim();
  if (email) return email.split("@")[0];
  return wx && wx.connected ? "微信用户" : "骑行爱好者";
}

/** 头像体积上限提示，暴露给 WXML 展示 */
const AVATAR_HINT = "建议使用 500KB 以内的图片";

Page({
  data: {
    user: null,
    /** 顶部展示的名字：昵称优先，泛化占位昵称回退到用户名 */
    displayName: "",
    avatarUrl: "",
    /** 微信绑定信息：{ connected, real, providerName, nickname, openid, unionid, boundAt } */
    wx: { connected: false },
    /** 账号信息（OpenID / UnionID）默认收起，避免普通用户看到一串乱码 */
    showId: false,
    /** 当前登录态是否来自「演示模式」入口（提审 / 对外演示） */
    demo: false,
    /** 资料编辑暂存态：昵称输入值 + 各操作进行中标记 */
    nicknameDraft: "",
    savingNickname: false,
    savingAvatar: false,
    avatarHint: AVATAR_HINT,
    /** 隐私授权：未同意时头像 / 昵称组件会被微信拦截（errno 104） */
    privacyNeeded: false,
    privacyContractName: "",
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
    this.setData({ demo: auth.isDemoMode() });
    this.refreshMe();
    this.loadBadges();
    this.checkPrivacy();
  },

  /** 先用本地缓存的 user 立即渲染，避免头像闪一下空白 */
  applyUser(user) {
    if (!user) return;
    const wx = pickWechat(user);
    this.setData({
      user,
      avatarUrl: user.avatar || "",
      wx,
      displayName: pickDisplayName(user, wx),
      // 输入框初值。仅在用户没在编辑时覆盖，否则会打断正在输入的内容
      nicknameDraft: this.data.nicknameDraft || (user.nickname || ""),
    });
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

  // ---------------- 资料编辑（微信「头像昵称填写能力」）----------------

  /**
   * 选头像。`open-type="chooseAvatar"` 回调给的是**本地临时路径**
   * （wxfile:// / http://tmp/...），重启小程序即失效，必须读成 dataURL 交给后端
   * 持久化，否则用户下次进来头像就没了。
   */
  onChooseAvatar(e) {
    const tempPath = (e.detail && e.detail.avatarUrl) || "";
    if (!tempPath) return;
    // 先本地预览，让操作有即时反馈（失败时 saveProfile 会回滚）
    this.setData({ avatarUrl: tempPath });
    avatar
      .toDataUrl(tempPath)
      .then((dataUrl) => this.saveProfile({ avatar: dataUrl }, "头像已更新"))
      .catch((err) => {
        this.setData({ avatarUrl: (this.data.user || {}).avatar || "" });
        wx.showToast({ title: (err && err.message) || "头像读取失败", icon: "none" });
      });
  },

  /** 昵称输入。只在本地暂存，失焦或点击保存时才提交 */
  onNicknameInput(e) {
    this.setData({ nicknameDraft: e.detail.value || "" });
  },

  /**
   * 昵称框聚焦时必须补一次隐私授权检查。
   * 原因：`<input type="nickname">` 在未同意隐私政策时**不触发**授权事件，
   * 而是静默降级成普通输入框 —— 用户能打字却拿不到微信昵称，且没有任何报错。
   * 只有在此刻主动拉起授权，这个能力才会恢复。
   */
  onNicknameFocus() {
    if (!this.data.privacyNeeded) return;
    privacy
      .authorize()
      .then(() => {
        // 降级判定发生在聚焦那一刻，本次聚焦已失效，需重新点击才能用上微信昵称
        this.setData({ privacyNeeded: false });
        wx.showToast({ title: "已同意隐私协议，请再次点击昵称框", icon: "none" });
      })
      .catch(() => {
        /* 用户选择拒绝：保留提示条，昵称仍可手动输入 */
      });
  },

  /** 昵称输入框失焦（键盘收起 / 点击别处）→ 有变化就提交 */
  onNicknameBlur(e) {
    const value = ((e.detail && e.detail.value) || "").trim();
    if (!value || value === ((this.data.user && this.data.user.nickname) || "")) return;
    this.saveProfile({ nickname: value }, "昵称已更新");
  },

  /**
   * 提交资料变更。
   * 成功后用后端返回的 user 覆盖本地缓存与页面，保证三处显示一致；
   * 失败时回滚页面显示（否则会出现「界面改了但没存上」的假象）。
   */
  saveProfile(payload, successTip) {
    const isAvatar = Object.prototype.hasOwnProperty.call(payload, "avatar");
    this.setData(isAvatar ? { savingAvatar: true } : { savingNickname: true });
    return api.auth
      .updateProfile(payload)
      .then((user) => {
        if (user) {
          auth.setUser(user);
          getApp().globalData.user = user;
          this.applyUser(user);
        }
        if (successTip) wx.showToast({ title: successTip, icon: "none" });
      })
      .catch((err) => {
        const msg = (err && err.message) || "保存失败";
        wx.showToast({ title: msg, icon: "none" });
        // 回滚：头像回到缓存里的值，昵称输入框回到已保存值
        const cached = auth.getUser() || {};
        this.setData({
          avatarUrl: cached.avatar || "",
          nicknameDraft: cached.nickname || "",
        });
      })
      .then(() => this.setData({ savingAvatar: false, savingNickname: false }));
  },

  // ---------------- 隐私授权（微信《用户隐私保护指引》）----------------

  /** 查询是否还有待用户同意的隐私政策；未同意时在资料卡上方给出提示条 */
  checkPrivacy() {
    privacy.check().then(({ needAuthorization, contractName }) => {
      if (needAuthorization === this.data.privacyNeeded) return;
      this.setData({
        privacyNeeded: needAuthorization,
        privacyContractName: contractName || "《用户隐私保护指引》",
      });
    });
  },

  /** 用户轻触「同意」：微信已同步同意状态，此后声明的隐私接口与组件均可用 */
  onAgreePrivacy() {
    this.setData({ privacyNeeded: false });
    wx.showToast({ title: "已同意隐私协议", icon: "none" });
  },

  /** 查看管理后台配置的隐私协议全文 */
  onOpenPrivacyContract() {
    privacy.openContract().catch(() => {
      wx.showToast({ title: "打开隐私协议失败，请稍后重试", icon: "none" });
    });
  },

  /** 展开 / 收起账号信息（OpenID、UnionID） */
  toggleId() {
    this.setData({ showId: !this.data.showId });
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

  // ---------------- 注销账号 ----------------

  /**
   * 注销账号。两级确认：第一级讲清不可逆的后果，第二级要求手动输入确认词。
   *
   * 为什么要两级：「确定要注销吗」这种单次弹窗太容易被手指惯性点掉，
   * 而这一步会永久删除账号及全部同步任务、活动记录、平台绑定与同步日志 ——
   * 没有回收站，也没有客服能找回。确认词与后端要求的完全一致（见
   * `DELETE_CONFIRM_PHRASE`），前端这道只是提示，真正的校验在服务端。
   */
  onDeleteAccount() {
    wx.showModal({
      title: "注销账号",
      content:
        "注销后将永久删除你的账号，以及全部同步任务、活动记录、平台绑定与同步日志，" +
        "且无法恢复。\n\n确定要继续吗？",
      confirmText: "继续",
      confirmColor: "#ef4444",
      success: (r1) => {
        if (!r1.confirm) return;
        wx.showModal({
          title: "最后确认",
          content: "请输入「注销」以确认",
          editable: true,
          placeholderText: "注销",
          confirmText: "确认注销",
          confirmColor: "#ef4444",
          success: (r2) => {
            if (!r2.confirm) return;
            if (String(r2.content || "").trim() !== "注销") {
              wx.showToast({ title: "确认词不正确，已取消", icon: "none" });
              return;
            }
            this.doDeleteAccount();
          },
        });
      },
    });
  },

  doDeleteAccount() {
    wx.showLoading({ title: "正在注销…", mask: true });
    api.auth
      .deleteAccount("注销")
      .then(() => {
        wx.hideLoading();
        auth.clear();
        wx.showToast({ title: "账号已注销", icon: "none" });
        // 与退出登录走同一条路径。本地态必须清干净：用户已不存在，
        // 残留的 token 与用户资料只会换来一连串 401。
        setTimeout(() => getApp().onLoggedOut(), 700);
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: (err && err.message) || "注销失败，请稍后重试", icon: "none" });
      });
  },
});
