const { offlineText } = require("../../utils/env");
const api = require("../../api/index");
const auth = require("../../utils/auth");
const chart = require("../../utils/chart");
const metrics = require("../../utils/fitMetrics");
const coords = require("../../utils/coords");
const theme = require("../../utils/theme");
const fmt = require("../../utils/format");

const ROW_H = 64; // 分图模式每行高度（px）
const ROW_H_FS = 108; // 全屏分图每行高度上限（屏幕放不下时按可用高度压缩）
const ROW_MIN_FS = 76; // 全屏分图每行高度下限
const OVERLAY_H = 210; // 叠加模式画布高度（px）
const SPEEDS = [1, 2, 4, 8];

/** 全屏时标题栏 / 维度切换条 / 页码条实际占掉的高度（px），用于算画布可用高度 */
const FS_RESERVED = 148;
/** 地图 fit 时四周留白（px）：不留白轨迹会贴边，看起来像被裁掉 */
const MAP_PADDING = [56, 56, 56, 56];

Page({
  data: {
    id: 0,
    loading: true,
    error: "",
    detail: null,
    summary: null,
    device: null,
    title: "FIT 详情",
    fileSizeText: "",
    hashShort: "",
    cards: [],
    // 图表控制
    dim: "time",
    mode: "split",
    overlayKeys: [],
    metricDefs: [], // 供叠加模式选择用的全部指标
    chartHeight: 400,
    chartW: 0,
    hasChart: false,
    // 卡片内每行图的行高：WXML 用它在每幅图右下角定位「全屏」按钮
    rowH: ROW_H,
    // 图表全屏预览（整卡：分指标分页 / 叠加）
    fullscreen: false,
    fsRows: [], // 全屏分图当前页要画的指标
    fsPage: 0,
    fsPageCount: 1,
    fsRowHeight: ROW_H_FS,
    fsChartHeight: 0,
    // 轨迹
    hasGps: false,
    polyline: [],
    markers: [],
    mapCenter: { latitude: 0, longitude: 0 },
    includePoints: [],
    mapScale: 14,
    playing: false,
    speedIndex: 1,
    speeds: SPEEDS,
    trackIndex: 0,
    trackTotal: 0,
    trackLabel: "",
    simplify: 1,
  },

  onLoad(query) {
    if (!auth.isLoggedIn()) {
      auth.redirectToLogin();
      return;
    }
    const id = Number(query.id || 0);
    this.setData({ id, metricDefs: metrics.FIT_METRICS });
    this.load();
  },

  onUnload() {
    this.stopPlay();
  },

  /** 错误态的「重新加载」：本页没开下拉刷新，出错后只能靠这个按钮自救 */
  reload() {
    this.setData({ error: "", loading: true }, () => this.load());
  },

  onReady() {
    if (typeof wx.createMapContext === "function") {
      this.mapCtx = wx.createMapContext("fitMap", this);
    }
    // 数据可能在 onReady 之前就到了（离线缓存 / 后端很快），补一次视野自适应
    this.fitMapToTrack();
  },

  onResize() {
    // 横竖屏切换后画布尺寸变了，重算并重画，否则线会按旧尺寸被拉伸
    if (this.data.fullscreen) {
      this.applyFullscreenLayout(true);
    } else if (this.data.detail) {
      this.resizeChart();
    }
  },

  /**
   * 让地图视野贴合整条轨迹。
   *
   * 原来只往 include-points 里塞了一个「轨迹中心点」：单点在 map 组件里等同于
   * 放大到极限，于是进页面看到的是一片空白底图，轨迹在视野外。改成把轨迹的
   * 左下 / 右上两个角点交给 includePoints，并留出 padding —— 轨迹多长都能完整入画。
   */
  fitMapToTrack() {
    if (this.data.hasGps === false) return;
    const pts = this.data.includePoints || [];
    if (pts.length < 2) return;
    if (typeof wx.createMapContext !== "function") return;
    if (!this.mapCtx) this.mapCtx = wx.createMapContext("fitMap", this);
    this.mapCtx.includePoints({ points: pts, padding: MAP_PADDING });
  },

  load() {
    this.setData({ error: "" });
    return api.activities
      .fitDetail(this.data.id)
      .then((detail) => {
        const s = detail.summary || {};
        const track = detail.track || [];
        const hasGps = s.has_gps && track.length > 1;
        // 点数过多时按步长抽稀后再上屏，保证地图流畅
        const simplify = Math.max(1, Math.ceil(track.length / 1200));
        const poly = hasGps ? coords.toPolylines(track, { simplify, color: "#4f46e5", width: 5 }) : [];
        const b = hasGps ? coords.bounds(track) : null;

        this.setData({
          detail,
          summary: s,
          device: detail.device || {},
          title: `${fmt.sportLabel(s.activity_type)} · ${detail.file_name || "FIT"}`,
          fileSizeText: fmtFileSize(detail.file_size),
          hashShort: String(detail.file_hash || "").slice(0, 12),
          cards: buildCards(s, detail),
          overlayKeys: metrics.defaultOverlayKeys(s.available_metrics),
          loading: false,
          hasGps,
          simplify,
          polyline: poly,
          includePoints: b ? bboxCorners(b) : [],
          mapCenter: b ? { longitude: b.center[0], latitude: b.center[1] } : { latitude: 0, longitude: 0 },
          trackTotal: track.length,
          trackIndex: hasGps ? Math.min(track.length - 1, 0) : 0,
          trackLabel: hasGps ? `1 / ${track.length}` : "",
        });
        this.updateMarker(0);
        this.resizeChart();
        // 等 map 渲染出这一帧再 fit，太早调 includePoints 会被随后的初始定位覆盖
        wx.nextTick(() => setTimeout(() => this.fitMapToTrack(), 60));
      })
      .catch((err) =>
        this.setData({
          loading: false,
          error:
            err.status === 0 ? offlineText() : err.message,
        }),
      );
  },

  updateMarker(index) {
    const { detail, hasGps, simplify } = this.data;
    if (!hasGps || !detail) return;
    const track = detail.track;
    const raw = track[Math.min(index, track.length - 1)];
    const gcj = coords.trackToGcj02([raw])[0];
    this.setData({
      markers: [
        {
          id: 1,
          longitude: gcj[0],
          latitude: gcj[1],
          width: 22,
          height: 22,
          callout: {
            content: `第 ${Math.min(index + 1, track.length)} 点`,
            color: "#1e293b",
            fontSize: 11,
            borderRadius: 6,
            padding: 4,
            bgColor: "#ffffff",
            display: "ALWAYS",
            textAlign: "center",
          },
        },
      ],
    });
  },

  // ---------------- 图表尺寸 ----------------
  resizeChart() {
    const h = this.data.mode === "overlay" ? OVERLAY_H : metrics.FIT_METRICS.length * ROW_H;
    // 高度变化后需要等布局完成再取画布节点尺寸
    this.setData({ chartHeight: h }, () => {
      wx.nextTick(() => setTimeout(() => this.drawChart(), 40));
    });
  },

  currentDefs() {
    if (this.data.mode === "overlay") {
      return metrics.FIT_METRICS.filter((m) => this.data.overlayKeys.indexOf(m.key) >= 0);
    }
    return metrics.FIT_METRICS;
  },

  onDimChange(e) {
    const dim = e.currentTarget.dataset.dim;
    if (dim === this.data.dim) return;
    this.setData({ dim }, () => {
      if (this.data.fullscreen) this.drawFullscreen();
      else this.drawChart();
    });
  },

  onModeChange(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.mode) return;
    this.setData({ mode }, () => {
      if (this.data.fullscreen) this.applyFullscreenLayout(false);
      else this.resizeChart();
    });
  },

  toggleOverlay(e) {
    if (this.data.mode !== "overlay") return;
    const key = e.currentTarget.dataset.key;
    const list = this.data.overlayKeys.slice();
    const i = list.indexOf(key);
    if (i >= 0) {
      if (list.length === 1) {
        wx.showToast({ title: "至少保留一个指标", icon: "none" });
        return;
      }
      list.splice(i, 1);
    } else {
      if (list.length >= 6) {
        wx.showToast({ title: "最多同时叠加 6 个指标", icon: "none" });
        return;
      }
      list.push(key);
    }
    // 保持注册表顺序
    const ordered = metrics.FIT_METRICS.filter((m) => list.indexOf(m.key) >= 0).map((m) => m.key);
    this.setData({ overlayKeys: ordered }, () => {
      if (this.data.fullscreen) this.drawFullscreen();
      else this.drawChart();
    });
  },

  // ---------------- 全屏预览 ----------------
  openFullscreen() {
    if (!this.data.detail) return;
    this.setData({ fullscreen: true, fsPage: 0 }, () => this.applyFullscreenLayout(false));
  },

  closeFullscreen() {
    if (!this.data.fullscreen) return;
    this.setData({ fullscreen: false }, () => this.resizeChart());
  },

  /**
   * 单幅图全屏：跳独立的横屏页。
   *
   * 小程序没有运行时强制横屏的 API，只能靠页面 json 配 pageOrientation: landscape，
   * 所以「点一下就是横屏」必须借一个单独的页面。detail 通过 eventChannel 递过去，
   * 目标页不用再请求一次 FIT 解析结果。
   */
  openMetricFullscreen(e) {
    if (!this.data.detail) return;
    const key = e.currentTarget.dataset.key;
    wx.navigateTo({
      url: `/pages/fit-metric/fit-metric?id=${this.data.id}&key=${key}&dim=${this.data.dim}`,
      success: (res) => {
        if (res && res.eventChannel) res.eventChannel.emit("fitDetail", { detail: this.data.detail });
      },
    });
  },

  /**
   * 排一次全屏布局：按当前屏幕高度算「每页几行 / 画布多高」。
   *
   * 为什么分页而不是让 canvas 拉长放进 scroll-view：15 行 × 108px ≈ 1620px 的
   * 原生画布在 scroll-view 里滚动会掉帧，而且滚动过程中的 canvas 重绘不可控。
   * 分页后画布恒定等于一屏，翻页就是换一组指标重画，行为确定。
   */
  applyFullscreenLayout(keepPage) {
    // 叠加模式顶部还多一排指标 chip，要多让出约 72px
    const chipsH = this.data.mode === "overlay" ? 72 : 0;
    const avail = Math.max(200, getWindowHeight() - FS_RESERVED - chipsH);
    if (this.data.mode === "overlay") {
      this.fsPer = metrics.FIT_METRICS.length;
      this.setData(
        {
          fsRows: metrics.FIT_METRICS,
          fsRowHeight: 0,
          fsChartHeight: avail,
          fsPageCount: 1,
          fsPage: 0,
        },
        () => wx.nextTick(() => setTimeout(() => this.drawFullscreen(), 40)),
      );
      return;
    }

    const rowHeight = Math.min(ROW_H_FS, Math.max(ROW_MIN_FS, Math.floor(avail / 4)));
    const per = Math.max(2, Math.floor(avail / rowHeight));
    const defs = metrics.FIT_METRICS;
    const pages = Math.max(1, Math.ceil(defs.length / per));
    const page = keepPage ? Math.min(this.data.fsPage, pages - 1) : 0;
    const rows = defs.slice(page * per, page * per + per);

    this.fsPer = per;
    this.setData(
      {
        fsRows: rows,
        fsRowHeight: rowHeight,
        fsChartHeight: rows.length * rowHeight,
        fsPageCount: pages,
        fsPage: page,
      },
      () => wx.nextTick(() => setTimeout(() => this.drawFullscreen(), 40)),
    );
  },

  prevFsPage() {
    this.gotoFsPage(this.data.fsPage - 1);
  },

  nextFsPage() {
    this.gotoFsPage(this.data.fsPage + 1);
  },

  /** 翻到第 page 页（0 基），越界自动夹住 */
  gotoFsPage(page) {
    if (!this.fsPer || this.data.mode === "overlay") return;
    const pages = this.data.fsPageCount;
    const next = Math.max(0, Math.min(page, pages - 1));
    if (next === this.data.fsPage) return;
    const rows = metrics.FIT_METRICS.slice(next * this.fsPer, next * this.fsPer + this.fsPer);
    this.setData(
      { fsPage: next, fsRows: rows, fsChartHeight: rows.length * this.data.fsRowHeight },
      () => wx.nextTick(() => setTimeout(() => this.drawFullscreen(), 40)),
    );
  },

  /** 吞掉触摸移动：全屏层盖住页面时，别让底下的长页面跟着滑动 */
  noop() {},

  // ---------------- 绘制 ----------------
  drawChart() {
    this.paint("#fitChart", this.currentDefs(), ROW_H, false);
  },

  drawFullscreen() {
    if (!this.data.fullscreen) return;
    if (this.data.mode === "overlay") {
      this.paint("#fsChart", metrics.FIT_METRICS, 0, false);
    } else {
      this.paint("#fsChart", this.data.fsRows, this.data.fsRowHeight, true);
    }
  },

  /**
   * 统一绘制入口：卡片内和全屏共用同一套绘制，只有画布选择器 / 行高 / 字号不同。
   * @param {string} selector 画布选择器
   * @param {Array} defs 要画的指标定义（全屏分图只画当前页）
   * @param {number} rowHeight 行高（0 表示由函数自行决定）
   * @param {boolean} large 是否用全屏的放大字号
   * @param {object} [extra] 额外绘制选项（如刻度数量）
   */
  paint(selector, defs, rowHeight, large, extra) {
    const { detail, dim, mode, overlayKeys } = this.data;
    if (!detail || !detail.samples) return;
    chart.setupCanvas(this, selector).then((c) => {
      if (!c) return;
      chart.clear(c.ctx, c.width, c.height);
      if (mode === "overlay") {
        this.drawOverlay(c.ctx, c.width, c.height, overlayKeys, dim);
      } else {
        this.drawSplit(c.ctx, c.width, c.height, dim, defs, rowHeight, large, extra);
      }
    });
  },

  drawSplit(ctx, w, h, dim, defs, rowHeight, large, extra) {
    const samples = this.data.detail.samples || [];
    const rows = (defs || metrics.FIT_METRICS).map((def) => {
      const series = metrics.extractSeries(samples, def.key, dim);
      const range = series.length ? metrics.seriesRange(series) : null;
      return {
        label: def.label,
        unit: def.unit,
        color: def.color,
        fill: def.fill,
        kind: def.kind,
        blank: def.blank,
        series,
        avg: series.length && range ? (range.min + range.max) / 2 : null,
        emptyText: "该 FIT 文件未记录此项",
      };
    });
    // 单图铺满时行高远大于全屏分栏，字号再提一档，否则大片留白配小字
    const big = rowHeight && rowHeight >= 160;
    chart.drawMetricStack(ctx, w, h, rows, {
      rowHeight: rowHeight || ROW_H,
      dim,
      labelWidth: big ? 52 : large ? 46 : 40,
      font: big ? 15 : large ? 13 : 11,
      fontSmall: big ? 12 : large ? 11 : 9,
      xTickCount: extra && extra.xTickCount,
      yTickCount: extra && extra.yTickCount,
      bottomPad: extra && extra.bottomPad,
    });
  },

  drawOverlay(ctx, w, h, keys, dim) {
    const samples = this.data.detail.samples || [];
    const list = metrics.FIT_METRICS.filter((m) => keys.indexOf(m.key) >= 0).map((def) => ({
      def,
      series: metrics.extractSeries(samples, def.key, dim),
    }));
    chart.drawOverlayChart(ctx, w, h, list, {
      dim,
      emptyText: "所选指标在当前文件中都没有数据",
    });
  },

  // ---------------- 轨迹回放 ----------------
  togglePlay() {
    if (!this.data.hasGps) return;
    if (this.data.playing) this.stopPlay();
    else this.startPlay();
  },

  startPlay() {
    this.setData({ playing: true });
    const speed = SPEEDS[this.data.speedIndex];
    const step = Math.max(1, Math.round(this.data.simplify * speed));
    this.timer = setInterval(() => {
      let next = this.data.trackIndex + step;
      if (next >= this.data.trackTotal) {
        next = this.data.trackTotal - 1;
        this.stopPlay();
      }
      this.setData({ trackIndex: next, trackLabel: `${next + 1} / ${this.data.trackTotal}` });
      this.updateMarker(next);
    }, 120);
  },

  stopPlay() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.setData({ playing: false });
  },

  onSpeedChange(e) {
    this.setData({ speedIndex: Number(e.detail.value) });
    if (this.data.playing) {
      this.stopPlay();
      this.startPlay();
    }
  },

  onSeek(e) {
    const idx = Number(e.detail.value);
    this.stopPlay();
    this.setData({ trackIndex: idx, trackLabel: `${idx + 1} / ${this.data.trackTotal}` });
    this.updateMarker(idx);
  },

  gotoStart() {
    this.stopPlay();
    this.setData({ trackIndex: 0, trackLabel: `1 / ${this.data.trackTotal}` });
    this.updateMarker(0);
  },

  gotoEnd() {
    this.stopPlay();
    const last = this.data.trackTotal - 1;
    this.setData({ trackIndex: last, trackLabel: `${last + 1} / ${this.data.trackTotal}` });
    this.updateMarker(last);
  },
});

