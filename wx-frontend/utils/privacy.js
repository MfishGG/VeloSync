/**
 * 隐私授权（微信《用户隐私保护指引》）
 *
 * 背景：自 2023-10-17 起，**不论 app.json 是否配置 __usePrivacyCheck__**，隐私拦截
 * 都会启用。开发者未在管理后台声明、或用户尚未同意隐私政策时，隐私接口与组件会被
 * 直接拦截，报 `errno 112`（未声明）/ `errno 104`（用户未同意）。
 *
 * 本项目涉及的隐私能力：
 *   - `<button open-type="getPhoneNumber">` → 手机号
 *   - `<button open-type="chooseAvatar">`   → 头像（用户选择的图片）
 *   - `<input type="nickname">`             → 微信昵称
 *
 * ⚠️ 最隐蔽的一个坑：`<input type="nickname">` 在用户未同意隐私政策时**不会**触发
 * `wx.onNeedPrivacyAuthorization`，而是**静默降级为 `<input type="text">`** ——
 * 输入框还在、还能打字，但「一键填入微信昵称」的能力悄悄消失，且**不报任何错**。
 * 所以昵称这一项不能等用户触发，必须在页面进入时主动用 getPrivacySetting 检查。
 *
 * 关于官方隐私弹窗：调用隐私接口时若开发者未注册 onNeedPrivacyAuthorization 处理器，
 * 微信会自行弹出官方弹窗。本项目**刻意不注册**该处理器 —— 一旦注册却忘记 resolve，
 * 接口调用会一直挂起，风险高于收益。
 */

/** 基础库 < 2.32.3 未集成隐私能力，也不会拦截接口调用 */
function supported() {
  return typeof wx.getPrivacySetting === "function";
}

/**
 * 查询是否还有待用户同意的隐私政策。
 * @returns {Promise<{needAuthorization: boolean, contractName: string}>}
 */
function check() {
  return new Promise((resolve) => {
    if (!supported()) {
      resolve({ needAuthorization: false, contractName: "" });
      return;
    }
    wx.getPrivacySetting({
      success: (res) =>
        resolve({
          needAuthorization: !!(res && res.needAuthorization),
          contractName: (res && res.privacyContractName) || "《用户隐私保护指引》",
        }),
      // 查询失败按「无需授权」处理：真正的拦截会在调用隐私接口时给出明确错误，
      // 不该因为一次查询失败就把整页功能锁死。
      fail: () => resolve({ needAuthorization: false, contractName: "" }),
    });
  });
}

/** 打开管理后台配置的《用户隐私保护指引》页面 */
function openContract() {
  return new Promise((resolve, reject) => {
    if (typeof wx.openPrivacyContract !== "function") {
      reject(new Error("当前微信版本过低，无法查看隐私协议"));
      return;
    }
    wx.openPrivacyContract({ success: resolve, fail: reject });
  });
}

/**
 * 主动触发隐私授权（用于没有 open-type 可耦合的场景，例如聚焦昵称输入框前）。
 * 已同意过则立即成功；未同意则走微信的隐私弹窗流程。
 */
function authorize() {
  return new Promise((resolve, reject) => {
    if (typeof wx.requirePrivacyAuthorize !== "function") {
      resolve({ ok: true });
      return;
    }
    wx.requirePrivacyAuthorize({
      success: () => resolve({ ok: true }),
      fail: (err) => reject(err),
    });
  });
}

module.exports = { supported, check, openContract, authorize };
