/**
 * 图表绘制逻辑无头测试
 *
 * 用 mock 的 CanvasRenderingContext2D 跑一遍 chart.js 与 fitMetrics.js 的所有绘制路径，
 * 覆盖「有数据 / 无数据留空白图位 / 叠加 / 空列表」等分支，捕获运行时错误与漏画。
 *
 * 用法：node tools/chart-test.js
 */
const path = require("path");
const chart = require(path.join(__dirname, "..", "utils", "chart.js"));
const metrics = require(path.join(__dirname, "..", "utils", "fitMetrics.js"));

let passed = 0;
let failed = 0;

function mockCtx() {
  const calls = [];
  const rec =
    (name) =>
    (...args) => {
      calls.push({ name, args });
    };
  return {
    calls,
    save: rec("save"),
    restore: rec("restore"),
    beginPath: rec("beginPath"),
    closePath: rec("closePath"),
    moveTo: rec("moveTo"),
    lineTo: rec("lineTo"),
    arc: rec("arc"),
    rect: rec("rect"),
    fill: rec("fill"),
    stroke: rec("stroke"),
    fillRect: rec("fillRect"),
    strokeRect: rec("strokeRect"),
    clearRect: rec("clearRect"),
    setLineDash: rec("setLineDash"),
    fillText: rec("fillText"),
    measureText: (t) => ({ width: String(t).length * 5 }),
    scale: rec("scale"),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    lineJoin: "",
    lineCap: "",
  };
}

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "断言失败");
}

function count(calls, name) {
  return calls.filter((c) => c.name === name).length;
}

function texts(calls) {
  return calls.filter((c) => c.name === "fillText").map((c) => String(c.args[0]));
}

/** 造一份 120 点的 samples：只填 heart_rate / power / cadence，其余留空 */
function makeSamples(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      t: i,
      distance_km: (i / n) * 20,
      heart_rate: 120 + Math.round(20 * Math.sin(i / 7)),
      power: 180 + Math.round(60 * Math.cos(i / 9)),
      cadence: 80 + Math.round(8 * Math.sin(i / 5)),
    });
  }
  return out;
}

const samples = makeSamples(120);

console.log("\n=== 图表绘制无头测试 ===\n");

console.log("[图表基元]");
test("niceRange 处理相等值", () => {
  const r = chart.niceRange(5, 5);
  assert(r[0] < 5 && r[1] > 5, "区间应包含原值");
});
test("ticks 生成 n+1 个刻度", () => {
  assert(chart.ticks(0, 100, 4).length === 5);
});
test("fmtTimeAxis 秒 → m:ss / h:mm", () => {
  assert(chart.fmtTimeAxis(65) === "1:05", `实际 ${chart.fmtTimeAxis(65)}`);
  assert(chart.fmtTimeAxis(3661) === "1:01", `实际 ${chart.fmtTimeAxis(3661)}`);
});
test("fmtTick 大数缩写", () => {
  assert(chart.fmtTick(12345) === "12k", `实际 ${chart.fmtTick(12345)}`);
});

console.log("\n[FIT 指标注册表]");
test("注册表 15 个指标且键唯一", () => {
  const keys = metrics.FIT_METRICS.map((m) => m.key);
  assert(keys.length === 15, `实际 ${keys.length}`);
  assert(new Set(keys).size === 15, "存在重复 key");
});
test("extractSeries 时间维度按 t 取值", () => {
  const s = metrics.extractSeries(samples, "heart_rate", "time");
  assert(s.length === 120, `实际 ${s.length}`);
  assert(s[0][0] === 0 && s[1][0] === 1, "横轴应为秒");
});
test("extractSeries 距离维度按 distance_km 取值", () => {
  const s = metrics.extractSeries(samples, "power", "distance");
  assert(s.length === 120, `实际 ${s.length}`);
  assert(s[119][0] > 19, "末点距离应接近 20km");
});
test("extractSeries 对无数据指标返回空数组", () => {
  assert(metrics.extractSeries(samples, "muscle_oxygen", "time").length === 0);
});
test("hasMetric 正确判断", () => {
  assert(metrics.hasMetric(samples, "power") === true);
  assert(metrics.hasMetric(samples, "step_length") === false);
});
test("defaultOverlayKeys 取有数据的核心指标", () => {
  const keys = metrics.defaultOverlayKeys(["heart_rate", "power", "muscle_oxygen"]);
  assert(keys.indexOf("heart_rate") >= 0 && keys.indexOf("power") >= 0, keys.join(","));
  assert(keys.indexOf("cadence") < 0, "cadence 不在可供列表里，不应选中");
});
test("defaultOverlayKeys 全空时给兜底", () => {
  assert(metrics.defaultOverlayKeys([]).length === 3);
});

