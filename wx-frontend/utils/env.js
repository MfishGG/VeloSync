/**
 * 运行环境判定的唯一来源。
 *
 * 现在只剩登录页在用：`isDevVersion()` 只决定**错误文案说多细**（非正式版会报出
 * 后端域名、提示去配「request 合法域名」；正式版只说「网络连接失败」）—— 终端用户
 * 看到域名和后台配置项没有意义，也不该把后端域名印在界面上。
 *
 * 它曾经还用来看守「修改后端接口地址」这条通道（正式版禁止改地址，否则用户的
 * `Authorization: Bearer <JWT>` 会被诱导发到攻击者服务器）。那个入口连同
 * `utils/request.js` 的 `setBaseUrl()` 已整体删除，地址只能在 `config.js` 里改，
 * 所以这层不再是安全边界，只是文案开关。
 *
 * 仍然只保留一份：两处判定一旦漂移，就会出现「开发版按正式版说话」这类怪相。
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

/** 当前环境版本（develop / trial / release），用于「关于」页与排查展示 */
function getEnvVersion() {
  try {
    const info = wx.getAccountInfoSync ? wx.getAccountInfoSync().miniProgram || {} : {};
    return info.envVersion || "develop";
  } catch (e) {
    return "unknown";
  }
}

module.exports = { isDevVersion, getEnvVersion };
