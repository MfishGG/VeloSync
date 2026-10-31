/**
 * 单指标横屏全屏页
 *
 * 为什么单独开一页：小程序没有「运行时强制横屏」的 API，能控方向的只有页面
 * json 里的 pageOrientation（landscape，基础库 2.5.0+）。所以从 FIT 详情点某幅图
 * 右下角的全屏按钮进来，就是横屏，不需要用户自己把手机转过来。
 *
 * 数据来源两路：opener 通过 eventChannel 把已加载的 detail 直接递过来（同一逻辑层，
 * 不额外发请求）；没有 opener 时按 id 自己拉一次，保证这页能被单独打开。
 */
const chart = require("../../utils/chart");
const metrics = require("../../utils/fitMetrics");
const api = require("../../api/index");

const HEAD_H = 46; // 顶部操作条高度（px），与 wxss 里 .bar 的 height 对齐
const TICK_X = 8; // 横屏够宽，时间轴刻度可以比竖屏密
const TICK_Y = 5;
const BOTTOM_PAD = 22; // 给时间轴标签留的高度，不然最底一行标签会被裁

Page({
  data: {
    key: "",
    label: "",
    dim: "time",
    rangeText: "",
    loading: true,
    error: "",
    chartH: 200,
  },

  onLoad(q) {
    const def = metrics.FIT_METRICS.filter((m) => m.key === q.key)[0] || metrics.FIT_METRICS[0];
    this.setData({
      key: def.key,
      label: def.label,
      dim: q.dim === "distance" ? "distance" : "time",
    });

    const channel = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (channel && channel.on) {
      channel.on("fitDetail", (payload) => {
        if (payload && payload.detail) this.apply(payload.detail);
      });
    }
    // 兜底：opener 没递数据（或本页被单独打开）时自己拉
    this.timer = setTimeout(() => {
      if (!this.data.detail) this.fetch(q.id);
    }, 700);
  },

  onReady() {
    this.resize();
  },

  onResize() {
    this.resize();
  },

  onUnload() {
    if (this.timer) clearTimeout(this.timer);
  },

  apply(detail) {
    if (this.timer) clearTimeout(this.timer);
    this.setData({ detail, loading: false, error: "" }, () => this.resize());
  },

  fetch(id) {
    if (!id) {
      this.setData({ loading: false, error: "缺少活动参数" });
      return;
    }
    this.setData({ loading: true });
    api.activities
      .fitDetail(id)
      .then((detail) => this.apply(detail))
      .catch((err) => this.setData({ loading: false, error: (err && err.message) || "加载失败" }));
  },

  resize() {
    const h = Math.max(120, getWindow().height - HEAD_H);
    this.setData({ chartH: h }, () => wx.nextTick(() => setTimeout(() => this.draw(), 40)));
  },

  onDim(e) {
    const dim = e.currentTarget.dataset.dim;
    if (dim === this.data.dim) return;
    this.setData({ dim }, () => this.draw());
  },

  draw() {
    const detail = this.data.detail;
    if (!detail || !detail.samples) return;
    const def = metrics.FIT_METRICS.filter((m) => m.key === this.data.key)[0];
    if (!def) return;

    chart.setupCanvas(this, "#fsChart").then((c) => {
      if (!c) return;
      chart.clear(c.ctx, c.width, c.height);
      const series = metrics.extractSeries(detail.samples, def.key, this.data.dim);
      const range = series.length ? metrics.seriesRange(series) : null;
      chart.drawMetricStack(
        c.ctx,
        c.width,
        c.height,
        [
          {
            label: def.label,
            unit: def.unit,
            color: def.color,
            fill: def.fill,
            kind: def.kind,
            blank: def.blank,
            series,
            avg: range ? (range.min + range.max) / 2 : null,
            emptyText: "该 FIT 文件未记录此项",
          },
        ],
        {
          rowHeight: c.height, // 一行铺满整屏
          dim: this.data.dim,
          labelWidth: 56,
          font: 15,
          fontSmall: 12,
          xTickCount: TICK_X,
          yTickCount: TICK_Y,
          bottomPad: BOTTOM_PAD,
        },
      );
      this.setData({
        rangeText: range
          ? `${chart.fmtTick(range.min)}~${chart.fmtTick(range.max)} ${def.unit}`
          : `无${def.label}数据`,
      });
    });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },
});

/** 视口尺寸：兼容新旧基础库 */
function getWindow() {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return { width: info.windowWidth || 667, height: info.windowHeight || 375 };
  } catch (e) {
    return { width: 667, height: 375 };
  }
}