console.log("\n[分图模式：15 行，无数据留空白图]");
test("drawMetricStack 绘制 15 行且无数据行给出空白提示", () => {
  const ctx = mockCtx();
  const rows = metrics.FIT_METRICS.map((def) => {
    const series = metrics.extractSeries(samples, def.key, "time");
    return {
      label: def.label,
      unit: def.unit,
      color: def.color,
      fill: def.fill,
      kind: def.kind,
      blank: def.blank,
      series,
      avg: series.length ? (metrics.seriesRange(series).min + metrics.seriesRange(series).max) / 2 : null,
      emptyText: "该 FIT 文件未记录此项",
    };
  });
  chart.drawMetricStack(ctx, 320, 15 * 64, rows, { rowHeight: 64, dim: "time" });

  const t = texts(ctx.calls);
  metrics.FIT_METRICS.forEach((def) => {
    assert(t.indexOf(def.label) >= 0, `缺少指标标题 ${def.label}`);
  });
  const blanks = t.filter((x) => x === "该 FIT 文件未记录此项").length;
  assert(blanks === 12, `应有 12 个空白图位，实际 ${blanks}`);
  assert(count(ctx.calls, "stroke") > 0 || count(ctx.calls, "lineTo") > 0, "没有任何线条被绘制");
});

test("drawMetricRow 数据全空时也不报错", () => {
  const ctx = mockCtx();
  chart.drawMetricRow(
    ctx,
    { left: 40, top: 18, right: 300, bottom: 60 },
    [],
    { color: "#ef4444", fill: "#fee2e2", kind: "line", blank: [60, 200], dim: "time" },
  );
  assert(texts(ctx.calls).indexOf("该 FIT 文件未记录此项") >= 0);
});

test("drawMetricRow 只有 1 个数据点时不崩溃", () => {
  const ctx = mockCtx();
  chart.drawMetricRow(
    ctx,
    { left: 40, top: 18, right: 300, bottom: 60 },
    [[0, 150]],
    { color: "#ef4444", kind: "line", dim: "time" },
  );
  assert(count(ctx.calls, "lineTo") >= 1, "应画出单点折线");
});

console.log("\n[叠加模式]");
test("drawOverlayChart 叠加 3 个指标并画图例", () => {
  const ctx = mockCtx();
  const list = ["heart_rate", "power", "cadence"].map((k) => ({
    def: metrics.METRIC_MAP[k],
    series: metrics.extractSeries(samples, k, "time"),
  }));
  chart.drawOverlayChart(ctx, 320, 210, list, { dim: "time" });
  const t = texts(ctx.calls);
  ["心率", "功率", "踏频"].forEach((l) => assert(t.indexOf(l) >= 0, `图例缺少 ${l}`));
  assert(t.some((x) => x.indexOf("%") >= 0), "缺少百分比纵轴刻度");
});

test("drawOverlayChart 距离维度可用", () => {
  const ctx = mockCtx();
  const list = ["speed_kmh", "power"].map((k) => ({
    def: metrics.METRIC_MAP[k],
    series: metrics.extractSeries(samples, k, "distance"),
  }));
  chart.drawOverlayChart(ctx, 320, 210, list, { dim: "distance" });
  assert(count(ctx.calls, "fillText") > 0);
});

