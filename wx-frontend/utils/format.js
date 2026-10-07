/** 时间 / 数值格式化（与 Web 端 utils/format.ts 一致） */

function pad(n, len) {
  let s = String(n);
  while (s.length < len) s = "0" + s;
  return s;
}

/** 秒 → h:mm:ss 或 m:ss */
function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${pad(m, 2)}:${pad(sec, 2)}`
    : `${m}:${pad(sec, 2)}`;
}

function fmtClock(t) {
  if (t === null || t === undefined) return "-";
  return fmtDuration(t);
}

function fmtNum(value, digits) {
  const d = digits === undefined ? 0 : digits;
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(d);
}

/** 距离：米 → km 文本 */
function fmtDistance(meters, digits) {
  if (meters === null || meters === undefined) return "-";
  const km = Number(meters) / 1000;
  return `${km.toFixed(digits === undefined ? 2 : digits)} km`;
}

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value).replace(" ", "T");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 2026-10-07 15:59 */
function fmtDateTime(value, withSecond) {
  const d = toDate(value);
  if (!d) return "-";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)} ` +
    `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}` +
    (withSecond ? `:${pad(d.getSeconds(), 2)}` : "")
  );
}

/** 10-07 15:59 */
function fmtShort(value) {
  const d = toDate(value);
  if (!d) return "-";
  return `${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)} ${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`;
}

/** 相对时间：刚刚 / 5 分钟前 / 3 小时前 / 2 天前 / 具体日期 */
function fmtRelative(value) {
  const d = toDate(value);
  if (!d) return "-";
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 86400000 * 7) return `${Math.floor(diff / 86400000)} 天前`;
  return fmtDateTime(value);
}

/** 星期几 + 时间，用于日志时间轴 */
function fmtWeekday(value) {
  const d = toDate(value);
  if (!d) return "-";
  return `${WEEK[d.getDay()]} ${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`;
}

/** yyyy-MM-ddTHH:mm，用于自定义时间范围的 picker/输入回填 */
function toLocalInput(value) {
  const d = toDate(value);
  if (!d) return "";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}` +
    `T${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`
  );
}

const SPORT_LABELS = {
  cycling: "骑行",
  running: "跑步",
  hiking: "徒步",
  swimming: "游泳",
  walking: "步行",
  riding: "骑行",
  ebike: "电助力",
  mountain_biking: "山地骑行",
  road_biking: "公路骑行",
  gravel_cycling: "砾石骑行",
  indoor_cycling: "室内骑行",
  strength_training: "力量训练",
  other: "其他",
};

function sportLabel(type) {
  if (!type) return "运动";
  return SPORT_LABELS[type] || type;
}

module.exports = {
  pad,
  fmtDuration,
  fmtClock,
  fmtNum,
  fmtDistance,
  fmtDateTime,
  fmtShort,
  fmtRelative,
  fmtWeekday,
  toLocalInput,
  toDate,
  sportLabel,
};
