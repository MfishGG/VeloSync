/**
 * 运行环境判定的唯一来源。
 *
 * 为什么单独抽一个模块：`isDevVersion()` 被三处用到（app 启动、登录页、设置页），
 * 而它守着一条安全边界 —— 正式版里「修改后端接口地址」是一条 Token 外泄通道，
 * 任何诱导（截图教程、群消息「改下地址就能用」）都能让用户在不知情下把
 * `Authorization: Bearer <JWT>` 发到攻击者服务器。
 * 三份拷贝一旦漂移，漏改的那一处就是缺口，所以只保留一份。
 */

/**
 * 当前是否为「非正式版」（develop / trial）。
 *
 * `envVersion` 缺失时按 develop 处理；但**调用本身抛异常时返回 `false`**
 * （按正式版处理）—— 失败时偏向安全：宁可少一个开发入口，也不外泄凭据。
 * 这两条分支不要合并，语义不同。
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
