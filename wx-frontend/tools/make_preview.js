#!/usr/bin/env node
/**
 * VeloSync 速同 · 小程序静态预览生成器
 * ---------------------------------------------------------------------------
 * 为什么需要它：微信小程序必须跑在微信自己的运行时里，浏览器无法直接打开。
 * 但「看界面」这件事不需要真运行时 —— 只要拿到「页面数据 + WXML + WXSS」就能还原。
 *
 * 本脚本做三件事：
 *   1. 用一份最小 `wx` 垫片在 Node 里**真实执行**各页面的 onLoad / onShow，
 *      对接真实后端（默认 127.0.0.1:8000），抓到页面最终 data；
 *   2. 用**真实 WXML** 模板 + 该 data 渲染成 HTML（支持 wx:for / wx:if / {{}}）；
 *   3. 套上**真实 WXSS**（rpx→px，页面样式按 [data-page] 作用域隔离）。
 *
 * 产物：preview/index.html —— 单文件，浏览器或 VS Code 的 Simple Browser 直接打开。
 * 局限：静态快照，不可交互；canvas 图表与 map 轨迹由脚本按真实数据补绘。
 *
 *   node tools/make_preview.js
 *   VELOSYNC_API=http://192.168.1.5:8000/api node tools/make_preview.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "preview");
const API = (process.env.VELOSYNC_API || "http://127.0.0.1:8000/api").replace(/\/+$/, "");
const DEMO = { username: "demo", password: "demo123456" };
const RPX = 0.5; // 750rpx = 375px（iPhone 6 逻辑宽度）

// ---------------------------------------------------------------- 工具函数
const read = (p) => fs.readFileSync(p, "utf8");
const readJSON = (p) => JSON.parse(read(p));
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** 包内素材内联成 data URI，让 preview/index.html 真正单文件自包含 */
const assetCache = new Map();
function assetURI(rel) {
  const src = String(rel || "").trim();
  if (!src || /^(https?:|data:)/.test(src)) return src;
  const file = path.join(ROOT, src.replace(/^[./]+/, ""));
  if (assetCache.has(file)) return assetCache.get(file);
  let uri = src;
  try {
    const buf = fs.readFileSync(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === "svg" ? "image/svg+xml" : /^jpe?g$/.test(ext) ? "image/jpeg" : "image/png";
    uri = `data:${mime};base64,${buf.toString("base64")}`;
  } catch (e) {
    /* 找不到就保留原始路径 */
  }
  assetCache.set(file, uri);
  return uri;
}

function applyPatch(target, patch) {
  for (const key of Object.keys(patch)) {
    const parts = key.split(".").flatMap((seg) => {
      const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(seg);
      const out = [];
      if (m && m[1]) out.push(m[1]);
      if (m && m[2]) for (const idx of m[2].match(/\d+/g) || []) out.push(Number(idx));
      return out;
    });
    if (!parts.length) continue;
    let cur = target;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur == null) return;
      cur = cur[parts[i]];
    }
    if (cur != null) cur[parts[parts.length - 1]] = patch[key];
  }
}

// ---------------------------------------------------------------- wx 垫片
let pending = new Set();
const track = (p) => {
  pending.add(p);
  const done = () => pending.delete(p);
  p.then(done, done);
  return p;
};

