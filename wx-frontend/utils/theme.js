/** 视觉与图表配色（与 app.wxss 的 CSS 变量保持一致） */

const COLORS = {
  primary: "#4f46e5",
  primarySoft: "#eef2ff",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  text1: "#1e293b",
  text2: "#475569",
  text3: "#94a3b8",
  line: "#e2e8f0",
  grid: "#eef2f7",
  card: "#ffffff",
};

/** 平台分布饼图配色（按下标循环） */
const PIE_PALETTE = [
  "#4f46e5",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
  "#ec4899",
];

/** 同步状态 → 展示元信息 */
const SYNC_STATUS = {
  synced: { label: "已同步", color: "#10b981", bg: "#ecfdf5", icon: "check" },
  pending: { label: "待同步", color: "#f59e0b", bg: "#fffbeb", icon: "clock" },
  failed: { label: "失败", color: "#ef4444", bg: "#fef2f2", icon: "close" },
  na: { label: "不适用", color: "#cbd5e1", bg: "#f8fafc", icon: "minus" },
};

/** 日志级别 → 展示元信息 */
const LOG_LEVELS = {
  info: { label: "信息", color: "#475569", bg: "#f1f5f9" },
  success: { label: "成功", color: "#059669", bg: "#ecfdf5" },
  warning: { label: "警告", color: "#b45309", bg: "#fffbeb" },
  error: { label: "错误", color: "#b91c1c", bg: "#fef2f2" },
};

/** 任务运行状态 */
const RUN_STATUS = {
  success: { label: "成功", color: "#10b981" },
  partial: { label: "部分成功", color: "#f59e0b" },
  error: { label: "失败", color: "#ef4444" },
  pending: { label: "等待中", color: "#94a3b8" },
  running: { label: "运行中", color: "#4f46e5" },
};

/** 活动矩阵单元格展示字符 */
const CELL_SYMBOL = {
  synced: "✓",
  pending: "!",
  failed: "×",
  na: "–",
};

module.exports = {
  COLORS,
  PIE_PALETTE,
  SYNC_STATUS,
  LOG_LEVELS,
  RUN_STATUS,
  CELL_SYMBOL,
};