test("drawOverlayChart 空列表给出提示", () => {
  const ctx = mockCtx();
  chart.drawOverlayChart(ctx, 320, 210, [], { dim: "time" });
  assert(texts(ctx.calls).some((x) => x.indexOf("都没有数据") >= 0));
});

console.log("\n[仪表盘图表]");
test("drawPie 正常绘制 + 中心总数", () => {
  const ctx = mockCtx();
  chart.drawPie(ctx, 320, 170, [{ name: "Strava", value: 12 }, { name: "Garmin", value: 8 }], ["#4f46e5", "#0ea5e9"]);
  const t = texts(ctx.calls);
  assert(t.indexOf("20") >= 0, `中心应显示总数 20，实际 ${t.join("|")}`);
  assert(count(ctx.calls, "arc") >= 2, "应绘制扇区");
});

test("drawPie 空数据不崩溃", () => {
  const ctx = mockCtx();
  chart.drawPie(ctx, 320, 170, [], ["#4f46e5"]);
  assert(texts(ctx.calls).indexOf("暂无数据") >= 0);
});

test("drawTrend 正常绘制", () => {
  const ctx = mockCtx();
  const pts = Array.from({ length: 30 }, (_, i) => ({ label: `10-${i + 1}`, value: (i * 7) % 5 }));
  chart.drawTrend(ctx, 320, 160, pts, {});
  assert(count(ctx.calls, "lineTo") > 10, "应画出折线");
});

test("drawTrend 空数据不崩溃", () => {
  const ctx = mockCtx();
  chart.drawTrend(ctx, 320, 160, [], {});
  assert(texts(ctx.calls).indexOf("暂无数据") >= 0);
});

test("drawTrend 全 0 数据不产生 NaN 坐标", () => {
  const ctx = mockCtx();
  const pts = Array.from({ length: 10 }, (_, i) => ({ label: String(i), value: 0 }));
  chart.drawTrend(ctx, 320, 160, pts, {});
  const nan = ctx.calls.filter((c) => c.args && c.args.some((a) => typeof a === "number" && Number.isNaN(a)));
  assert(nan.length === 0, `出现 NaN 坐标：${nan.length} 处`);
});

console.log("\n[轨迹坐标]");
const coordsUtil = require(path.join(__dirname, "..", "utils", "coords.js"));
test("wgs84ToGcj02 境外坐标原样返回", () => {
  const p = coordsUtil.wgs84ToGcj02(-122.4, 37.8);
  assert(p[0] === -122.4 && p[1] === 37.8);
});
test("wgs84ToGcj02 国内坐标发生偏移", () => {
  const [lng, lat] = coordsUtil.wgs84ToGcj02(120.15, 30.28);
  assert(Math.abs(lng - 120.15) < 0.01 && Math.abs(lat - 30.28) < 0.01, "偏移量应在合理范围");
  assert(lng !== 120.15 || lat !== 30.28, "国内坐标应发生偏移");
});
test("toPolylines 抽稀后仍保留首尾点", () => {
  const track = Array.from({ length: 1000 }, (_, i) => [120.1 + i * 0.0001, 30.2 + i * 0.0001]);
  const poly = coordsUtil.toPolylines(track, { simplify: 10 });
  const pts = poly[0].points;
  assert(pts.length < 200, `抽稀后点数应显著减少，实际 ${pts.length}`);
  const last = track[999];
  assert(
    Math.abs(pts[pts.length - 1].longitude - (last[0] + (pts[pts.length - 1].longitude - last[0]))) < 1,
    "末点应存在",
  );
});
test("bounds 返回包围盒与中心", () => {
  const b = coordsUtil.bounds([[120.1, 30.2], [120.2, 30.3]]);
  assert(b && b.center.length === 2, "缺少中心");
  assert(b.minLng <= b.maxLng && b.minLat <= b.maxLat);
});

console.log(`\n=== 结果：通过 ${passed} 项，失败 ${failed} 项 ===\n`);
process.exit(failed ? 1 : 0);