function installWx(session, user) {
  const storage = {
    velosync_access: session.access,
    velosync_refresh: session.refresh,
    velosync_user: JSON.stringify(user),
  };
  const noop = () => {};
  const queryStub = {
    in() { return this; },
    select() { return this; },
    selectAll() { return this; },
    fields() { return this; },
    boundingClientRect() { return this; },
    scrollOffset() { return this; },
    exec(cb) { cb && cb([]); },
  };

  global.wx = {
    request({ url, method = "GET", data, header, success, fail }) {
      return track(
        (async () => {
          try {
            const init = { method, headers: Object.assign({}, header) };
            if (method !== "GET" && data !== undefined) {
              init.body = typeof data === "string" ? data : JSON.stringify(data);
            }
            const res = await fetch(url, init);
            const text = await res.text();
            let body;
            try { body = JSON.parse(text); } catch (e) { body = text; }
            success && success({ statusCode: res.status, data: body, header: {} });
          } catch (err) {
            fail && fail({ errMsg: String((err && err.message) || err) });
          }
        })(),
      );
    },
    uploadFile() { throw new Error("静态预览不支持上传"); },
    downloadFile() { throw new Error("静态预览不支持下载"); },
    getStorageSync: (k) => (k in storage ? storage[k] : ""),
    setStorageSync: (k, v) => { storage[k] = v; },
    removeStorageSync: (k) => { delete storage[k]; },
    getSystemInfoSync: () => ({ windowWidth: 375, pixelRatio: 2, platform: "preview" }),
    getWindowInfo: () => ({ windowWidth: 375, pixelRatio: 2 }),
    nextTick: (cb) => setImmediate(cb),
    createSelectorQuery: () => queryStub,
    createIntersectionObserver: () => ({ relativeTo: () => ({ observe: noop, disconnect: noop }), relativeToViewport: () => ({ observe: noop, disconnect: noop }) }),
    createAnimation: () => ({ step: () => ({ step: () => ({ export: () => ({}) }), export: () => ({}) }), export: () => ({}) }),
    showToast: noop, hideToast: noop, showLoading: noop, hideLoading: noop,
    showModal: noop, showActionSheet: noop, stopPullDownRefresh: noop,
    startPullDownRefresh: noop, setNavigationBarTitle: noop,
    navigateTo: noop, redirectTo: noop, switchTab: noop, reLaunch: noop, navigateBack: noop,
    navigateToMiniProgram: (o) => o && o.fail && o.fail({ errMsg: "preview" }),
    setClipboardData: (o) => o && o.success && o.success({}),
    getLocation: (o) => o && o.fail && o.fail({ errMsg: "preview" }),
    chooseMessageFile: noop, chooseImage: noop, previewImage: noop,
    stopLocationUpdate: noop, startLocationUpdate: noop, onLocationChange: noop,
  };

  global.getCurrentPages = () => [];
  global.getApp = () => ({ globalData: { user, baseUrl: API } });
}

async function drain() {
  for (let i = 0; i < 80; i++) {
    if (!pending.size) {
      await new Promise((r) => setTimeout(r, 5));
      if (!pending.size) return;
    }
    await Promise.all(Array.from(pending));
  }
}

// ---------------------------------------------------------------- 执行页面 / 组件
function capture(define, file) {
  const resolved = require.resolve(file);
  delete require.cache[resolved];
  let captured = null;
  const prev = global[define];
  global[define] = (opts) => { captured = opts; };
  try { require(file); } finally { global[define] = prev; }
  return captured;
}

function makeInstance(opts, extraData) {
  const inst = Object.assign({}, opts, opts.methods || {});
  inst.data = Object.assign({}, opts.data || {}, extraData || {});
  inst.setData = function (patch, cb) {
    applyPatch(this.data, patch || {});
    if (cb) cb();
  };
  inst.createSelectorQuery = () => {
    const q = {
      in() { return q; }, select() { return q; }, selectAll() { return q; },
      fields() { return q; }, boundingClientRect() { return q; },
      exec(cb) { cb && cb([]); },
    };
    return q;
  };
  inst.selectComponent = () => null;
  inst.triggerEvent = () => {};
  return inst;
}

async function runPage(name, query) {
  const file = path.join(ROOT, "pages", name, `${name}.js`);
  const opts = capture("Page", file);
  if (!opts) throw new Error(`${name}.js 未调用 Page()`);
  const inst = makeInstance(opts);
  const safe = async (fn, arg) => {
    try { if (typeof fn === "function") await fn.call(inst, arg); } catch (e) { /* 预览容错 */ }
  };
  await safe(inst.onLoad, query || {});
  await safe(inst.onShow);
  await drain();
  await safe(inst.onReady);
  await safe(inst.onShow);
  await drain();
  return inst;
}

async function runComponent(name, props) {
  const file = path.join(ROOT, "components", name, "index.js");
  if (!fs.existsSync(file)) return null;
  const opts = capture("Component", file);
  if (!opts) return null;
  const inst = makeInstance(opts, {});
  for (const key of Object.keys(opts.properties || {})) {
    const def = opts.properties[key] || {};
    inst.data[key] = props[key] !== undefined ? props[key] : def.value;
  }
  for (const key of Object.keys(opts.observers || {})) {
    const names = key.split(",").map((s) => s.trim());
    if (names.some((n) => n in props)) {
      try { opts.observers[key].call(inst, ...names.map((n) => inst.data[n])); } catch (e) { /* 容错 */ }
    }
  }
  try { if (typeof opts.attached === "function") opts.attached.call(inst); } catch (e) { /* 容错 */ }
  try { if (typeof opts.ready === "function") opts.ready.call(inst); } catch (e) { /* 容错 */ }
  await drain();
  return inst;
}

// ---------------------------------------------------------------- WXML 解析
const VOID_TAGS = new Set(["image", "input", "canvas", "map", "icon", "progress", "slot", "import", "include", "wxs", "br"]);

