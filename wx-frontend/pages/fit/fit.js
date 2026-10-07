const api = require("../../api/index");
const auth = require("../../utils/auth");
const fmt = require("../../utils/format");

Page({
  data: {
    loading: true,
    uploading: false,
    error: "",
    list: [],
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      auth.redirectToLogin();
      return;
    }
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ error: "" });
    return api.activities
      .fitHistory()
      .then((rows) => {
        const list = (rows || []).map((r) => ({
          id: r.id,
          activity_id: r.activity_id,
          activity_name: r.activity_name,
          activity_type: fmt.sportLabel(r.activity_type),
          file_name: r.file_name,
          file_size: fmtFileSize(r.file_size),
          hash_short: String(r.file_hash || "").slice(0, 10),
          start: fmt.fmtShort(r.start_timestamp),
          distance: fmt.fmtDistance(r.distance),
          duration: fmt.fmtDuration(r.duration),
          sample_count: r.sample_count,
          track_point_count: r.track_point_count,
          has_gps: r.has_gps,
          device_name: r.device_name || "未知设备",
        }));
        this.setData({ list, loading: false });
      })
      .catch((err) =>
        this.setData({
          loading: false,
          error:
            err.status === 0
              ? "无法连接后端服务，请先启动 Django（127.0.0.1:8000）"
              : err.message,
        }),
      );
  },

  /** 从聊天记录里选择 .fit 文件（小程序唯一能拿到本地文件的途径） */
  chooseAndUpload() {
    if (this.data.uploading) return;
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["fit"],
      success: (res) => {
        const f = (res.tempFiles || [])[0];
        if (!f) return;
        if (!/\.fit$/i.test(f.name || "")) {
          wx.showToast({ title: "请选择 .fit 文件", icon: "none" });
          return;
        }
        this.doUpload(f.path, f.name);
      },
      fail: (err) => {
        if (err && /cancel/.test(err.errMsg || "")) return;
        wx.showToast({ title: "选择文件失败，请从聊天记录中选择", icon: "none" });
      },
    });
  },

  doUpload(filePath, name) {
    this.setData({ uploading: true });
    wx.showLoading({ title: "解析中…", mask: true });
    api.activities
      .uploadFit(filePath)
      .then((res) => {
        wx.hideLoading();
        this.setData({ uploading: false });
        const d = res.detail;
        const s = d.summary || {};
        wx.showModal({
          title: res.created ? "导入成功" : "该文件已导入过",
          content:
            `${name}\n` +
            `采样点 ${s.sample_count || 0} · 轨迹点 ${s.track_point_count || 0}\n` +
            `覆盖指标 ${(s.available_metrics || []).length} 项`,
          confirmText: "查看详情",
          cancelText: "留在列表",
          success: (r) => {
            if (r.confirm) {
              wx.navigateTo({ url: `/pages/fit-detail/fit-detail?id=${res.activity.id}` });
            } else {
              this.load();
            }
          },
        });
        this.load();
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ uploading: false });
        wx.showToast({
          title: err.status === 0 ? "无法连接后端服务" : err.message || "解析失败",
          icon: "none",
        });
      });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/fit-detail/fit-detail?id=${id}` });
  },

  /** 删除：两次确认，第二次可选择是否连活动一起删 */
  onDelete(e) {
    const { id, name, activityId } = e.currentTarget.dataset;
    wx.showModal({
      title: "删除 FIT 解析记录",
      content: `确定删除「${name}」的解析结果？\n删除后曲线、轨迹与指标数据将不可恢复。`,
      confirmText: "继续",
      confirmColor: "#ef4444",
      success: (r1) => {
        if (!r1.confirm) return;
        wx.showModal({
          title: "是否同时删除活动记录？",
          content: "同时删除后，该活动会从「活动矩阵」中一并消失；仅删解析则活动保留。",
          confirmText: "同时删活动",
          cancelText: "仅删解析",
          confirmColor: "#ef4444",
          success: (r2) => {
            this.doDelete(id, r2.confirm, activityId);
          },
        });
      },
    });
  },

  doDelete(id, withActivity) {
    wx.showLoading({ title: "删除中…", mask: true });
    api.activities
      .deleteFit(id, withActivity)
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: "已删除", icon: "success" });
        this.load();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err.message || "删除失败", icon: "none" });
      });
  },

  goGuide() {
    wx.showModal({
      title: "如何导入 FIT 文件",
      content:
        "小程序只能读取聊天记录中的文件：\n" +
        "1) 把 .fit 文件发送到「文件传输助手」或任意会话；\n" +
        "2) 回到本页点「选择 FIT 文件」；\n" +
        "3) 在聊天记录里选中该文件即可上传解析。",
      showCancel: false,
      confirmText: "知道了",
    });
  },
});

function fmtFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
