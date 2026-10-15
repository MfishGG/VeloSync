/**
 * 登录态管理：JWT 与用户信息持久化到本地缓存
 */

const KEYS = {
  access: "velosync_access",
  refresh: "velosync_refresh",
  user: "velosync_user",
  demo: "velosync_demo",
};

let accessToken = null;
let refreshToken = null;
let user = null;
/** 当前登录态是否来自「演示模式」入口（提审 / 对外演示） */
let demoMode = false;

function load() {
  try {
    accessToken = wx.getStorageSync(KEYS.access) || null;
    refreshToken = wx.getStorageSync(KEYS.refresh) || null;
    const raw = wx.getStorageSync(KEYS.user);
    user = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
    demoMode = !!wx.getStorageSync(KEYS.demo);
  } catch (e) {
    accessToken = null;
    refreshToken = null;
    user = null;
    demoMode = false;
  }
}

function getAccess() {
  return accessToken;
}

function getRefresh() {
  return refreshToken;
}

function getUser() {
  return user;
}

function isLoggedIn() {
  return !!accessToken;
}

/**
 * 标记 / 读取「当前是演示账号」。
 *
 * 为什么要持久化：演示账号是一份**共享数据**（所有从演示入口进来的人共用同一个
 * 账号），若界面上没有标识，演示对象会以为这是自己的账号，往里加数据后下次再
 * 进来发现「东西没了」。存本地是因为它必须跨冷启动仍在，而登录响应里只带一次。
 */
function setDemo(on) {
  demoMode = !!on;
  try {
    if (demoMode) wx.setStorageSync(KEYS.demo, 1);
    else wx.removeStorageSync(KEYS.demo);
  } catch (e) {
    /* 存储失败不阻断流程 */
  }
}

function isDemoMode() {
  return demoMode;
}

function setTokens(access, refresh) {
  accessToken = access || null;
  if (refresh) refreshToken = refresh;
  try {
    if (accessToken) wx.setStorageSync(KEYS.access, accessToken);
    if (refreshToken) wx.setStorageSync(KEYS.refresh, refreshToken);
  } catch (e) {
    /* 存储失败不阻断流程 */
  }
}

function setUser(u) {
  user = u || null;
  try {
    if (user) wx.setStorageSync(KEYS.user, JSON.stringify(user));
    else wx.removeStorageSync(KEYS.user);
  } catch (e) {
    /* ignore */
  }
}

function clear() {
  accessToken = null;
  refreshToken = null;
  user = null;
  demoMode = false;
  try {
    wx.removeStorageSync(KEYS.access);
    wx.removeStorageSync(KEYS.refresh);
    wx.removeStorageSync(KEYS.user);
    wx.removeStorageSync(KEYS.demo);
  } catch (e) {
    /* ignore */
  }
}

/** 跳转登录页（避免重复 reLaunch） */
function redirectToLogin() {
  const pages = getCurrentPages();
  const current = pages.length ? pages[pages.length - 1].route : "";
  if (current === "pages/login/login") return;
  wx.reLaunch({ url: "/pages/login/login" });
}

module.exports = {
  KEYS,
  load,
  getAccess,
  getRefresh,
  getUser,
  isLoggedIn,
  setDemo,
  isDemoMode,
  setTokens,
  setUser,
  clear,
  redirectToLogin,
};