function findTagEnd(src, lt) {
  let quote = null;
  for (let i = lt + 1; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ">") return i;
  }
  return src.length;
}

function parseAttrs(s) {
  const out = {};
  const re = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
  let m;
  while ((m = re.exec(s))) {
    out[m[1]] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : "");
  }
  return out;
}

function parseWXML(src) {
  const root = { children: [] };
  const stack = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      stack[stack.length - 1].children.push({ type: "text", value: src.slice(i) });
      break;
    }
    if (lt > i) stack[stack.length - 1].children.push({ type: "text", value: src.slice(i, lt) });
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    const gt = findTagEnd(src, lt);
    const inner = src.slice(lt + 1, gt);
    i = gt + 1;
    if (inner.startsWith("/")) { if (stack.length > 1) stack.pop(); continue; }
    const selfClose = inner.trimEnd().endsWith("/");
    const body = selfClose ? inner.trimEnd().slice(0, -1) : inner;
    const m = /^([\w:-]+)/.exec(body.trim());
    if (!m) continue;
    const tag = m[1];
    const node = { type: "element", tag, attrs: parseAttrs(body.slice(body.indexOf(m[1]) + m[1].length)), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose && !VOID_TAGS.has(tag)) stack.push(node);
  }
  return root.children;
}

// ---------------------------------------------------------------- 表达式求值
const stripMustache = (s) => {
  const t = String(s).trim();
  const m = /^\{\{([\s\S]*)\}\}$/.exec(t);
  return m ? m[1].trim() : t;
};

function evalRaw(expr, ctx) {
  try {
    // eslint-disable-next-line no-new-func
    return new Function("__c", `with (__c) { return (${expr}); }`)(ctx);
  } catch (e) {
    return undefined;
  }
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return !!v;
}

function interp(str, ctx) {
  return String(str).replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => {
    const v = evalRaw(e.trim(), ctx);
    if (v === undefined || v === null) return "";
    if (typeof v === "object") return "";
    return String(v);
  });
}

// ---------------------------------------------------------------- WXML → HTML
const TAG_MAP = {
  view: "div", text: "span", image: "img", "scroll-view": "div",
  button: "button", input: "input", textarea: "textarea", navigator: "a",
  canvas: "canvas", map: "div", progress: "div", icon: "span",
  "rich-text": "div", form: "div", label: "label", picker: "div",
  switch: "span", checkbox: "span", radio: "span", slider: "span",
  "cover-view": "div", "cover-image": "img", slot: "div",
};

function renderAttrs(node, ctx, tag) {
  const a = node.attrs;
  const out = [];
  const cls = a.class ? interp(a.class, ctx).trim() : "";
  if (cls) out.push(`class="${esc(cls)}"`);
  let style = a.style ? interp(a.style, ctx) : "";
  if (tag === "scroll-view") {
    if ("scroll-x" in a) style += ";overflow-x:auto;overflow-y:hidden";
    if ("scroll-y" in a) style += ";overflow-y:auto;overflow-x:hidden";
    style += ";-webkit-overflow-scrolling:touch";
  }
  // 内联样式里的 rpx 也要折算，否则预览尺寸会离谱
  if (style) style = style.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => `${+(Number(n) * RPX).toFixed(2)}px`);
  if (style) out.push(`style="${esc(style.replace(/^;+/, ""))}"`);
  if (a.id) out.push(`id="${esc(interp(a.id, ctx))}"`);
  if (tag === "image") {
    const src = interp(a.src || "", ctx).trim();
    if (src) out.push(`src="${esc(assetURI(src))}"`);
    out.push('alt=""');
  }
  if (tag === "input" || tag === "textarea") {
    out.push("readonly");
    out.push(`value="${esc(interp(a.value || "", ctx))}"`);
    if (a.placeholder) out.push(`placeholder="${esc(interp(a.placeholder, ctx))}"`);
    if (a.type === "number" || a.type === "digit") out.push('data-numeric="1"');
  }
  return out.length ? " " + out.join(" ") : "";
}

