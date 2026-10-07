const api = require("../../api/index");
const auth = require("../../utils/auth");
const chart = require("../../utils/chart");
const theme = require("../../utils/theme");
const fmt = require("../../utils/format");

Page({
  data: {
    loading: true,
    error: "",
    stats: null,
    cards: [],
    distribution: [],
    trend: [],
    recent: [],
    user: null,
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      auth.redirectToLogin();
      return;
    }
    const app = getApp();
    this.setData({ user: app.globalData.user });
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ error: "" });
    return api.dashboard
      .stats()
      .then((stats) => {
        const cards = [
          { label: "活动总数", value: stats.total_activities, unit: "条", tint: "primary" },
          { label: "已同步", value: stats.synced, unit: "条", tint: "success" },
          { label: "待同步", value: stats.pending, unit: "条", tint: "warning" },
          { label: "同步率", value: stats.sync_rate, unit: "%", tint: "primary" },
        ];
        const distribution = (stats.platform_distribution || []).map((d) => ({
          name: d.platform,
          value: d.count,
        }));
        const trend = (stats.trend_30d || []).map((d) => ({
          label: String(d.date).slice(5),
          value: d.count,
        }));
        const recent = (stats.recent_syncs || []).map((r) => ({
          activity_id: r.activity_id,
          activity: r.activity,
          platform: r.platform,
          synced_at: fmt.fmtRelative(r.synced_at),
        }));
        this.setData({
          stats,
          cards,
          distribution,
          trend,
          recent,
          loading: false,
        });
        this.renderCharts();
      })
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

  renderCharts() {
    wx.nextTick(() => {
      this.drawPie();
      this.drawTrend();
    });
  },

  drawPie() {
    chart.setupCanvas(this, "#pieChart").then((c) => {
      if (!c) return;
      chart.drawPie(c.ctx, c.width, c.height, this.data.distribution, theme.PIE_PALETTE);
    });
  },

  drawTrend() {
    chart.setupCanvas(this, "#trendChart").then((c) => {
      if (!c) return;
      chart.drawTrend(c.ctx, c.width, c.height, this.data.trend, {
        color: theme.COLORS.primary,
        fill: "#eef2ff",
      });
    });
  },

  goPipelines() {
    wx.switchTab({ url: "/pages/pipelines/pipelines" });
  },

  goMatrix() {
    wx.switchTab({ url: "/pages/matrix/matrix" });
  },

  goFit() {
    wx.switchTab({ url: "/pages/fit/fit" });
  },
});
