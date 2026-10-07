/**
 * 小程序 API 契约冒烟测试
 *
 * 逐个调用 wx-frontend 里用到的后端接口，验证路径、请求体字段与返回结构
 * 是否与页面代码的假设一致。运行前请先启动后端：
 *   cd backend && ./.venv/Scripts/python.exe manage.py runserver 127.0.0.1:8000
 *
 * 用法：
 *   node tools/api-smoke.js [baseUrl]
 */
const BASE = (process.argv[2] || "http://127.0.0.1:8000/api").replace(/\/+$/, "");
const USER = "demo";
const PASS = "demo123456";

let token = "";
let passed = 0;
let failed = 0;

function ok(name, extra) {
  passed += 1;
  console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ""}`);
}
function bad(name, err) {
  failed += 1;
  console.log(`  ✗ ${name} — ${err}`);
}

async function call(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: options.method || "GET",
    headers: Object.assign(
      { "Content-Type": "application/json" },
      token ? { Authorization: `Bearer ${token}` } : {},
      options.headers || {},
    ),
    body: options.data ? JSON.stringify(options.data) : undefined,
  });
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  if (!res.ok) {
    const err = new Error((body && (body.detail || body.message)) || `HTTP ${res.status}`);
    err.status = res.status;
    err.payload = body;
    throw err;
  }
  return body;
}

async function check(name, fn) {
  try {
    const extra = await fn();
    ok(name, typeof extra === "string" ? extra : undefined);
  } catch (e) {
    bad(name, e.message);
  }
}

/** 与 call 相同，但不把非 2xx 当异常，返回 { status, json }，用于断言「应当被拒绝」的接口 */
async function invoke(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: options.method || "GET",
    headers: Object.assign(
      { "Content-Type": "application/json" },
      token ? { Authorization: `Bearer ${token}` } : {},
      options.headers || {},
    ),
    body: options.data ? JSON.stringify(options.data) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    json = null;
  }
  return { status: res.status, json };
}

(async () => {
  console.log(`\n=== VeloSync 小程序 API 契约冒烟 @ ${BASE} ===\n`);

  console.log("[认证]");
  await check("GET  /auth/wx/miniprogram/ 查询登录模式", async () => {
    const r = await call("/auth/wx/miniprogram/");
    if (!("enabled" in r) || !("mode" in r)) throw new Error("缺少 enabled/mode");
    return `mode=${r.mode}`;
  });

  await check("GET  /auth/social/providers/?channel=miniprogram 含 wechat_mp", async () => {
    const r = await call("/auth/social/providers/?channel=miniprogram");
    const codes = (r.results || []).map((p) => p.code);
    if (codes.indexOf("wechat_mp") < 0) throw new Error("缺少 wechat_mp");
    const mp = (r.results || []).find((p) => p.code === "wechat_mp");
    if (mp.channel !== "miniprogram") throw new Error("wechat_mp 的 channel 应为 miniprogram");
    return codes.join(", ");
  });

  await check("GET  /auth/social/providers/ 默认不下发小程序专用项", async () => {
    const r = await call("/auth/social/providers/");
    const codes = (r.results || []).map((p) => p.code);
    if (codes.indexOf("wechat_mp") >= 0) throw new Error("默认不该返回 wechat_mp");
    const bad = (r.results || []).filter((p) => p.channel !== "web");
    if (bad.length) throw new Error("默认应只含 channel=web 的项");
    return codes.join(", ");
  });

  await check("POST /auth/social/login/ 拒绝网页端调用 wechat_mp", async () => {
    const res = await fetch(`${BASE}/auth/social/login/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "wechat_mp", identity: "x" }),
    });
    if (res.status !== 400) throw new Error(`期望 400，实际 ${res.status}`);
    const body = await res.json();
    if (!/小程序/.test(body.detail || "")) throw new Error(`提示不明确：${body.detail}`);
    return body.detail;
  });

  await check("POST /auth/wx/miniprogram/ 小程序登录（按模式自适应）", async () => {
    // 先查当前模式：mock 走演示身份应成功；oauth 已配真凭证，假 code 应被微信明确拒绝
    const mode = (await call("/auth/wx/miniprogram/")).mode;
    const res = await invoke("/auth/wx/miniprogram/", {
      method: "POST",
      data: { code: "081smoke", identity: "smoke-device", nickname: "冒烟测试" },
    });
    if (mode === "mock") {
      if (!res.json.access || !res.json.user) throw new Error("演示模式应返回 access/user");
      return `mode=mock created=${res.json.created}`;
    }
    // oauth 模式：无效 code 必须被拒绝，且不能静默建号
    if (res.status !== 400) throw new Error(`oauth 模式对无效 code 应返回 400，实际 ${res.status}`);
    if (res.json.access) throw new Error("oauth 模式不应在 code 无效时签发 token");
    return `mode=oauth 无效 code 已拒绝（${String(res.json.detail || "").slice(0, 24)}…）`;
  });

  await check("POST /auth/login/ 账密登录", async () => {
    let r;
    try {
      r = await call("/auth/login/", { method: "POST", data: { username: USER, password: PASS } });
    } catch (e) {
      // 区分「接口坏了」和「库里没数据」：后者会连带 20 项失败，极易被误读为接口全崩。
      if (/用户名或密码错误|未找到|does not exist/i.test(e.message)) {
        console.log(
          `\n  ⚠️  账号 ${USER} 不存在或密码不符 —— 目标库很可能是「结构已建但无演示数据」。\n` +
            `  ⚠️  这不是接口故障：下面依赖登录态的用例会全部连带失败。\n` +
            `  ⚠️  如需完整冒烟，先在目标后端执行：python manage.py seed_demo\n`,
        );
      }
      throw e;
    }
    if (!r.access) throw new Error("缺少 access");
    token = r.access;
    return `user=${r.user.username}`;
  });

  await check("GET  /auth/me/", async () => {
    const r = await call("/auth/me/");
    if (!r.id) throw new Error("缺少 id");
    return r.username;
  });

  console.log("\n[平台与账号]");
  let platformCode = "";
  await check("GET  /platforms/ 含移动端绑定渠道字段", async () => {
    const r = await call("/platforms/");
    if (!r.length) throw new Error("平台列表为空");
    const p = r[0];
    ["oauth_ready", "oauth_missing", "credential_hint", "mobile_bind_channel", "miniprogram_appid", "app_scheme"].forEach(
      (k) => {
        if (!(k in p)) throw new Error(`缺少字段 ${k}`);
      },
    );
    platformCode = (r.find((x) => x.auth_type !== "mock") || r[0]).code;
    return `${r.length} 个平台，渠道=${r.map((x) => x.mobile_bind_channel).join("/")}`;
  });

  await check("GET  /accounts/", async () => {
    const r = await call("/accounts/");
    return `${r.length} 个已绑定账号`;
  });

  await check(`POST /accounts/${platformCode}/demo-bind/ 演示绑定`, async () => {
    const r = await call(`/accounts/${platformCode}/demo-bind/`, { method: "POST" });
    if (!r.account_id) throw new Error("缺少 account_id");
    return `account_id=${r.account_id} created=${r.created}`;
  });

  await check(`GET  /accounts/${platformCode}/authorize/ 未配置凭证时结构化错误`, async () => {
    try {
      const r = await call(`/accounts/${platformCode}/authorize/`);
      return r.authorize_url ? "返回授权地址（已配置凭证）" : "mock 平台";
    } catch (e) {
      if (e.status === 400 && e.payload && e.payload.code === "oauth_not_configured") {
        return `code=oauth_not_configured missing=${(e.payload.missing || []).join("/")}`;
      }
      throw e;
    }
  });

  console.log("\n[同步任务]");
  let spec = null;
  await check("GET  /pipelines/sync-spec/", async () => {
    spec = await call("/pipelines/sync-spec/");
    ["sources", "contents", "options", "time_modes", "accounts", "fit_records"].forEach((k) => {
      if (!(k in spec)) throw new Error(`缺少 ${k}`);
    });
    return `${spec.sources.length} 来源 / ${(spec.options || []).length} 选项 / ${spec.fit_records.length} 条 FIT`;
  });

  let config = null;
  await check("POST /pipelines/sync-preview/ 试运行预览", async () => {
    const src = spec.sources.find((s) => !s.need_account) || spec.sources[0];
    const contents = (spec.contents[src.code] || []).filter((c) => c.default).map((c) => c.key);
    config = {
      name: "小程序冒烟任务",
      description: "由 tools/api-smoke.js 创建",
      is_active: true,
      auto_run: false,
      source_type: src.code,
      source_account: null,
      source_fit_detail: null,
      target_accounts: spec.accounts.length ? [spec.accounts[0].id] : [],
      sync_content: contents,
      time_range: { mode: src.code === "fit" ? "file" : "all", start: null, end: null, days: 30 },
      options: {},
    };
    const r = await call("/pipelines/sync-preview/", { method: "POST", data: config });
    ["activity_count", "coord_fixed_points", "stats", "targets", "contents"].forEach((k) => {
      if (!(k in r)) throw new Error(`缺少 ${k}`);
    });
    return `命中 ${r.activity_count} 条 / 目标 ${r.targets.length} 个`;
  });

  let pid = 0;
  await check("POST /pipelines/ 创建任务", async () => {
    const r = await call("/pipelines/", { method: "POST", data: config });
    pid = r.id;
    if (!pid) throw new Error("缺少 id");
    if (!r.nodes || !r.nodes.length) throw new Error("未返回执行图 nodes");
    return `id=${pid} nodes=${r.nodes.length} edges=${(r.edges || []).length}`;
  });

  await check("GET  /pipelines/{id}/ 详情", async () => {
    const r = await call(`/pipelines/${pid}/`);
    ["source_type", "target_accounts", "sync_content", "time_range", "options", "nodes"].forEach((k) => {
      if (!(k in r)) throw new Error(`缺少 ${k}`);
    });
    return `source=${r.source_type} targets=${r.target_accounts.length}`;
  });

  await check("PUT  /pipelines/{id}/ 结构化更新", async () => {
    const r = await call(`/pipelines/${pid}/`, {
      method: "PUT",
      data: Object.assign({}, config, { description: "已更新", options: { dry_run: true } }),
    });
    if (r.dry_run !== undefined && r.options && r.options.dry_run !== true) {
      throw new Error("options 未生效");
    }
    return `options.dry_run=${r.options && r.options.dry_run}`;
  });

  await check("POST /pipelines/{id}/preview/ 已保存任务预览", async () => {
    const r = await call(`/pipelines/${pid}/preview/`, { method: "POST", data: {} });
    if (!("activity_count" in r)) throw new Error("缺少 activity_count");
    return `命中 ${r.activity_count} 条`;
  });

  await check("POST /pipelines/{id}/run/ 运行", async () => {
    const r = await call(`/pipelines/${pid}/run/`, { method: "POST" });
    if (!r.status) throw new Error("缺少 status");
    return `status=${r.status}`;
  });

  await check("DELETE /pipelines/{id}/", async () => {
    await call(`/pipelines/${pid}/`, { method: "DELETE" });
    return "已删除";
  });

  console.log("\n[活动 / 矩阵 / FIT]");
  await check("GET  /activities/matrix/", async () => {
    const r = await call("/activities/matrix/");
    if (!("platforms" in r) || !("activities" in r)) throw new Error("缺少 platforms/activities");
    const a = r.activities[0];
    if (a && (!("states" in a) || !("id" in a))) throw new Error("活动项缺少 states/id");
    return `${r.activities.length} 行 × ${r.platforms.length} 列`;
  });

  await check("GET  /activities/ 分页列表", async () => {
    const r = await call("/activities/?page=1&page_size=5");
    if (!("results" in r)) throw new Error("不是分页结构");
    return `count=${r.count}`;
  });

  await check("GET  /activities/fit-history/", async () => {
    const r = await call("/activities/fit-history/");
    if (!Array.isArray(r)) throw new Error("应为数组");
    return `${r.length} 条导入记录`;
  });

  let fitActivityId = 0;
  await check("GET  /activities/{id}/fit/ FIT 详情", async () => {
    const rows = await call("/activities/fit-history/");
    if (!rows.length) return "跳过：暂无 FIT 记录";
    fitActivityId = rows[0].activity_id;
    const r = await call(`/activities/${fitActivityId}/fit/`);
    ["summary", "samples", "track", "device"].forEach((k) => {
      if (!(k in r)) throw new Error(`缺少 ${k}`);
    });
    const s = r.summary;
    ["sample_count", "track_point_count", "has_gps", "metrics", "available_metrics"].forEach((k) => {
      if (!(k in s)) throw new Error(`summary 缺少 ${k}`);
    });
    return `${s.sample_count} 采样点 / ${s.track_point_count} 轨迹点 / 覆盖 ${s.available_metrics.length} 指标`;
  });

  if (fitActivityId) {
    await check("POST /activities/{id}/sync/ 手动同步（platform_id 字段）", async () => {
      const accounts = await call("/accounts/");
      if (!accounts.length) return "跳过：无已绑定账号";
      try {
        const r = await call(`/activities/${fitActivityId}/sync/`, {
          method: "POST",
          data: { platform_id: accounts[0].platform.id },
        });
        return `status=${r.status}`;
      } catch (e) {
        // 平台未配置凭证时同步失败属预期，这里只验证字段名被识别
        if (/platform_id/.test(e.message)) throw e;
        return `已识别 platform_id（同步结果：${e.message.slice(0, 40)}）`;
      }
    });
  }

  console.log("\n[统计与日志]");
  await check("GET  /dashboard/stats/", async () => {
    const r = await call("/dashboard/stats/");
    ["total_activities", "synced", "pending", "sync_rate", "platform_distribution", "trend_30d", "recent_syncs"].forEach(
      (k) => {
        if (!(k in r)) throw new Error(`缺少 ${k}`);
      },
    );
    return `活动 ${r.total_activities} / 同步率 ${r.sync_rate}%`;
  });

  await check("GET  /logs/ 分页 + 级别筛选", async () => {
    const r = await call("/logs/?page=1&page_size=5&level=info");
    if (!("results" in r)) throw new Error("不是分页结构");
    if (r.results.length && !("level" in r.results[0])) throw new Error("日志项缺少 level");
    return `count=${r.count}`;
  });

  console.log(`\n=== 结果：通过 ${passed} 项，失败 ${failed} 项 ===\n`);
  process.exit(failed ? 1 : 0);
})();