function renderElement(node, ctx, registry) {
  const tag = node.tag;

  // 自定义组件：递归展开它自己的 WXML
  const comp = registry[tag];
  if (comp) {
    const props = {};
    for (const k of Object.keys(node.attrs)) {
      const m = /^\{\{([\s\S]*)\}\}$/.exec(String(node.attrs[k]).trim());
      props[k] = m ? evalRaw(m[1].trim(), ctx) : node.attrs[k];
    }
    return renderComponent(comp, props, ctx);
  }

  if (tag === "block" || tag === "template" || tag === "import" || tag === "include") {
    return renderChildren(node.children, ctx, registry);
  }

  const htmlTag = TAG_MAP[tag] || "div";
  const attrs = renderAttrs(node, ctx, tag);

  if (htmlTag === "img" || htmlTag === "input" || htmlTag === "textarea") {
    return htmlTag === "img" ? `<img${attrs}>` : `<${htmlTag}${attrs}></${htmlTag}>`;
  }
  if (tag === "canvas" && node.attrs.id) {
    return `<canvas id="${esc(interp(node.attrs.id, ctx))}" class="mp-canvas${node.attrs.class ? " " + esc(interp(node.attrs.class, ctx)) : ""}"></canvas>`;
  }
  if (tag === "map") {
    const inner = `<div class="mp-map-body"><canvas class="mp-map-canvas"></canvas></div>`;
    return `<div class="mp-map"${attrs}>${inner}</div>`;
  }
  return `<${htmlTag}${attrs}>${renderChildren(node.children, ctx, registry)}</${htmlTag}>`;
}

function renderChildren(children, ctx, registry) {
  let html = "";
  let branch = null; // null=未进入 if 链；true=已命中
  for (const node of children) {
    if (node.type === "text") {
      if (!node.value.trim()) continue; // 纯空白不打断 if/else 链
      html += esc(interp(node.value, ctx));
      branch = null;
      continue;
    }
    const a = node.attrs;
    if ("wx:if" in a) {
      branch = truthy(evalRaw(stripMustache(a["wx:if"]), ctx));
      if (!branch) continue;
    } else if ("wx:elif" in a) {
      if (branch) continue;
      branch = truthy(evalRaw(stripMustache(a["wx:elif"]), ctx));
      if (!branch) continue;
    } else if ("wx:else" in a) {
      if (branch) continue;
      branch = true;
    } else {
      branch = null;
    }
    html += renderNode(node, ctx, registry);
  }
  return html;
}

function renderNode(node, ctx, registry) {
  const a = node.attrs;
  if ("wx:for" in a) {
    const list = evalRaw(stripMustache(a["wx:for"]), ctx);
    const arr = Array.isArray(list) ? list : [];
    const itemName = a["wx:for-item"] || "item";
    const indexName = a["wx:for-index"] || "index";
    return arr
      .map((item, index) => {
        const child = Object.create(ctx);
        child[itemName] = item;
        child[indexName] = index;
        return renderElement(node, child, registry);
      })
      .join("");
  }
  return renderElement(node, ctx, registry);
}

function renderComponent(comp, props, parentCtx) {
  const ctx = Object.assign(Object.create(parentCtx), comp.data || {}, props);
  for (const k of Object.keys(props)) ctx[k] = props[k];
  const nodes = parseWXML(comp.wxml);
  const inner = renderChildren(nodes, ctx, comp.registry || {});
  return `<div class="mp-comp" data-comp="${comp.name}">${inner}</div>`;
}

// ---------------------------------------------------------------- WXSS → CSS
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function splitRules(css) {
  const rules = [];
  let i = 0;
  while (i < css.length) {
    const brace = css.indexOf("{", i);
    if (brace < 0) break;
    const sel = css.slice(i, brace).trim();
    let depth = 1;
    let j = brace + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    rules.push({ sel, body: css.slice(brace + 1, j - 1) });
    i = j;
  }
  return rules;
}

function convertWXSS(src) {
  return stripComments(src)
    .replace(/@import\s+[^;]+;/g, "")
    // rpx 按 750rpx = 375px 折算
    .replace(/(-?\d*\.?\d+)rpx/g, (_, n) => `${+(Number(n) * RPX).toFixed(3)}px`)
    // 视口单位与 fixed 会把元素甩出设备框，收进 .mp-body 内
    .replace(/100vh/g, "100%")
    .replace(/position\s*:\s*fixed/g, "position: absolute");
}

/** scope：页面作用域选择器；global 为 true 时只有 page 选择器被替换（用于 app.wxss） */
function scopeCSS(css, scope, onlyPage) {
  return splitRules(css)
    .map(({ sel, body }) => {
      if (!sel || sel.startsWith("@")) return `${sel}{${body}}`;
      const mapped = sel
        .split(",")
        .map((s) => {
          s = s.trim();
          if (!s) return "";
          if (s === "page") return scope;
          if (s.startsWith("page ")) return `${scope} ${s.slice(5)}`;
          if (s.startsWith("page.")) return `${scope}${s.slice(4)}`;
          if (onlyPage) return s;
          return `${scope} ${s}`;
        })
        .filter(Boolean)
        .join(", ");
      return mapped ? `${mapped}{${body}}` : "";
    })
    .join("\n");
}

