#!/usr/bin/env node
/**
 * 小程序端静态自检（无需后端、无需微信开发者工具）
 * ---------------------------------------------------------------------------
 * 检查项：
 *   1. 全部 .js 语法（node --check）
 *   2. 全部 .json 合法性
 *   3. 12 个页面「四件套」齐备（js / json / wxml / wxss）
 *   4. tabBar 10 个图标 + 品牌 4 个图标存在
 *   5. 每个页面 WXML 里 bind / catch 绑定的方法在页面 JS 中有定义
 *   6. app.json 声明的页面与 pages/ 目录一一对应
 *
 *   node tools/check.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const results = [];
let failed = 0;

function group(name) {
  results.push({ type: "group", name });
}
function ok(name, detail) {
  results.push({ type: "ok", name, detail: detail || "" });
}
function bad(name, detail) {
  results.push({ type: "bad", name, detail: detail || "" });
  failed++;
}

const walk = (dir, test) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "preview") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, test));
    else if (test(full)) out.push(full);
  }
  return out;
};

// ---------------------------------------------------------------- 1. JS 语法
group("JS 语法");
const jsFiles = walk(ROOT, (f) => f.endsWith(".js"));
let jsBad = 0;
for (const f of jsFiles) {
  const src = fs.readFileSync(f, "utf8").replace(/^#![^\n]*\n/, ""); // 去掉 shebang
  try {
    new vm.Script(src, { filename: f });
  } catch (err) {
    jsBad++;
    bad(path.relative(ROOT, f).replace(/\\/g, "/"), err.message);
  }
}
if (!jsBad) ok(`${jsFiles.length} 个文件`, "全部通过");

// ---------------------------------------------------------------- 2. JSON
group("JSON 合法性");
const jsonFiles = walk(ROOT, (f) => f.endsWith(".json"));
let jsonBad = 0;
for (const f of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (err) {
    jsonBad++;
    bad(path.relative(ROOT, f).replace(/\\/g, "/"), err.message);
  }
}
if (!jsonBad) ok(`${jsonFiles.length} 个文件`, "全部合法");

// ---------------------------------------------------------------- 3. WXSS 可编译性
// WXSS 不是标准 CSS：通配选择器 `*` 会在编译期直接报错（error at token `*`），
// 而它恰恰很容易被当成「选中所有子元素」的通用写法写进去。本地校验一下，
// 免得等到开发者工具编译才发现。
group("WXSS 可编译性");
const wxssFiles = walk(ROOT, (f) => f.endsWith(".wxss"));
// 前面是行首/空白/组合符，后面跟空白、逗号、组合符或选择器起始字符
const WILDCARD = /(^|[\s,>+~])\*(?=[\s,{.:>+~#[]|$)/;
let wxssBad = 0;
for (const f of wxssFiles) {
  const raw = fs.readFileSync(f, "utf8");
  // 注释替换成等长空白（保留换行），这样报出来的行号与原文件一致
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "{") continue;
    // 选择器文本取到最后一个 `;` 之后：前面可能是上一个块的声明，不该参与匹配
    const seg = src.slice(start, i);
    const selector = seg.slice(seg.lastIndexOf(";") + 1);
    if (WILDCARD.test(selector)) {
      const line = src.slice(0, i).split("\n").length;
      const shown = selector.trim().split("\n").pop().trim().replace(/\s+/g, " ");
      wxssBad++;
      bad(`${path.relative(ROOT, f).replace(/\\/g, "/")}:${line}`, `WXSS 不支持通配选择器 \`*\`（${shown}）`);
    }
    start = i + 1;
  }
}
if (!wxssBad) ok(`${wxssFiles.length} 个文件`, "选择器语法可用");

// ---------------------------------------------------------------- 4. 画布尺寸
// canvas 是「替换元素」：width / height 为 auto 时取内部固有尺寸 300×150。
// 所以「position:absolute + left/right/top/bottom 四边定位」并不能把画布撑开 ——
// 四边定位会被忽略，画布缩成左上角一个小方块（横屏全屏页踩过：宽高都得显式给）。
// 这里要求每个 canvas 合并 class 规则与内联 style 之后，width 和 height 都有。
group("画布尺寸");
const classDecls = new Map(); // ".foo" -> 声明文本（多文件同名类合并）
for (const f of wxssFiles) {
  const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    for (const sel of m[1].split(",")) {
      const s = sel.trim();
      if (!/^\.[\w-]+$/.test(s)) continue; // 只看单类选择器，够覆盖画布样式
      classDecls.set(s, `${classDecls.get(s) || ""};${m[2]}`);
    }
  }
}
const hasProp = (css, prop) => new RegExp(`(^|[;{\\s])${prop}\\s*:`).test(css);
const attr = (tag, name) => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : "";
};
let canvasBad = 0;
let canvasCount = 0;
for (const f of walk(ROOT, (f) => f.endsWith(".wxml"))) {
  const src = fs.readFileSync(f, "utf8");
  const re = /<canvas\b([^>]*)>/g;
  let m;
  while ((m = re.exec(src))) {
    canvasCount++;
    // class 里可能有 {{}} 表达式，去掉后再按空白切分
    const classes = attr(m[1], "class")
      .replace(/\{\{[^}]*\}\}/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((c) => `.${c}`);
    let css = classes.map((c) => classDecls.get(c) || "").join(";");
    css += `;${attr(m[1], "style")}`;
    const miss = ["width", "height"].filter((p) => !hasProp(css, p));
    if (miss.length) {
      const line = src.slice(0, m.index).split("\n").length;
      canvasBad++;
      bad(
        `${path.relative(ROOT, f).replace(/\\/g, "/")}:${line}`,
        `canvas 缺少 ${miss.join(" / ")}，会退回默认 300×150（四边定位不算数）`,
      );
    }
  }
}
if (!canvasBad) ok(`${canvasCount} 处 canvas`, "宽高均已显式声明");

// ---------------------------------------------------------------- 5. 页面四件套
group("页面四件套");
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8"));
const declared = appJson.pages.map((p) => p.split("/")[1]);
const onDisk = fs
  .readdirSync(path.join(ROOT, "pages"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

let quartetBad = 0;
for (const name of declared) {
  for (const ext of ["js", "json", "wxml", "wxss"]) {
    const f = path.join(ROOT, "pages", name, `${name}.${ext}`);
    if (!fs.existsSync(f)) {
      quartetBad++;
      bad(`pages/${name}/${name}.${ext}`, "缺失");
    }
  }
}
if (!quartetBad) ok(`${declared.length} 个页面`, "js/json/wxml/wxss 齐备");

const notDeclared = onDisk.filter((n) => declared.indexOf(n) < 0);
const missingDir = declared.filter((n) => onDisk.indexOf(n) < 0);
if (notDeclared.length || missingDir.length) {
  bad("app.json 与 pages/ 对应关系", `多余目录 ${notDeclared.join(",") || "无"}；缺目录 ${missingDir.join(",") || "无"}`);
} else {
  ok("app.json 与 pages/", "一一对应");
}

// ---------------------------------------------------------------- 6. 图标资产
group("图标资产");
const iconFiles = [];
for (const t of appJson.tabBar.list) {
  iconFiles.push(t.iconPath, t.selectedIconPath);
}
let iconBad = 0;
for (const rel of iconFiles) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    iconBad++;
    bad(rel, "缺失");
  }
}
if (!iconBad) ok(`tabBar ${iconFiles.length} 个`, "齐备");

const brandFiles = [
  "assets/brand/logo-512.png",
  "assets/brand/logo-144.png",
  "assets/brand/logo-120.png", // iGPSPORT 开放平台申请要求 120x120
  "assets/brand/logo-96.png",
];
let brandBad = 0;
for (const rel of brandFiles) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    brandBad++;
    bad(rel, "缺失");
  }
}
if (!brandBad) ok(`品牌 ${brandFiles.length} 个`, "齐备");

// ---------------------------------------------------------------- 7. 事件绑定
group("WXML 事件绑定");
let handlerBad = 0;
let handlerCount = 0;
const pagesToScan = [...declared];
for (const name of pagesToScan) {
  const wxmlPath = path.join(ROOT, "pages", name, `${name}.wxml`);
  const jsPath = path.join(ROOT, "pages", name, `${name}.js`);
  if (!fs.existsSync(wxmlPath) || !fs.existsSync(jsPath)) continue;
  const wxml = fs.readFileSync(wxmlPath, "utf8");
  const js = fs.readFileSync(jsPath, "utf8");
  const names = new Set();
  const re = /\b(?:bind|catch)(?::)?[a-zA-Z]+\s*=\s*"([^"{}]+)"/g;
  let m;
  while ((m = re.exec(wxml))) names.add(m[1].trim());
  for (const fn of names) {
    handlerCount++;
    if (!new RegExp(`\\b${fn}\\s*\\(`).test(js) && !new RegExp(`["']?${fn}["']?\\s*:`).test(js)) {
      handlerBad++;
      bad(`pages/${name} → ${fn}`, "WXML 绑定但 JS 未定义");
    }
  }
}
// 自定义组件同样扫一遍
const compDir = path.join(ROOT, "components");
if (fs.existsSync(compDir)) {
  for (const c of fs.readdirSync(compDir, { withFileTypes: true })) {
    if (!c.isDirectory()) continue;
    const wxmlPath = path.join(compDir, c.name, "index.wxml");
    const jsPath = path.join(compDir, c.name, "index.js");
    if (!fs.existsSync(wxmlPath) || !fs.existsSync(jsPath)) continue;
    const wxml = fs.readFileSync(wxmlPath, "utf8");
    const js = fs.readFileSync(jsPath, "utf8");
    const names = new Set();
    const re = /\b(?:bind|catch)(?::)?[a-zA-Z]+\s*=\s*"([^"{}]+)"/g;
    let m;
    while ((m = re.exec(wxml))) names.add(m[1].trim());
    for (const fn of names) {
      handlerCount++;
      if (!new RegExp(`\\b${fn}\\s*\\(`).test(js) && !new RegExp(`["']?${fn}["']?\\s*:`).test(js)) {
        handlerBad++;
        bad(`components/${c.name} → ${fn}`, "WXML 绑定但 JS 未定义");
      }
    }
  }
}
if (!handlerBad) ok(`${handlerCount} 个绑定`, "全部有对应实现");

// ---------------------------------------------------------------- 输出
console.log("\n=== VeloSync 小程序静态自检 ===\n");
for (const r of results) {
  if (r.type === "group") console.log(`\n[${r.name}]`);
  else if (r.type === "ok") console.log(`  ✓ ${r.name}${r.detail ? " — " + r.detail : ""}`);
  else console.log(`  ✗ ${r.name} — ${r.detail}`);
}
console.log(
  `\n=== 结果：${failed === 0 ? "全部通过" : `${failed} 项失败`} ===\n`,
);
process.exit(failed === 0 ? 0 : 1);
