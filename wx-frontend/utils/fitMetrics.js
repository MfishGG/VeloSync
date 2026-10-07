/**
 * FIT 采样指标注册表
 * 与后端 apps/activities/fit_utils.py 的 METRIC_SPEC、Web 端 utils/fitMetrics.ts 一一对应。
 *
 * - 分图模式：每个指标各占一行（文件里没有数据也保留空白图位）
 * - 叠加模式：任意多个指标叠到同一张 canvas（共用横轴，纵轴做归一化）
 */

const FIT_METRICS = [
  { key: "heart_rate", label: "心率", unit: "bpm", color: "#ef4444", fill: "#fee2e2", kind: "area", blank: [60, 200], core: true, group: "基础" },
  { key: "power", label: "功率", unit: "W", color: "#f59e0b", fill: "#fef3c7", kind: "area", blank: [0, 400], core: true, group: "基础" },
  { key: "cadence", label: "踏频", unit: "rpm", color: "#8b5cf6", fill: "#ede9fe", kind: "area", blank: [0, 120], core: true, group: "基础" },
  { key: "speed_kmh", label: "速度", unit: "km/h", color: "#0ea5e9", fill: "#e0f2fe", kind: "line", blank: [0, 60], core: true, group: "基础" },
  { key: "altitude", label: "海拔", unit: "m", color: "#6366f1", fill: "#e0e7ff", kind: "area", blank: [0, 200], core: true, group: "基础" },
  { key: "grade", label: "坡度", unit: "%", color: "#14b8a6", fill: "#ccfbf1", kind: "line", blank: [-20, 20], group: "基础" },
  { key: "temperature", label: "温度", unit: "°C", color: "#f97316", fill: "#ffedd5", kind: "line", blank: [-10, 45], group: "基础" },
  { key: "calories", label: "累计消耗", unit: "kcal", color: "#eab308", fill: "#fef9c3", kind: "line", blank: [0, 1000], group: "基础" },
  { key: "torque_effectiveness", label: "扭矩效率", unit: "%", color: "#f43f5e", fill: "#ffe4e6", kind: "line", blank: [0, 100], group: "骑行进阶" },
  { key: "pedal_smoothness", label: "踩踏平顺度", unit: "%", color: "#84cc16", fill: "#ecfccb", kind: "line", blank: [0, 100], group: "骑行进阶" },
  { key: "accumulated_power", label: "累计做功", unit: "W", color: "#64748b", fill: "#f1f5f9", kind: "line", blank: [0, 100000], group: "骑行进阶" },
  { key: "vertical_oscillation", label: "垂直振幅", unit: "mm", color: "#a855f7", fill: "#f3e8ff", kind: "line", blank: [0, 50], group: "跑步姿态" },
  { key: "stance_time", label: "触地时间", unit: "ms", color: "#22c55e", fill: "#dcfce7", kind: "line", blank: [0, 500], group: "跑步姿态" },
  { key: "step_length", label: "步幅", unit: "mm", color: "#ec4899", fill: "#fce7f3", kind: "line", blank: [0, 2000], group: "跑步姿态" },
  { key: "muscle_oxygen", label: "肌氧饱和度", unit: "%", color: "#06b6d4", fill: "#cffafe", kind: "line", blank: [0, 100], group: "生理" },
];

const METRIC_MAP = {};
FIT_METRICS.forEach((m) => {
  METRIC_MAP[m.key] = m;
});

/** 叠加模式默认勾选：文件里确实有数据的核心指标 */
function defaultOverlayKeys(available) {
  const avail = available || [];
  const keys = FIT_METRICS.filter((m) => m.core && avail.indexOf(m.key) >= 0).map((m) => m.key);
  return keys.length ? keys : ["heart_rate", "power", "cadence"];
}

/**
 * 从 samples 中抽取某指标的 [x, y] 序列
 * @param {Array<object>} samples
 * @param {string} key 指标键
 * @param {"time"|"distance"} dim 横轴维度
 */
function extractSeries(samples, key, dim) {
  const out = [];
  (samples || []).forEach((s, i) => {
    const y = s[key];
    if (y === null || y === undefined) return;
    const x = dim === "distance" ? s.distance_km : s.t !== null && s.t !== undefined ? s.t : i;
    if (x === null || x === undefined) return;
    out.push([Number(x), Number(y)]);
  });
  return out;
}

/** 某指标在 samples 中是否有有效点 */
function hasMetric(samples, key) {
  return (samples || []).some((s) => s[key] !== null && s[key] !== undefined);
}

/** 计算序列的极值 */
function seriesRange(series) {
  if (!series.length) return null;
  let min = series[0][1];
  let max = series[0][1];
  series.forEach((p) => {
    if (p[1] < min) min = p[1];
    if (p[1] > max) max = p[1];
  });
  return { min, max };
}

module.exports = {
  FIT_METRICS,
  METRIC_MAP,
  defaultOverlayKeys,
  extractSeries,
  hasMetric,
  seriesRange,
};