// ---------------------------------------------------------------- 组装页面
function loadComponentRegistry(pageDir, pageJson) {
  const registry = {};
  for (const [tag, spec] of Object.entries(pageJson.usingComponents || {})) {
    const base = path.resolve(pageDir, spec);
    const dir = path.dirname(base);
    const stem = path.basename(base);
    const js = path.join(dir, `${stem}.js`);
    const wxml = path.join(dir, `${stem}.wxml`);
    const wxss = path.join(dir, `${stem}.wxss`);
    if (!fs.existsSync(wxml)) continue;
    let data = {};
    if (fs.existsSync(js)) {
      const opts = capture("Component", js);
      if (opts) data = opts.data || {};
    }
    registry[tag] = {
      name: path.basename(dir), // components/sync-form/index → sync-form
      wxml: read(wxml),
      wxss: fs.existsSync(wxss) ? convertWXSS(read(wxss)) : "",
      data,
      registry: {},
    };
  }
  return registry;
}

/** 从页面 WXML 里找出所有自定义组件用法，并按绑定表达式求值出 props */
function collectComponentUsages(nodes, ctx, registry, out, depth) {
  if (depth > 8) return;
  for (const node of nodes) {
    if (!node || node.type !== "element") continue;
    if (registry[node.tag]) {
      const props = {};
      for (const k of Object.keys(node.attrs)) {
        props[k] = evalRaw(stripMustache(node.attrs[k]), ctx);
      }
      out.push({ tag: node.tag, props });
      continue; // 组件内部由它的 WXML 负责渲染
    }
    collectComponentUsages(node.children, ctx, registry, out, depth + 1);
  }
}

/** 用真实 props 跑一遍组件逻辑（observers / attached），让派生数据（sourceLabels 等）落到 data 上 */
async function hydrateComponents(registry, pageData, wxmlNodes) {
  const usages = [];
  collectComponentUsages(wxmlNodes, pageData, registry, usages, 0);
  const firstByTag = {};
  for (const u of usages) if (!(u.tag in firstByTag)) firstByTag[u.tag] = u.props;

  for (const tag of Object.keys(registry)) {
    const comp = registry[tag];
    const props = firstByTag[tag] || {};
    const inst = await runComponent(comp.name, props);
    if (inst) comp.data = inst.data;
  }
}

function deviceShell(page, bodyHTML, meta) {
  const isTab = meta.tabIndex >= 0;
  const chrome = `
    <div class="mp-nav"><span class="mp-nav__back">‹</span><span class="mp-nav__title">${esc(meta.title)}</span></div>
    <div class="mp-body">${bodyHTML}</div>
    ${
      isTab
        ? `<div class="mp-tabbar">${meta.tabbar
            .map(
              (t, i) =>
                `<div class="mp-tabbar__item${i === meta.tabIndex ? " is-on" : ""}"><img src="${assetURI(t.icon)}" alt=""><span>${esc(t.text)}</span></div>`,
            )
            .join("")}</div>`
        : ""
    }`;
  return `<section class="device" data-page="${page}"${meta.tabIndex >= 0 ? "" : ' data-nontab="1"'}>
    <div class="device__bar"><span>9:41</span><span class="device__bar-r">5G ▮▮▮</span></div>
    ${chrome}
  </section>`;
}

