/**
 * 请求层：与 Web 端 frontend/src/api/client.ts 行为对齐
 * - 自动附带 Bearer Token
 * - 401 时单飞刷新一次并重试
 * - 错误统一抛 ApiError（带 status / code / payload），便于页面按 code 分支
 *
 * 【两条传输通道】
 * 小程序正式环境**不能**用云托管默认公网域名（官方禁止，小程序后台也会拒绝
 * 把它配进 request 合法域名）。所以：
 *
 *   callContainer  云托管专用通道，不需要域名 / 备案 / 域名白名单  ← 正式环境
 *   wx.request     公网 HTTPS，需要 request 合法域名              ← 本地联调 / 自定义域名
 *
 * 参数齐了就优先走 callContainer，否则回退公网请求。两者返回结构一致
 * （statusCode / data），上层无感知。
 */

const config = require("../config");
const auth = require("./auth");
const cloudrun = require("./cloudrun");

class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiError";
    this.status = status || 0;
    this.payload = payload || null;
    this.code = payload && typeof payload.code === "string" ? payload.code : undefined;
  }
}

/**
 * 后端地址：**启动时由 config.js 决定，运行期不可改**。
 *
 * 以前这里是 `let` + `setBaseUrl()`，供登录页那个「接口地址」入口调用。
 * 那个入口已整体删除，因此把可写性也一并去掉了 —— 留着 setter 等于留一个
 * 「任何页面都能把 Bearer Token 发到任意服务器」的接口，比界面上多一个输入框
 * 更隐蔽。要换地址就改 `config.js` 的 `env` 再上传。
 */
const baseUrl = config.baseUrl;

function getBaseUrl() {
  return baseUrl;
}

/** 云托管对小程序调用的超时上限是 15 秒，超过会被平台拒绝 */
const CALLCONTAINER_MAX_TIMEOUT = 15000;

/** 云托管参数是否齐全、基础库是否支持 callContainer */
function canUseCallContainer() {
  return !!(
    cloudrun.env &&
    cloudrun.service &&
    typeof wx !== "undefined" &&
    wx.cloud &&
    typeof wx.cloud.callContainer === "function"
  );
}

/**
 * 从 baseUrl 取出路径前缀（形如 "/api"）。
 * callContainer 的 path 是「服务内的路径」，不含域名，所以要把这段前缀带上，
 * 否则会打到 "/auth/demo/" 而不是 "/api/auth/demo/"。
 */
