const api = require("../../api/index");
const auth = require("../../utils/auth");
const chart = require("../../utils/chart");
const metrics = require("../../utils/fitMetrics");
const coords = require("../../utils/coords");
const theme = require("../../utils/theme");
const fmt = require("../../utils/format");

const ROW_H = 64; // 分图模式每行高度（px）
const OVERLAY_H = 210; // 叠加模式画布高度（px）
const SPEEDS = [1, 2, 4, 8];

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
    // 轨迹
    hasGps: false,
    polyline: [],
    markers: [],
    mapCenter: { latitude: 0, longitude: 0 },
    includePoints: [],
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
          includePoints: b ? [{ longitude: b.center[0], latitude: b.center[1] }] : [],
          mapCenter: b ? { longitude: b.center[0], latitude: b.center[1] } : { latitude: 0, longitude: 0 },
          trackTotal: track.length,
          trackIndex: hasGps ? Math.min(track.length - 1, 0) : 0,
          trackLabel: hasGps ? `1 / ${track.length}` : "",
        });
        this.updateMarker(0);
        this.resizeChart();
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
    const defs = this.currentDefs();
    const h = this.data.mode === "overlay" ? OVERLAY_H : Math.max(1, defs.length) * ROW_H;
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
    this.setData({ dim }, () => this.drawChart());
  },

  onModeChange(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.mode) return;
    this.setData({ mode }, () => this.resizeChart());
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
    this.setData({ overlayKeys: ordered }, () => this.drawChart());
  },

  // ---------------- 绘制 ----------------
  drawChart() {
    const { detail, dim, mode, overlayKeys, chartHeight } = this.data;
    if (!detail || !detail.samples) return;
    chart.setupCanvas(this, "#fitChart").then((c) => {
      if (!c) return;
      chart.clear(c.ctx, c.width, c.height);
      if (mode === "overlay") {
        this.drawOverlay(c.ctx, c.width, c.height, overlayKeys, dim);
      } else {
        this.drawSplit(c.ctx, c.width, c.height, dim);
      }
    });
  },

  drawSplit(ctx, w, h, dim) {
    const samples = this.data.detail.samples || [];
    const rows = metrics.FIT_METRICS.map((def) => {
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
    chart.drawMetricStack(ctx, w, h, rows, { rowHeight: ROW_H, dim, labelWidth: 40 });
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
