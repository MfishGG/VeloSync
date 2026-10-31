/**
 * 单指标横屏全屏页
 *
 * 为什么单独开一页：小程序没有「运行时强制横屏」的 API，能控方向的只有页面
 * json 里的 pageOrientation（landscape，基础库 2.5.0+）。所以从 FIT 详情点某幅图
 * 右下角的全屏按钮进来，就是横屏，不需要用户自己把手机转过来。
 *
 * 尺寸全交给布局，JS 只量不算：
 * 横屏下 wx.getWindowInfo().windowHeight 在部分机型 / 基础库上仍返回竖屏高度
 * （实测 852 而不是 393），拿它减操作条高度算出来的画布是 806px，比整个屏幕还高。
 * 画完底部那 22px 的时间轴标签正好落在屏幕外，曲线也被"截"在屏幕下沿 —— 看起来
 * 就是「横坐标不显示、图超出屏幕」。CSS 的 100vh 是对的，所以画布高度由
 * .fsp__body 的 flex 撑满，绘制时用 createSelectorQuery 量真实像素。
 *
 * 数据来源两路：opener 通过 eventChannel 把已加载的 detail 直接递过来（同一逻辑层，
 * 不额外发请求）；没有 opener 时按 id 自己拉一次，保证这页能被单独打开。
 */
const chart = require("../../utils/chart");
const metrics = require("../../utils/fitMetrics");
const api = require("../../api/index");

const TICK_X = 8; // 横屏够宽，时间轴刻度可以比竖屏密
const TICK_Y = 5;
const BOTTOM_PAD = 22; // 给时间轴标签留的高度，不然最底一行标签会被裁
const BAR_H = 46; // 操作条兜底高度（px），实际值按胶囊位置算
/** 胶囊右侧让位兜底（px）：量不到胶囊位置时按这个宽度让出，宁多勿少 */
const CAP_RIGHT = 104;

Page({
  data: {
    key: "",
    label: "",
    dim: "time",
    rangeText: "",
    loading: true,
    error: "",
    barH: BAR_H,
    capRight: CAP_RIGHT,
  },

  onLoad(q) {
    const def = metrics.FIT_METRICS.filter((m) => m.key === q.key)[0] || metrics.FIT_METRICS[0];
    this.setData({
      key: def.key,
      label: def.label,
      dim: q.dim === "distance" ? "distance" : "time",
    });
    this.measureChrome();

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
    this.draw();
    // 转屏兜底：个别机型横过来之后不触发 onResize，延迟复测一次尺寸
    this.watchers = [400, 1200].map((d) =>
      setTimeout(() => {
        this.ensureSize();
      }, d),
    );
  },

  onResize() {
    // 尺寸来源变了（转屏 / 分屏）：重新让位 + 重绘
    this.measureChrome();
    this.scheduleDraw(80);
  },

  onUnload() {
    if (this.timer) clearTimeout(this.timer);
    if (this.drawTimer) clearTimeout(this.drawTimer);
    (this.watchers || []).forEach((t) => clearTimeout(t));
  },

  /** 按胶囊实测位置决定操作条高度与右侧留白 */
  measureChrome() {
    const g = capsuleSpace();
    this.setData({ barH: g.barH, capRight: g.capRight });
  },

  apply(detail) {
    if (this.timer) clearTimeout(this.timer);
    this.setData({ detail, loading: false, error: "" }, () => this.scheduleDraw(40));
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

  onDim(e) {
    const dim = e.currentTarget.dataset.dim;
    if (dim === this.data.dim) return;
    this.setData({ dim }, () => this.draw());
  },

  /** 等一帧再画：setData 引起的高度变化要等布局完成，量出来的才是新尺寸 */
  scheduleDraw(delay) {
    if (this.drawTimer) clearTimeout(this.drawTimer);
    this.drawTimer = setTimeout(() => {
      this.drawTimer = null;
      wx.nextTick(() => this.draw());
    }, delay || 40);
  },

  draw() {
    const detail = this.data.detail;
    if (!detail || !detail.samples) return;
    const def = metrics.FIT_METRICS.filter((m) => m.key === this.data.key)[0];
    if (!def) return;

    chart.setupCanvas(this, "#fsChart").then((c) => {
      // 画布刚由 wx:if 插进来、或刚转屏时可能量到 0 / 旧尺寸，画了也是错的
      if (!c || c.width < 80 || c.height < 80) {
        this.retryDraw();
        return;
      }
      this.retries = 0;

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
          // 指标名与幅度已经在操作条上，画布内不再重复画标题（省出顶部高度）
          title: false,
          labelWidth: 56,
          font: 15,
          fontSmall: 12,
          xTickCount: TICK_X,
          yTickCount: TICK_Y,
          bottomPad: BOTTOM_PAD,
        },
      );
      this.drawnW = c.width;
      this.drawnH = c.height;
      this.setData({
        rangeText: range
          ? `${chart.fmtTick(range.min)}~${chart.fmtTick(range.max)} ${def.unit}`
          : `无${def.label}数据`,
      });
    });
  },

  /** 尺寸还没就绪（画布未插入 / 布局未完成）时的短重试，最多 5 次 */
  retryDraw() {
    this.retries = (this.retries || 0) + 1;
    if (this.retries > 5) return;
    this.scheduleDraw(120);
  },

  /** 实际尺寸和上次绘制用的不一致就重画（覆盖「转屏没触发 onResize」的情况） */
  ensureSize() {
    chart.measure(this, "#fsChart").then((s) => {
      if (!s) return;
      if (Math.abs(s.width - (this.drawnW || 0)) > 1 || Math.abs(s.height - (this.drawnH || 0)) > 1) {
        this.draw();
      }
    });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },
});

/**
 * 右上角胶囊的占位。
 *
 * navigationStyle: custom 只是让我们自己画导航栏，胶囊（··· ◎）仍然是系统画的，
 * 永远浮在窗口右上角、不会给自绘操作条让路。不预留就会被它压住「时间/距离」切换，
 * 所以右侧内边距按「窗口宽 - 胶囊左边缘 + 8」算，高度也至少压到胶囊底部以下。
 */
function capsuleSpace() {
  let capRight = CAP_RIGHT;
  let barH = BAR_H;
  try {
    const r = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect();
    const win = windowWidth();
    if (r && r.left > 0 && win > 0) {
      const pad = Math.round(win - r.left + 8);
      // 正常应落在窗口右半边的窄条里；算出负数说明窗口宽还是竖屏的旧值，用兜底
      if (pad > 40 && pad < win * 0.45) capRight = pad;
      // 胶囊底部 + 8 是对齐用的；超过 64 说明拿到的是竖屏坐标（那里胶囊压得低），忽略
      const h = Math.round(r.bottom + 8);
      if (h > BAR_H && h <= 64) barH = h;
    }
  } catch (e) {
    // 老基础库没有这个接口，保留兜底值
  }
  return { capRight, barH };
}

function windowWidth() {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return (info && info.windowWidth) || 0;
  } catch (e) {
    return 0;
  }
}