function avgOf(series) {
  if (!series.length) return null;
  return series.reduce((s, p) => s + p[1], 0) / series.length;
}

/**
 * 轨迹包围盒的两个对角点，交给 map 的 include-points 自动定视野。
 *
 * 单点会退化：map 组件对「只有一个点」的 include-points 等同于拉到最大缩放，
 * 于是进去只看到一片底图。中心点留给 latitude/longitude，视野交给对角点。
 */
function bboxCorners(b) {
  // 轨迹是直线（经度或纬度全等）时两个点会重合，补一点余量否则算不出跨度
  const padLng = b.maxLng - b.minLng < 1e-6 ? 0.0004 : 0;
  const padLat = b.maxLat - b.minLat < 1e-6 ? 0.0004 : 0;
  return [
    { longitude: b.minLng - padLng, latitude: b.minLat - padLat },
    { longitude: b.maxLng + padLng, latitude: b.maxLat + padLat },
  ];
}

/** 可用视口高度（px）：全屏分页算页数要用，兼容新旧基础库 */
function getWindowHeight() {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return (info && info.windowHeight) || 667;
  } catch (e) {
    return 667;
  }
}

function fmtFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function buildCards(s, detail) {
  const cards = [];
  const push = (label, value, sub) => {
    if (value === null || value === undefined || value === "") return;
    cards.push({ label, value, sub: sub || "" });
  };
  push("距离", `${fmt.fmtNum(s.distance_km, 2)}`, "km");
  push("时长", fmt.fmtDuration(s.duration), "");
  push("爬升", s.total_ascent === null ? null : fmt.fmtNum(s.total_ascent, 0), "m");
  push("卡路里", s.calories === null ? null : fmt.fmtNum(s.calories, 0), "kcal");
  push("平均心率", s.avg_heart_rate === null ? null : fmt.fmtNum(s.avg_heart_rate, 0), "bpm");
  push("最大心率", s.max_heart_rate === null ? null : fmt.fmtNum(s.max_heart_rate, 0), "bpm");
  push("平均功率", s.avg_power === null ? null : fmt.fmtNum(s.avg_power, 0), "W");
  push("最大功率", s.max_power === null ? null : fmt.fmtNum(s.max_power, 0), "W");
  push("平均踏频", s.avg_cadence === null ? null : fmt.fmtNum(s.avg_cadence, 0), "rpm");
  push("平均速度", s.avg_speed_kmh === null ? null : fmt.fmtNum(s.avg_speed_kmh, 1), "km/h");
  push("最大速度", s.max_speed_kmh === null ? null : fmt.fmtNum(s.max_speed_kmh, 1), "km/h");
  push("采样点", s.sample_count, "个");
  push("轨迹点", s.track_point_count, s.has_gps ? "个" : "无 GPS");
  push("覆盖指标", (s.available_metrics || []).length, "/ 15 项");
  return cards;
}