// ---------------------------------------------------------------- 主流程
async function main() {
  console.log(`\n=== VeloSync 小程序静态预览生成器 @ ${API} ===\n`);

  const session = await (async () => {
    const res = await fetch(`${API}/auth/login/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(DEMO),
    });
    if (!res.ok) throw new Error(`登录失败 HTTP ${res.status}：请确认后端已启动且已执行 seed_demo`);
    return res.json();
  })();
  const user = session.user;
  console.log(`✓ 已登录 ${user.username}（${user.nickname || user.email || "无昵称"}）`);

  installWx(session, user);
  process.chdir(ROOT);
  const auth = require(path.join(ROOT, "utils", "auth.js"));
  auth.load();

  // 取真实 ID 作为页面入参
  const probe = async (p) => {
    try { return await (await fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${session.access}` } })).json(); }
    catch (e) { return null; }
  };
  const pipelines = await probe("/pipelines/"); // 裸数组，非分页
  const fitHistory = await probe("/activities/fit-history/"); // 裸数组（兼容 { results }）
  const asList = (d) => (Array.isArray(d) ? d : (d && d.results) || []);
  const pipelineList = asList(pipelines);
  const fitList = asList(fitHistory);
  const pipelineId = pipelineList.length ? pipelineList[0].id : null;
  const activityId = fitList.length ? fitList[0].activity_id : null;
  console.log(`  探针：pipeline#${pipelineId} / activity#${activityId}`);

  const appJson = readJSON(path.join(ROOT, "app.json"));
  const tabbar = appJson.tabBar.list.map((t) => ({ text: t.text, icon: t.selectedIconPath, pagePath: t.pagePath.split("/")[1] }));
  const pages = appJson.pages.map((p) => p.split("/")[1]);

  const cssParts = [scopeCSS(convertWXSS(read(path.join(ROOT, "styles", "common.wxss"))), "[data-page]", true)];
  const compCSS = [];
  const devices = [];
  const pageDataByName = {};

  for (const name of pages) {
    process.stdout.write(`  · ${name.padEnd(15)}`);
    const pageDir = path.join(ROOT, "pages", name);
    const pageJson = readJSON(path.join(pageDir, `${name}.json`));
    const registry = loadComponentRegistry(pageDir, pageJson);
    const query = {};
    if (name === "pipeline-edit" && pipelineId) query.id = String(pipelineId);
    if (name === "fit-detail" && activityId) query.id = String(activityId);

    let inst;
    try {
      inst = await runPage(name, query);
    } catch (err) {
      console.log(`跳过（${err.message}）`);
      continue;
    }

    const wxml = read(path.join(pageDir, `${name}.wxml`));
    const nodes = parseWXML(wxml);
    await hydrateComponents(registry, inst.data, nodes);
    const html = renderChildren(nodes, inst.data, registry);

    const wxssFile = path.join(pageDir, `${name}.wxss`);
    if (fs.existsSync(wxssFile)) {
      cssParts.push(scopeCSS(convertWXSS(read(wxssFile)), `[data-page="${name}"]`, false));
    }
    for (const comp of Object.values(registry)) {
      if (comp.wxss) compCSS.push(scopeCSS(comp.wxss, `[data-comp="${comp.name}"]`, false));
    }

    const title = pageJson.navigationBarTitleText || appJson.window.navigationBarTitleText;
    const tabIndex = tabbar.findIndex((t) => t.pagePath === name);
    devices.push(deviceShell(name, html, { title, tabIndex, tabbar }));
    pageDataByName[name] = inst.data;
    console.log(`✓ ${html.length} 字节`);
  }

  const shellCSS = `
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:#eef2f7;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1e293b}
    .topbar{position:sticky;top:0;z-index:10;background:#fff;border-bottom:1px solid #e2e8f0;padding:14px 20px}
    .topbar h1{margin:0 0 4px;font-size:15px;font-weight:600}
    .topbar p{margin:0 0 10px;font-size:12px;color:#64748b;line-height:1.6}
    .tabs{display:flex;flex-wrap:wrap;gap:6px}
    .tab{border:1px solid #e2e8f0;background:#f8fafc;color:#475569;border-radius:999px;padding:5px 12px;font-size:12px;cursor:pointer;font-family:inherit}
    .tab:hover{border-color:#a5b4fc;color:#4f46e5}
    .tab[aria-selected="true"]{background:#4f46e5;border-color:#4f46e5;color:#fff}
    .stage{padding:28px 20px 70px;display:flex;justify-content:center}
    .device{display:none;width:375px;height:760px;background:#f1f5f9;border-radius:30px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.18);flex-direction:column;border:8px solid #0f172a}
    .device[data-active]{display:flex}
    .device__bar{height:26px;flex:none;background:#4f46e5;color:#fff;font-size:11px;display:flex;align-items:center;justify-content:space-between;padding:0 14px}
    .device__bar-r{opacity:.9}
    .mp-nav{height:42px;flex:none;background:#4f46e5;color:#fff;display:flex;align-items:center;justify-content:center;position:relative;font-size:15px;font-weight:500}
    .mp-nav__back{position:absolute;left:12px;font-size:22px;line-height:1;opacity:.85}
    .mp-body{flex:1;overflow-y:auto;overflow-x:hidden;background:#f1f5f9}
    .mp-tabbar{height:52px;flex:none;background:#fff;border-top:1px solid #e2e8f0;display:flex}
    .mp-tabbar__item{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:10px;color:#94a3b8}
    .mp-tabbar__item.is-on{color:#4f46e5}
    .mp-tabbar__item img{width:20px;height:20px;display:block}
    .mp-comp{display:block}
    .mp-map{position:relative;background:#e2e8f0}
    .mp-map-body{position:absolute;inset:0}
    .mp-map-canvas{width:100%;height:100%;display:block}
    canvas.mp-canvas{display:block}
    .device button{font:inherit;border:none;background:none;padding:0;margin:0;text-align:center;color:inherit;cursor:default}
    .device input,.device textarea{font:inherit;border:none;background:transparent;color:inherit;width:100%;padding:0}
    .device img{display:block;max-width:100%}
    .device a{text-decoration:none;color:inherit}
    .device span{display:inline}
  `;

  const overrideCSS = `
    /* 预览专用覆盖：把视口单位与 fixed 收进设备框 */
    .device .page,.device .login{min-height:100% !important}
    .device [style*="position: fixed"]{position:absolute !important}
    .device .bar,.device .footer,.device .actions{position:absolute !important;left:0;right:0;bottom:0}
    .device .mp-body{position:relative}
  `;

  const tabsHTML = pages
    .map((name, i) => {
      const t = readJSON(path.join(ROOT, "pages", name, `${name}.json`)).navigationBarTitleText || name;
      return `<button class="tab" data-target="${name}" aria-selected="${i === 0}">${esc(t)}</button>`;
    })
    .join("");

  // 把工具模块按极简 CJS 包装内联进来，浏览器里就能复用小程序自己的绘图代码
  const inlineModule = (rel, globalName) => {
    const code = read(path.join(ROOT, rel));
    return `<script>(function(){var module={exports:{}};var exports=module.exports;\n${code}\n;window.${globalName}=module.exports;})();</script>`;
  };
  const utilsBundle = [
    inlineModule("utils/theme.js", "THEME"),
    inlineModule("utils/fitMetrics.js", "METRICS"),
    inlineModule("utils/chart.js", "CHART"),
    inlineModule("utils/coords.js", "COORDS"),
  ].join("\n");

  const previewData = JSON.stringify(pageDataByName);
  const drawScript = `
(function () {
  var DATA = ${previewData};
  var ROW_H = 64, OVERLAY_H = 210;

  function setup(scope, selector, height) {
    var cv = scope.querySelector(selector);
    if (!cv) return null;
    var w = cv.clientWidth || 335;
    var h = height || cv.clientHeight || 200;
    var dpr = 2;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = w + "px";
    cv.style.height = h + "px";
    var ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    return { ctx: ctx, w: w, h: h };
  }

  function paintDashboard() {
    var d = DATA.dashboard;
    if (!d) return;
    var scope = document.querySelector('[data-page="dashboard"]');
    if (!scope) return;
    var pie = setup(scope, "#pieChart");
    if (pie) CHART.drawPie(pie.ctx, pie.w, pie.h, d.distribution || [], THEME.PIE_PALETTE);
    var tr = setup(scope, "#trendChart");
    if (tr) CHART.drawTrend(tr.ctx, tr.w, tr.h, d.trend || [], { color: THEME.COLORS.primary, fill: "#eef2ff" });
  }

  function paintFitDetail() {
    var d = DATA["fit-detail"];
    if (!d || !d.detail) return;
    var scope = document.querySelector('[data-page="fit-detail"]');
    if (!scope) return;
    var samples = d.detail.samples || [];
    var dim = d.dim || "time";
    var mode = d.mode || "split";
    var height = mode === "overlay" ? OVERLAY_H : Math.max(1, METRICS.FIT_METRICS.length) * ROW_H;
    var c = setup(scope, "#fitChart", height);
    if (!c) return;
    CHART.clear(c.ctx, c.w, c.h);
    if (mode === "overlay") {
      var list = METRICS.FIT_METRICS.filter(function (m) { return (d.overlayKeys || []).indexOf(m.key) >= 0; })
        .map(function (def) { return { def: def, series: METRICS.extractSeries(samples, def.key, dim) }; });
      CHART.drawOverlayChart(c.ctx, c.w, c.h, list, { dim: dim, emptyText: "所选指标在当前文件中都没有数据" });
    } else {
      var rows = METRICS.FIT_METRICS.map(function (def) {
        var series = METRICS.extractSeries(samples, def.key, dim);
        var range = series.length ? METRICS.seriesRange(series) : null;
        return {
          label: def.label, unit: def.unit, color: def.color, fill: def.fill,
          kind: def.kind, blank: def.blank, series: series,
          avg: series.length && range ? (range.min + range.max) / 2 : null,
          emptyText: "该 FIT 文件未记录此项",
        };
      });
      CHART.drawMetricStack(c.ctx, c.w, c.h, rows, { rowHeight: ROW_H, dim: dim, labelWidth: 40 });
    }
  }

  function paintMap() {
    var d = DATA["fit-detail"];
    var scope = document.querySelector('[data-page="fit-detail"]');
    if (!d || !scope || !d.hasGps) return;
    var cv = scope.querySelector(".mp-map-canvas");
    var lines = d.polyline || [];
    if (!cv || !lines.length) return;
    // 页面里的 polyline 已经是 WGS-84→GCJ-02 纠偏后的点
    var pts = (lines[0].points || []).map(function (p) { return { lat: p.latitude, lng: p.longitude }; });
    if (pts.length < 2) return;
    var lats = pts.map(function (p) { return p.lat; }), lngs = pts.map(function (p) { return p.lng; });
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    var minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
    var w = cv.clientWidth || 335, h = cv.clientHeight || 220, dpr = 2, pad = 20;
    cv.width = w * dpr; cv.height = h * dpr;
    var ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#e8edf3"; ctx.fillRect(0, 0, w, h);
    var spanLat = maxLat - minLat || 1e-6, spanLng = maxLng - minLng || 1e-6;
    var s = Math.min((w - pad * 2) / spanLng, (h - pad * 2) / spanLat);
    var offX = (w - spanLng * s) / 2, offY = (h - spanLat * s) / 2;
    function px(p) { return [offX + (p.lng - minLng) * s, h - offY - (p.lat - minLat) * s]; }
    ctx.strokeStyle = lines[0].color || "#4f46e5";
    ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    pts.forEach(function (p, i) { var q = px(p); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
    ctx.stroke();
    var a = px(pts[0]), b = px(pts[pts.length - 1]);
    ctx.fillStyle = "#10b981"; ctx.beginPath(); ctx.arc(a[0], a[1], 5, 0, 6.3); ctx.fill();
    ctx.fillStyle = "#ef4444"; ctx.beginPath(); ctx.arc(b[0], b[1], 5, 0, 6.3); ctx.fill();
    ctx.fillStyle = "#475569"; ctx.font = "11px system-ui";
    ctx.fillText("轨迹 " + pts.length + " 点 · 已做 GCJ-02 纠偏（静态补齐）", 10, 16);
  }

  try { paintDashboard(); } catch (e) { console.warn("仪表盘图表补绘失败", e); }
  try { paintFitDetail(); } catch (e) { console.warn("FIT 图表补绘失败", e); }
  try { paintMap(); } catch (e) { console.warn("轨迹补绘失败", e); }
})();
`;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VeloSync 速同 · 小程序静态预览</title>
<style>${shellCSS}</style>
<style>/* app.wxss + styles/common.wxss */\n${cssParts[0]}</style>
<style>/* 页面样式（按 data-page 作用域隔离） */\n${cssParts.slice(1).join("\n")}\n${compCSS.join("\n")}</style>
<style>/* 预览覆盖 */\n${overrideCSS}</style>
</head>
<body>
<header class="topbar">
  <h1>VeloSync 速同 · 微信小程序静态预览</h1>
  <p>用小程序自己的 WXML / WXSS 渲染，页面数据来自 <code>${esc(API)}</code> 真实接口（执行了各页面的 onLoad/onShow）。<br>这是静态快照：点击无效，canvas 图表与轨迹由脚本按真实数据补绘。</p>
  <nav class="tabs" id="tabs">${tabsHTML}</nav>
