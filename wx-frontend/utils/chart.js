/**
 * Canvas 2D 绘图基元（小程序 type="2d" 画布）
 * 供仪表盘饼图/折线 与 FIT 指标曲线共用。
 */

/** 绑定画布：处理 dpr 缩放，返回 { canvas, ctx, width, height } */
function setupCanvas(component, selector) {
  return new Promise((resolve) => {
    component
      .createSelectorQuery()
      .select(selector)
      .fields({ node: true, size: true })
      .exec((res) => {
        const item = res && res[0];
        if (!item || !item.node) return resolve(null);
        const { node, width, height } = item;
        let dpr = 2;
        try {
          dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
        } catch (e) {
          dpr = 2;
        }
        node.width = Math.round(width * dpr);
        node.height = Math.round(height * dpr);
        const ctx = node.getContext("2d");
        ctx.scale(dpr, dpr);
        resolve({ canvas: node, ctx, width, height });
      });
  });
}

function clear(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
}

function niceRange(min, max) {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.08;
  return [min - pad, max + pad];
}

function ticks(min, max, count) {
  const n = count || 4;
  const out = [];
  for (let i = 0; i <= n; i += 1) out.push(min + ((max - min) * i) / n);
  return out;
}

function fmtTick(v) {
  const a = Math.abs(v);
  if (a >= 10000) return `${(v / 1000).toFixed(0)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

/** 绘制网格 + 坐标轴文字 */
function drawGrid(ctx, box, xTicks, yTicks, opt) {
  const o = opt || {};
  ctx.save();
  ctx.strokeStyle = o.gridColor || "#eef2f7";
  ctx.lineWidth = 1;
  ctx.font = "9px sans-serif";
  ctx.fillStyle = o.tickColor || "#94a3b8";

  // 横向网格 + Y 轴刻度
  yTicks.forEach((v) => {
    const y = o.yScale(v);
    ctx.beginPath();
    ctx.moveTo(box.left, y);
    ctx.lineTo(box.right, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(o.yFormat ? o.yFormat(v) : fmtTick(v), box.left - 5, y);
  });

  // 纵向网格 + X 轴刻度
  xTicks.forEach((v) => {
    const x = o.xScale(v);
    ctx.beginPath();
    ctx.moveTo(x, box.top);
    ctx.lineTo(x, box.bottom);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(o.xFormat ? o.xFormat(v) : fmtTick(v), x, box.bottom + 4);
  });
  ctx.restore();
}

/** 面积 + 折线 */
function drawSeries(ctx, box, series, opt) {
  if (!series || series.length < 1) return;
  const o = opt || {};
  const xScale = o.xScale;
  const yScale = o.yScale;

  if (o.kind === "area" && series.length > 1 && o.fill) {
    ctx.beginPath();
    ctx.moveTo(xScale(series[0][0]), box.bottom);
    series.forEach((p) => ctx.lineTo(xScale(p[0]), yScale(p[1])));
    ctx.lineTo(xScale(series[series.length - 1][0]), box.bottom);
    ctx.closePath();
    ctx.fillStyle = o.fill;
    ctx.fill();
  }

  ctx.beginPath();
  series.forEach((p, i) => {
    const x = xScale(p[0]);
    const y = yScale(p[1]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = o.color || "#4f46e5";
  ctx.lineWidth = o.width || 1.6;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

/** 平均参考虚线 */
function drawAvgLine(ctx, box, avg, yScale, color) {
  if (avg === null || avg === undefined) return;
  const y = yScale(avg);
  if (y < box.top || y > box.bottom) return;
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = color || "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(box.left, y);
  ctx.lineTo(box.right, y);
  ctx.stroke();
  ctx.restore();
}

/**
 * 单指标折线图（分图模式的一行）
 * @param {object} ctx
 * @param {object} box {left,top,right,bottom,width,height}
 * @param {Array} series [[x,y],...]
 * @param {object} cfg {color, fill, kind, yRange, blank, dim, avg}
 */
function drawMetricRow(ctx, box, series, cfg) {
  const c = cfg || {};
  const hasData = series && series.length > 0;
  const yRange = hasData
    ? niceRange(
        Math.min.apply(null, series.map((p) => p[1])),
        Math.max.apply(null, series.map((p) => p[1])),
      )
    : c.blank || [0, 100];

  const xvals = hasData ? series.map((p) => p[0]) : [0, 1];
  const xMin = Math.min.apply(null, xvals);
  const xMax = Math.max.apply(null, xvals) || 1;

  const xScale = (v) =>
    box.left + ((v - xMin) / (xMax - xMin || 1)) * (box.right - box.left);
  const yScale = (v) =>
    box.bottom - ((v - yRange[0]) / (yRange[1] - yRange[0] || 1)) * (box.bottom - box.top);

  const xTicks = ticks(xMin, xMax, 3);
  const yTicks = ticks(yRange[0], yRange[1], 2);

  drawGrid(ctx, box, xTicks, yTicks, {
    xScale,
    yScale,
    yFormat: (v) => fmtTick(v),
    xFormat: (v) =>
      c.dim === "distance" ? `${Number(v).toFixed(1)}` : fmtTimeAxis(v),
  });

  if (hasData) {
    drawSeries(ctx, box, series, {
      xScale,
      yScale,
      color: c.color,
      fill: c.fill,
      kind: c.kind,
      width: 1.8,
    });
    drawAvgLine(ctx, box, c.avg, yScale, c.color);
  } else {
    drawEmptyOverlay(ctx, box, c.emptyText || "该 FIT 文件未记录此项");
  }
}

/** 无数据时的图内提示 */
function drawEmptyOverlay(ctx, box, text) {
  ctx.save();
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
  ctx.strokeStyle = "#e2e8f0";
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1;
  ctx.strokeRect(box.left + 0.5, box.top + 0.5, box.right - box.left - 1, box.bottom - box.top - 1);
  ctx.setLineDash([]);
  ctx.fillStyle = "#cbd5e1";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, (box.left + box.right) / 2, (box.top + box.bottom) / 2);
  ctx.restore();
}

function fmtTimeAxis(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}` : `${m}:${p(sec)}`;
}

