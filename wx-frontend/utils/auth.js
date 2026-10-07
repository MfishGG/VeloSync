/**
 * 登录态管理：JWT 与用户信息持久化到本地缓存
 */

const KEYS = {
  access: "velosync_access",
  refresh: "velosync_refresh",
  user: "velosync_user",
};

let accessToken = null;
let refreshToken = null;
let user = null;

function load() {
  try {
    accessToken = wx.getStorageSync(KEYS.access) || null;
    refreshToken = wx.getStorageSync(KEYS.refresh) || null;
    const raw = wx.getStorageSync(KEYS.user);
    user = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
  } catch (e) {
    accessToken = null;
    refreshToken = null;
    user = null;
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
  try {
    wx.removeStorageSync(KEYS.access);
    wx.removeStorageSync(KEYS.refresh);
    wx.removeStorageSync(KEYS.user);
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
  setTokens,
  setUser,
  clear,
  redirectToLogin,
};
