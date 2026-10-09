/**
 * 请求层：与 Web 端 frontend/src/api/client.ts 行为对齐
 * - 自动附带 Bearer Token
 * - 401 时单飞刷新一次并重试
 * - 错误统一抛 ApiError（带 status / code / payload），便于页面按 code 分支
 */

const config = require("../config");
const auth = require("./auth");

class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiError";
    this.status = status || 0;
    this.payload = payload || null;
    this.code = payload && typeof payload.code === "string" ? payload.code : undefined;
  }
}

let baseUrl = config.baseUrl;

/** 运行期切换后端地址（仅开发版登录页的「接口地址」入口会调用） */
function setBaseUrl(url) {
  if (url) baseUrl = url.replace(/\/+$/, "");
}
function getBaseUrl() {
  return baseUrl;
}

function rawRequest(options) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: options.url,
      method: options.method || "GET",
      data: options.data,
      header: options.header || {},
      timeout: config.requestTimeout,
      success: resolve,
      fail: reject,
    });
  });
}

let refreshing = null;

function refreshAccess() {
  if (!auth.getRefresh()) return Promise.resolve(false);
  if (refreshing) return refreshing;
  refreshing = rawRequest({
    url: `${baseUrl}/auth/refresh/`,
    method: "POST",
    header: { "Content-Type": "application/json" },
    data: { refresh: auth.getRefresh() },
  })
    .then((res) => {
      if (res.statusCode !== 200 || !res.data || !res.data.access) {
        auth.clear();
        return false;
      }
      auth.setTokens(res.data.access, res.data.refresh || auth.getRefresh());
      return true;
    })
    .catch(() => false)
    .then((ok) => {
      refreshing = null;
      return ok;
    });
  return refreshing;
}

function buildHeader(extra) {
  const header = { "Content-Type": "application/json" };
  const token = auth.getAccess();
  if (token) header.Authorization = `Bearer ${token}`;
  return Object.assign(header, extra || {});
}

function ensureOk(res) {
  if (res.statusCode >= 200 && res.statusCode < 300) return res;
  const body = res.data && typeof res.data === "object" ? res.data : null;
  const detail =
    (body && typeof body.detail === "string" && body.detail) ||
    (body && typeof body.message === "string" && body.message) ||
    `请求失败（${res.statusCode}）`;
  throw new ApiError(detail, res.statusCode, body);
}

/**
 * @param {string} path 形如 "/pipelines/"
 * @param {{method?:string, data?:any, header?:object}} options
 */
async function api(path, options) {
  const opts = options || {};
  const send = () =>
    rawRequest({
      url: `${baseUrl}${path}`,
      method: opts.method || "GET",
      data: opts.data,
      header: buildHeader(opts.header),
    });

  let res;
  try {
    res = await send();
  } catch (err) {
    // 网络不可达：交给调用方展示「无法连接后端」
    throw new ApiError(
      (err && err.errMsg) || "无法连接后端服务，请确认 Django 已启动",
      0,
      null,
    );
  }

  if (res.statusCode === 401 && auth.getRefresh()) {
    if (await refreshAccess()) {
      res = await send();
    }
  }
  return ensureOk(res).data;
}

/** multipart 上传（FIT 文件），返回响应体 */
function upload(path, filePath, name, formData) {
  return new Promise((resolve, reject) => {
    const header = {};
    const token = auth.getAccess();
    if (token) header.Authorization = `Bearer ${token}`;
    wx.uploadFile({
      url: `${baseUrl}${path}`,
      filePath,
      name: name || "file",
      formData: formData || {},
      header,
      timeout: 120000,
      success: (res) => {
        let body = res.data;
        try {
          body = JSON.parse(res.data);
        } catch (e) {
          /* 保持原样 */
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
          return;
        }
        const detail =
          (body && typeof body === "object" && (body.detail || body.message)) ||
          `上传失败（${res.statusCode}）`;
        reject(new ApiError(detail, res.statusCode, body));
      },
      fail: (err) =>
        reject(
          new ApiError((err && err.errMsg) || "上传失败，请检查网络", 0, null),
        ),
    });
  });
}

/** 短轮询查询执行状态（小程序无 EventSource；后端也没有 SSE 端点） */
function poll(fn, { interval = 1200, timeout = 60000 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const done = await fn();
        if (done) return resolve(done);
      } catch (e) {
        return reject(e);
      }
      if (Date.now() - start > timeout) {
        return resolve(null); // 超时交给调用方按最后一次状态处理
      }
      setTimeout(tick, interval);
    };
    tick();
  });
}

module.exports = { api, upload, poll, ApiError, setBaseUrl, getBaseUrl };
