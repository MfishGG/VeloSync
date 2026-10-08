/**
 * 头像处理：把微信 chooseAvatar 给的本地临时文件读成可持久化的 dataURL。
 *
 * 为什么必须落库：`open-type="chooseAvatar"` 返回的是本机临时路径
 * （wxfile:// 或 http://tmp/xxx），小程序重启即失效。
 *
 * 关于压缩：微信头像本身只有 132px 一档，`chooseAvatar` 返回的图通常也只有
 * 几十 KB，再做 canvas 压缩收益很小 —— 而 canvas 2d 需要页面里存在
 * `<canvas type="2d">` 节点，为一个头像在个人页塞一块画布既脏又容易在真机上
 * 出兼容问题。所以这里只做体积检查：超过阈值才提示，不强行压缩。
 */

/** 单张头像允许的最大字节数（与后端 AVATAR_MAX_BYTES 对齐，留一点余量） */
const AVATAR_MAX_BYTES = 300 * 1024;

/** 读取本地文件为 base64（不带 dataURL 前缀） */
function readAsBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: "base64",
      success: (res) => resolve(res.data),
      fail: reject,
    });
  });
}

/** 从文件头几字节猜 MIME，避免一律当 jpeg 导致 png 透明底变黑 */
function guessMime(base64) {
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  if (base64.startsWith("UklGR")) return "image/webp";
  return "image/jpeg";
}

/**
 * 把临时头像路径转成 dataURL。
 * @param {string} tempPath chooseAvatar 回调给的临时路径
 * @returns {Promise<string>} 形如 data:image/jpeg;base64,xxx
 */
function toDataUrl(tempPath) {
  return readAsBase64(tempPath).then((b64) => {
    const bytes = Math.floor((b64.length * 3) / 4);
    if (bytes > AVATAR_MAX_BYTES) {
      const err = new Error(
        `头像文件过大（${Math.round(bytes / 1024)}KB），请换一张小一些的图片`
      );
      err.code = "avatar_too_large";
      throw err;
    }
    return `data:${guessMime(b64)};base64,${b64}`;
  });
}

module.exports = { toDataUrl, AVATAR_MAX_BYTES };