/** 饼图（用于平台分布） */
function drawPie(ctx, w, h, items, palette) {
  clear(ctx, w, h);
  const total = items.reduce((s, it) => s + it.value, 0);
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - 8;
  if (!total) {
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("暂无数据", cx, cy);
    return;
  }
  let start = -Math.PI / 2;
  items.forEach((it, i) => {
    const angle = (it.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = palette[i % palette.length];
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
    start += angle;
  });
  // 内圈留白，做环形效果
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.58, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.fillStyle = "#1e293b";
  ctx.font = "bold 15px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(total), cx, cy - 6);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "9px sans-serif";
  ctx.fillText("条活动", cx, cy + 10);
}

/** 简易折线图（用于 30 天趋势） */
function drawTrend(ctx, w, h, points, opt) {
  const o = opt || {};
  clear(ctx, w, h);
  const box = { left: 30, top: 12, right: w - 8, bottom: h - 20 };
  box.width = box.right - box.left;
  box.height = box.bottom - box.top;

  if (!points.length) {
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("暂无数据", w / 2, h / 2);
    return;
  }
  const ys = points.map((p) => p.value);
  const yRange = niceRange(Math.min.apply(null, ys), Math.max.apply(null, ys));
  const xScale = (i) => box.left + (i / Math.max(1, points.length - 1)) * box.width;
  const yScale = (v) => box.bottom - ((v - yRange[0]) / (yRange[1] - yRange[0] || 1)) * box.height;

  const xTicks = [];
  for (let i = 0; i < points.length; i += Math.max(1, Math.ceil(points.length / 4))) xTicks.push(i);
  drawGrid(ctx, box, xTicks, ticks(yRange[0], yRange[1], 2), {
    xScale,
    yScale,
    xFormat: (i) => (points[i] ? points[i].label : ""),
  });

  const series = points.map((p, i) => [i, p.value]);
  drawSeries(ctx, box, series, {
    xScale: (v) => xScale(v),
    yScale,
    color: o.color || "#4f46e5",
    fill: o.fill || "#eef2ff",
    kind: "area",
    width: 2,
  });
}

/**
 * 多指标叠加图
 * 每个指标按自身极值归一化到 0~100% 后画在同一条横轴上，纵轴只表示相对变化。
 *
 * @param {Array} list [{ def: {label, color, fill, kind}, series: [[x,y],...] }]
 * @param {object} opt { dim: "time"|"distance", emptyText }
 */
function drawOverlayChart(ctx, w, h, list, opt) {
  const o = opt || {};
  const dim = o.dim || "time";
  const box = { left: 44, top: 14, right: w - 10, bottom: h - 32 };
  box.width = box.right - box.left;
  box.height = box.bottom - box.top;

  const drawable = (list || []).filter((x) => x.series && x.series.length);
  if (!drawable.length) {
    drawEmptyOverlay(ctx, box, o.emptyText || "所选指标在当前文件中都没有数据");
    return;
  }

  // 共用横轴
  let xMin = Infinity;
  let xMax = -Infinity;
  drawable.forEach((x) =>
    x.series.forEach((p) => {
      if (p[0] < xMin) xMin = p[0];
      if (p[0] > xMax) xMax = p[0];
    }),
  );
  const xScale = (v) => box.left + ((v - xMin) / (xMax - xMin || 1)) * box.width;
  const yScale = (v) => box.bottom - v * box.height;

  drawGrid(ctx, box, ticks(xMin, xMax, 3), [0, 0.25, 0.5, 0.75, 1], {
    xScale,
    yScale,
    yFormat: (v) => `${Math.round(v * 100)}%`,
    xFormat: (v) => (dim === "distance" ? Number(v).toFixed(1) : fmtTimeAxis(v)),
  });

  drawable.forEach(({ def, series }) => {
    let min = series[0][1];
    let max = series[0][1];
    series.forEach((p) => {
      if (p[1] < min) min = p[1];
      if (p[1] > max) max = p[1];
    });
    const span = max - min || 1;
    const norm = series.map((p) => [p[0], (p[1] - min) / span]);
    drawSeries(ctx, box, norm, {
      xScale,
      yScale,
      color: def.color,
      fill: def.fill,
      kind: def.kind === "area" ? "area" : "line",
      width: 1.8,
    });
  });

  // 图内图例
  ctx.save();
  ctx.font = "9px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let lx = box.left + 4;
  let ly = box.bottom + 16;
  drawable.forEach(({ def }) => {
    if (lx > w - 62) {
      lx = box.left + 4;
      ly += 12;
    }
    ctx.fillStyle = def.color;
    ctx.fillRect(lx, ly - 3, 8, 6);
    ctx.fillStyle = "#64748b";
    ctx.fillText(def.label, lx + 11, ly);
    lx += 11 + String(def.label).length * 9 + 10;
  });
  ctx.restore();
}

/**
 * 分图模式：每个指标各占一行（没有数据的指标仍保留空白图位）
 *
 * @param {Array} rows [{ label, unit, color, fill, kind, blank, series, avg, emptyText }]
 * @param {object} opt { rowHeight, dim, labelWidth }
 */
function drawMetricStack(ctx, w, h, rows, opt) {
  const o = opt || {};
  const rowH = o.rowHeight || 64;
  const dim = o.dim || "time";

  (rows || []).forEach((row, i) => {
    const top = i * rowH;
    const has = row.series && row.series.length > 0;

    // 行标题
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = row.color || "#4f46e5";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText(row.label, 0, top + 2);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "9px sans-serif";
    let rangeText = row.unit || "";
    if (has) {
      let min = row.series[0][1];
      let max = row.series[0][1];
      row.series.forEach((p) => {
        if (p[1] < min) min = p[1];
        if (p[1] > max) max = p[1];
      });
      rangeText = `${fmtTick(min)}~${fmtTick(max)} ${row.unit || ""}`;
    }
    ctx.fillText(rangeText, String(row.label).length * 12 + 6, top + 4);
    ctx.restore();

    const box = {
      left: o.labelWidth || 40,
      top: top + 18,
      right: w - 8,
      bottom: top + rowH - 6,
    };
    drawMetricRow(ctx, box, row.series, {
      color: row.color,
      fill: row.fill,
      kind: row.kind,
      blank: row.blank,
      dim,
      avg: row.avg,
      emptyText: row.emptyText || "该 FIT 文件未记录此项",
    });

    // 行分隔
    ctx.save();
    ctx.strokeStyle = "#f1f5f9";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, top + rowH - 0.5);
    ctx.lineTo(w, top + rowH - 0.5);
    ctx.stroke();
    ctx.restore();
  });
}

module.exports = {
  setupCanvas,
  clear,
  niceRange,
  ticks,
  fmtTick,
  fmtTimeAxis,
  drawGrid,
  drawSeries,
  drawAvgLine,
  drawMetricRow,
  drawMetricStack,
  drawEmptyOverlay,
  drawPie,
  drawTrend,
  drawOverlayChart,
};
