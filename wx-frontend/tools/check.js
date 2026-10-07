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

// ---------------------------------------------------------------- 3. 页面四件套
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

// ---------------------------------------------------------------- 4. 图标资产
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

// ---------------------------------------------------------------- 5. 事件绑定
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
