/**
 * 后端接口封装（与 Web 端 frontend/src/api/queries.ts 对齐）
 * 小程序没有 TanStack Query，这里全部返回 Promise，页面自行管理 loading。
 */

const { api, upload } = require("../utils/request");

/** 去掉 axios 风格的 query 拼装 */
function qs(params) {
  const parts = [];
  Object.keys(params || {}).forEach((k) => {
    const v = params[k];
    if (v === undefined || v === null || v === "") return;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  });
  return parts.length ? `?${parts.join("&")}` : "";
}

// ---------------- 认证 ----------------
const auth = {
  login: (username, password) =>
    api("/auth/login/", { method: "POST", data: { username, password } }),

  register: (payload) => api("/auth/register/", { method: "POST", data: payload }),

  me: () => api("/auth/me/"),

  refresh: (refresh) => api("/auth/refresh/", { method: "POST", data: { refresh } }),

  /** 微信小程序一键登录：code 由 wx.login() 得到 */
  wxMiniProgramLogin: (payload) =>
    api("/auth/wx/miniprogram/", { method: "POST", data: payload }),

  /** 查询小程序登录模式（oauth：已配置 AppID；mock：演示身份） */
  wxMiniProgramMode: () => api("/auth/wx/miniprogram/"),
};

// ---------------- 平台与账号 ----------------
const platforms = {
  list: () => api("/platforms/"),
  accounts: () => api("/accounts/"),
  removeAccount: (id) => api(`/accounts/${id}/`, { method: "DELETE" }),

  /** 真实 OAuth：返回 authorize_url（未配置凭证时抛 ApiError(code=oauth_not_configured)） */
  authorize: (code) => api(`/accounts/${code}/authorize/`),

  /** 演示身份绑定：无凭证也能跑通全链路 */
  demoBind: (code) => api(`/accounts/${code}/demo-bind/`, { method: "POST" }),
};

// ---------------- 同步任务 ----------------
const pipelines = {
  list: () => api("/pipelines/"),
  detail: (id) => api(`/pipelines/${id}/`),
  create: (payload) => api("/pipelines/", { method: "POST", data: payload }),
  update: (id, payload) => api(`/pipelines/${id}/`, { method: "PUT", data: payload }),
  remove: (id) => api(`/pipelines/${id}/`, { method: "DELETE" }),

  run: (id) => api(`/pipelines/${id}/run/`, { method: "POST" }),

  /** 规格目录：来源 / 内容 / 选项 / 可绑账号 / FIT 记录 */
  syncSpec: () => api("/pipelines/sync-spec/"),

  /** 未保存配置的试运行预览 */
  syncPreview: (payload) => api("/pipelines/sync-preview/", { method: "POST", data: payload }),

  /** 已保存任务的试运行预览（可传覆盖字段） */
  preview: (id, payload) =>
    api(`/pipelines/${id}/preview/`, { method: "POST", data: payload || {} }),
};

// ---------------- 活动与矩阵 ----------------
const activities = {
  list: (params) => api(`/activities/${qs(params)}`),
  matrix: () => api("/activities/matrix/"),

  /** 手动补同步到指定平台（后端字段名为 platform_id） */
  syncToPlatform: (id, platformId) =>
    api(`/activities/${id}/sync/`, { method: "POST", data: { platform_id: platformId } }),

  /** FIT 详情：GET 取解析结果，DELETE 删记录（with_activity=1 同时删活动） */
  fitDetail: (id) => api(`/activities/${id}/fit/`),
  deleteFit: (id, withActivity) =>
    api(`/activities/${id}/fit/${withActivity ? "?with_activity=1" : ""}`, { method: "DELETE" }),

  /** FIT 导入历史（轻量列表，不含 samples/track） */
  fitHistory: () => api("/activities/fit-history/"),

  /** 上传 FIT 文件（filePath 为 wx.chooseMessageFile 得到的临时路径） */
  uploadFit: (filePath) => upload("/activities/upload-fit/", filePath, "file"),
};

// ---------------- 日志与统计 ----------------
const logs = {
  list: (params) => api(`/logs/${qs(params)}`),
};

const dashboard = {
  stats: () => api("/dashboard/stats/"),
};

module.exports = { auth, platforms, pipelines, activities, logs, dashboard, qs };