function apiPathPrefix() {
  const m = String(baseUrl || "").match(/^https?:\/\/[^/]+(\/[^?#]*)?/i);
  return ((m && m[1]) || "").replace(/\/+$/, "");
}

/** 公网通道：wx.request，需域名已登记为 request 合法域名 */
function publicRequest(options) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}${options.path}`,
      method: options.method || "GET",
      data: options.data,
      header: options.header || {},
      timeout: options.timeout || config.requestTimeout,
      success: resolve,
      fail: reject,
    });
  });
}

/** 云托管通道：走微信内部链路，不经过域名白名单 */
function callContainerRequest(options) {
  return new Promise((resolve, reject) => {
    wx.cloud.callContainer({
      config: { env: cloudrun.env },
      path: apiPathPrefix() + options.path,
      method: options.method || "GET",
      data: options.data,
      header: Object.assign({ "X-WX-SERVICE": cloudrun.service }, options.header || {}),
      timeout: Math.min(options.timeout || CALLCONTAINER_MAX_TIMEOUT, CALLCONTAINER_MAX_TIMEOUT),
      success: resolve,
      fail: reject,
    });
  });
}

/** 统一出口：能走内网就走内网 */
function transport(options) {
  return canUseCallContainer() ? callContainerRequest(options) : publicRequest(options);
}

let refreshing = null;

function refreshAccess() {
  if (!auth.getRefresh()) return Promise.resolve(false);
  if (refreshing) return refreshing;
  refreshing = transport({
    path: "/auth/refresh/",
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
 * @param {{method?:string, data?:any, header?:object, timeout?:number}} options
 */
async function api(path, options) {
  const opts = options || {};
  const send = () =>
    transport({
      path,
      method: opts.method || "GET",
      data: opts.data,
      header: buildHeader(opts.header),
      timeout: opts.timeout,
    });

  let res;
  try {
    res = await send();
  } catch (err) {
    // 网络不可达。保留原始 errMsg —— 它是区分「域名未登记」与「真的断网」的唯一线索，
    // 在 handleError 里按 "url not in domain list" 分流。
    throw new ApiError((err && err.errMsg) || "网络请求失败", 0, null);
  }

  if (res.statusCode === 401 && auth.getRefresh()) {
    if (await refreshAccess()) {
      res = await send();
    }
  }
  return ensureOk(res).data;
}

// ---------------- 文件上传（FIT） ----------------

/** ASCII 字符串 → 字节；multipart 的头部全是 ASCII，文件名单独处理 */
function asciiBytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

function concatBytes(chunks) {
  let total = 0;
  chunks.forEach((c) => (total += c.length));
  const out = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((c) => {
    out.set(c, offset);
    offset += c.length;
  });
  return out.buffer;
}

/**
 * multipart/form-data 是手工拼的。
 *
 * 原因：callContainer 没有 `wx.uploadFile` 的对应物，只接受 `data`。而 Django 的
 * MultiPartParser 要的是标准 multipart 报文，所以这里按 RFC 7578 把
 * 「字段头 + 文件字节 + 结束边界」拼成一个 ArrayBuffer 发过去。
 * 后端读的还是 `request.FILES["file"]`，接口无需改动。
 */
function uploadViaContainer(path, filePath, field, formData, fileName) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      success: (r) => {
        const boundary = "----VeloSync" + Date.now().toString(36);
        // 文件名进的是 header，只能是 ASCII；中文名会让 header 编码出错，
        // 且后端仅把它当展示用的 file_name，退回一个安全名字即可。
        const safeName = /^[\x20-\x7e]+$/.test(fileName || "") ? fileName : "upload.fit";

        let pre = "";
        Object.keys(formData || {}).forEach((k) => {
          pre += `--${boundary}\r\n`;
          pre += `Content-Disposition: form-data; name="${k}"\r\n\r\n`;
          pre += `${formData[k]}\r\n`;
        });
        pre += `--${boundary}\r\n`;
        pre += `Content-Disposition: form-data; name="${field}"; filename="${safeName}"\r\n`;
        pre += "Content-Type: application/octet-stream\r\n\r\n";

        const tail = `\r\n--${boundary}--\r\n`;
        const body = concatBytes([
          asciiBytes(pre),
          new Uint8Array(r.data),
          asciiBytes(tail),
        ]);

        const header = buildHeader({
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        });

        wx.cloud.callContainer({
          config: { env: cloudrun.env },
          path: apiPathPrefix() + path,
          method: "POST",
          header: Object.assign({ "X-WX-SERVICE": cloudrun.service }, header),
          data: body,
          // 解析 FIT 是重活，但云托管对 callContainer 的硬上限就是 15 秒
          timeout: CALLCONTAINER_MAX_TIMEOUT,
          success: (res) => {
            let b = res.data;
            if (typeof b === "string") {
              try {
                b = JSON.parse(b);
              } catch (e) {
                /* 保持原样 */
              }
            }
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(b);
              return;
            }
            const detail =
              (b && typeof b === "object" && (b.detail || b.message)) ||
              `上传失败（${res.statusCode}）`;
            reject(new ApiError(detail, res.statusCode, b));
          },
          fail: (err) =>
            reject(new ApiError((err && err.errMsg) || "上传失败，请检查网络", 0, null)),
        });
      },
      fail: () => reject(new ApiError("读取文件失败，请重新选择", 0, null)),
    });
  });
}

/** 公网通道的上传：wx.uploadFile */
function uploadViaPublic(path, filePath, field, formData) {
  return new Promise((resolve, reject) => {
    const header = {};
    const token = auth.getAccess();
    if (token) header.Authorization = `Bearer ${token}`;
    wx.uploadFile({
      url: `${baseUrl}${path}`,
      filePath,
      name: field,
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
        reject(new ApiError((err && err.errMsg) || "上传失败，请检查网络", 0, null)),
    });
  });
}

/**
 * multipart 上传（FIT 文件），返回响应体
 * @param {string} path
 * @param {string} filePath 临时文件路径
 * @param {string} field   表单字段名
 * @param {object} formData 额外字段
 * @param {string} fileName 原始文件名（仅用于后端记录，可缺省）
 */
function upload(path, filePath, field, formData, fileName) {
  return canUseCallContainer()
    ? uploadViaContainer(path, filePath, field || "file", formData, fileName)
    : uploadViaPublic(path, filePath, field || "file", formData);
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

module.exports = {
  api,
  upload,
  poll,
  ApiError,
  getBaseUrl,
  canUseCallContainer,
};