</header>
<div class="stage" id="stage">${devices.join("\n")}</div>
${utilsBundle}
<script>
(function () {
  var tabs = document.getElementById("tabs");
  var devices = Array.prototype.slice.call(document.querySelectorAll(".device"));
  function show(name) {
    devices.forEach(function (d) { d.toggleAttribute("data-active", d.dataset.page === name); });
    Array.prototype.forEach.call(tabs.children, function (b) {
      b.setAttribute("aria-selected", String(b.dataset.target === name));
    });
  }
  tabs.addEventListener("click", function (e) {
    var b = e.target.closest(".tab");
    if (b) show(b.dataset.target);
  });
  show(devices.length ? devices[0].dataset.page : "");
  window.__previewShow = show;
})();
</script>
<script>${drawScript}</script>
</body>
</html>
`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "index.html"), html, "utf8");

  const bytes = Buffer.byteLength(html, "utf8");
  console.log(`\n✓ 已生成 preview/index.html（${(bytes / 1024).toFixed(1)} KB，${devices.length} 个页面）`);
  console.log("  用浏览器打开，或 VS Code 中右键 → Open with Live Preview / Simple Browser\n");
}

main().catch((err) => {
  console.error(`\n✗ 生成失败：${err.message}\n`);
  process.exit(1);
});
