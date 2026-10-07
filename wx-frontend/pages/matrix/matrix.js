const api = require("../../api/index");
const auth = require("../../utils/auth");
const theme = require("../../utils/theme");
const fmt = require("../../utils/format");

Page({
  data: {
    loading: true,
    error: "",
    platforms: [],
    rows: [],
    legend: [],
    syncedCount: 0,
    totalCells: 0,
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
      .matrix()
      .then((data) => {
        const platforms = data.platforms || [];
        let synced = 0;
        let total = 0;
        const rows = (data.activities || []).map((a) => {
          const cells = platforms.map((p) => {
            const st = a.states[p.code] || { status: "na" };
            const meta = theme.SYNC_STATUS[st.status] || theme.SYNC_STATUS.na;
            if (st.status !== "na") total += 1;
            if (st.status === "synced") synced += 1;
            return {
              code: p.code,
              platformId: p.id,
              platformName: p.name,
              status: st.status,
              symbol: theme.CELL_SYMBOL[st.status] || "–",
              color: meta.color,
              bg: meta.bg,
              error: st.error_message || "",
              remote: st.remote_activity_id || "",
            };
          });
          return {
            id: a.id,
            name: a.name,
            type: fmt.sportLabel(a.activity_type),
            time: fmt.fmtShort(a.start_timestamp),
            distance: fmt.fmtDistance(a.distance),
            duration: fmt.fmtDuration(a.duration),
            cells,
          };
        });
        this.setData({
          platforms,
          rows,
          loading: false,
          syncedCount: synced,
          totalCells: total,
          legend: Object.keys(theme.SYNC_STATUS).map((k) =>
            Object.assign({ key: k, symbol: theme.CELL_SYMBOL[k] }, theme.SYNC_STATUS[k]),
          ),
        });
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

  onCell(e) {
    const { row, col } = e.currentTarget.dataset;
    const activity = this.data.rows[row];
    const cell = activity.cells[col];
    const meta = theme.SYNC_STATUS[cell.status] || theme.SYNC_STATUS.na;

    const lines = [
      `活动：${activity.name}`,
      `时间：${activity.time}`,
      `平台：${cell.platformName}`,
      `状态：${meta.label}`,
    ];
    if (cell.remote) lines.push(`远端 ID：${cell.remote}`);
    if (cell.error) lines.push(`错误：${cell.error}`);

    const canSync = cell.status !== "synced";
    wx.showModal({
      title: "同步状态",
      content: lines.join("\n"),
      confirmText: canSync ? "手动同步" : "知道了",
      cancelText: canSync ? "取消" : "",
      showCancel: canSync,
      success: (r) => {
        if (!canSync || !r.confirm) return;
        this.manualSync(activity.id, cell);
      },
    });
  },

  manualSync(activityId, cell) {
    wx.showLoading({ title: "同步中…", mask: true });
    api.activities
      .syncToPlatform(activityId, cell.platformId)
      .then((state) => {
        wx.hideLoading();
        const ok = state && state.status === "synced";
        wx.showToast({
          title: ok ? "同步成功" : (state && state.error_message) || "同步结束",
          icon: ok ? "success" : "none",
        });
        this.load();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err.message || "同步失败", icon: "none" });
      });
  },
});
