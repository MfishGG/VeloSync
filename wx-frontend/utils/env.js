/**
 * 运行环境判定的唯一来源。
 *
 * `isDevVersion()` 只决定**错误文案说多细**（非正式版会报出后端域名、提示去配
 * 「request 合法域名」，连不上时还会让你去启动 Django；正式版只说「网络连接失败」
 * 或「网络连接失败，请检查网络后重试」）—— 终端用户看到域名、127.0.0.1 和后台配置项
 * 没有意义，也不该把这些印在界面上。
 *
 * 它曾经还用来看守「修改后端接口地址」这条通道（正式版禁止改地址，否则用户的
 * `Authorization: Bearer <JWT>` 会被诱导发到攻击者服务器）。那个入口连同
 * `utils/request.js` 的 `setBaseUrl()` 已整体删除，地址只能在 `config.js` 里改，
 * 所以这层不再是安全边界，只是文案开关。
 *
 * 仍然只保留一份：两处判定一旦漂移，就会出现「开发版按正式版说话」这类怪相。
 * 各页面的「连不上后端」文案统一走下面的 `offlineText()` / `offlineShort()`，
 * 不要在页面里再手写一份。
 */

/**
 * 当前是否为「非正式版」（develop / trial）。
 *
 * `envVersion` 缺失时按 develop 处理；但**调用本身抛异常时返回 `false`**
 * （按正式版处理）—— 失败时宁可按正式版：文案更克制，不会把后端域名和
 * 后台配置项印到用户眼前。这两条分支不要合并，语义不同。
 */
function isDevVersion() {
  try {
    const info = wx.getAccountInfoSync ? wx.getAccountInfoSync().miniProgram || {} : {};
    return (info.envVersion || "develop") !== "release";
  } catch (e) {
    return false;
  }
}

/** 当前环境版本（develop / trial / release），用于「关于」页与排查展示 */function getEnvVersion() {
  try {
    const info = wx.getAccountInfoSync ? wx.getAccountInfoSync().miniProgram || {} : {};
    return info.envVersion || "develop";
  } catch (e) {
    return "unknown";
  }
}

/**
 * 「连不上后端」的文案。
 *
 * 非正式版提 Django 与 `127.0.0.1:8000`，是给开发者的排查线索；正式版只说网络。
 * 这条判断此前只有登录页做了，其余八个页面各写各的，于是终端用户会在
 * 「数据」页看到「请先启动 Django（127.0.0.1:8000）」—— 他既没有 Django
 * 也不该知道这个地址。文案统一收在这里，别在页面里再手写一份。
 */
function offlineText() {
  return isDevVersion()
    ? "无法连接后端服务，请先启动 Django（127.0.0.1:8000）"
    : "网络连接失败，请检查网络后重试";
}

/** 同上，给 wx.showToast 标题用的短版本（标题过长会被截断） */
function offlineShort() {
  return isDevVersion() ? "无法连接后端服务" : "网络连接失败";
}

module.exports = { isDevVersion, getEnvVersion, offlineText, offlineShort };
