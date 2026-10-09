const api = require("../../api/index");
const auth = require("../../utils/auth");
const theme = require("../../utils/theme");
const fmt = require("../../utils/format");

Page({
  data: {
    loading: true,
    error: "",
    list: [],
    runningId: null,
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
    return api.pipelines
      .list()
      .then((list) => this.setData({ list: this.decorate(list), loading: false }))
      .catch((err) => {
        this.setData({
          loading: false,
          error:
            err.status === 0
              ? "无法连接后端服务，请先启动 Django（127.0.0.1:8000）"
              : err.message,
        });
      });
  },

  decorate(list) {
    return (list || []).map((p) => {
      const st = theme.RUN_STATUS[p.last_run_status] || null;
      return Object.assign({}, p, {
        runLabel: st ? st.label : "未运行",
        runColor: st ? st.color : "#cbd5e1",
        lastRunText: p.last_run_at ? fmt.fmtRelative(p.last_run_at) : "尚未运行",
        contentChips: (p.content_labels || []).slice(0, 4),
        moreContents: Math.max(0, (p.content_labels || []).length - 4),
      });
    });
  },

  goNew() {
    wx.navigateTo({ url: "/pages/pipeline-new/pipeline-new" });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/pipeline-edit/pipeline-edit?id=${id}` });
  },

  runTask(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    if (this.data.runningId) return;
    wx.showLoading({ title: "运行中…", mask: true });
    this.setData({ runningId: id });
    api.pipelines
      .run(id)
      .then((res) => {
        const status = res.status;
        if (status === "pending" || status === "running") {
          return this.pollRun(id);
        }
        return res;
      })
      .then((res) => {
        wx.hideLoading();
        this.setData({ runningId: null });
        if (!res) {
          wx.showToast({ title: "已提交执行", icon: "none" });
          return this.load().then(() => {});
        }
        const st = theme.RUN_STATUS[res.status] || { label: res.status };
        const stats = res.stats || {};
        wx.showModal({
          title: `「${name}」执行${st.label}`,
          content:
            `命中活动 ${stats.activities || 0} 条\n` +
            `成功同步 ${stats.uploaded || 0} 条 · 跳过 ${stats.skipped || 0} 条 · 失败 ${stats.failed || 0} 条` +
            (stats.coord_fixed_points ? `\n坐标纠偏 ${stats.coord_fixed_points} 个轨迹点` : ""),
          showCancel: false,
          confirmText: "知道了",
        });
        return this.load().then(() => {});
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ runningId: null });
        wx.showToast({ title: err.message || "运行失败", icon: "none" });
      });
  },

  /** 异步派发后轮询运行状态，直到出现终态（取代已移除的 SSE 长连接） */
  pollRun(id) {
    return new Promise((resolve) => {
      let tries = 0;
      const tick = () => {
        tries += 1;
        api.pipelines
          .runStatus(id)
          .then((s) => {
            if (s.done || tries > 30) {
              resolve({ status: s.status || "pending", stats: s.stats || {} });
              return;
            }
            setTimeout(tick, 1200);
          })
          .catch(() => resolve(null));
      };
      setTimeout(tick, 900);
    });
  },

  deleteTask(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    wx.showModal({
      title: "删除同步任务",
      content: `确定删除「${name}」？该操作不可撤销，已同步的数据不受影响。`,
      confirmText: "删除",
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;
        api.pipelines
          .remove(id)
          .then(() => {
            wx.showToast({ title: "已删除", icon: "success" });
            this.load();
          })
          .catch((err) => wx.showToast({ title: err.message || "删除失败", icon: "none" }));
      },
    });
  },
});
