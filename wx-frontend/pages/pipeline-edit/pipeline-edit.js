const api = require("../../api/index");
const auth = require("../../utils/auth");
const theme = require("../../utils/theme");
const fmt = require("../../utils/format");

Page({
  data: {
    id: 0,
    loading: true,
    error: "",
    spec: null,
    pipeline: null,
    config: null,
    flow: { sources: [], filters: [], targets: [] },
    saving: false,
    running: false,
    previewing: false,
    runStatus: null,
    statsRows: [],
    lastRunText: "",
    dirty: false,
  },

  onLoad(query) {
    if (!auth.isLoggedIn()) {
      auth.redirectToLogin();
      return;
    }
    const id = Number(query.id || 0);
    this.setData({ id });
    this.load();
  },

  load() {
    this.setData({ error: "" });
    Promise.all([api.pipelines.syncSpec(), api.pipelines.detail(this.data.id)])
      .then(([spec, p]) => {
        const config = {
          name: p.name || "",
          description: p.description || "",
          is_active: p.is_active,
          auto_run: p.auto_run,
          source_type: p.source_type,
          source_account: p.source_account,
          source_fit_detail: p.source_fit_detail,
          target_accounts: p.target_accounts || [],
          sync_content: p.sync_content || [],
          time_range: p.time_range || { mode: "all", start: null, end: null, days: 30 },
          options: p.options || {},
        };
        this.setData({
          spec,
          pipeline: p,
          config,
          flow: buildFlow(p),
          loading: false,
          lastRunText: p.last_run_at ? fmt.fmtRelative(p.last_run_at) : "尚未运行",
          runStatus: p.last_run_status
            ? Object.assign({ key: p.last_run_status }, theme.RUN_STATUS[p.last_run_status] || {})
            : null,
          dirty: false,
        });
        wx.setNavigationBarTitle({ title: p.name || "任务配置" });
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

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const config = Object.assign({}, this.data.config);
    config[field] = e.detail.value;
    this.setData({ config, dirty: true });
  },

  onSwitch(e) {
    const field = e.currentTarget.dataset.field;
    const config = Object.assign({}, this.data.config);
    config[field] = e.detail.value;
    this.setData({ config, dirty: true });
  },

  onFormChange(e) {
    const config = Object.assign({}, this.data.config, e.detail);
    this.setData({ config, dirty: true });
  },

  save(silent) {
    if (!this.data.config.name.trim()) {
      wx.showToast({ title: "请填写任务名称", icon: "none" });
      return Promise.resolve(null);
    }
    if (!this.data.config.sync_content.length) {
      wx.showToast({ title: "请至少选择一项同步内容", icon: "none" });
      return Promise.resolve(null);
    }
    if (!this.data.config.target_accounts.length) {
      wx.showToast({ title: "请至少选择一个目标账号", icon: "none" });
      return Promise.resolve(null);
    }
    this.setData({ saving: true });
    return api.pipelines
      .update(this.data.id, this.data.config)
      .then((p) => {
        this.setData({
          saving: false,
          dirty: false,
          pipeline: p,
          flow: buildFlow(p),
        });
        if (!silent) wx.showToast({ title: "已保存", icon: "success" });
        return p;
      })
      .catch((err) => {
        this.setData({ saving: false });
        wx.showToast({
          title: err.status === 0 ? "无法连接后端服务" : err.message,
          icon: "none",
        });
        return null;
      });
  },

  onSave() {
    this.save(false);
  },

  /** 试运行预览：不写入任何数据 */
  onPreview() {
    this.setData({ previewing: true });
    api.pipelines
      .preview(this.data.id, this.data.config)
      .then((p) => {
        this.setData({ previewing: false });
        wx.showModal({
          title: "试运行预览",
          content:
            `将同步 ${p.activity_count} 条活动到 ${(p.targets || []).length} 个账号\n` +
            `命中 ${p.stats.fetched} 条 · 超出范围 ${p.stats.out_of_range} 条 · 无 GPS ${p.stats.no_gps} 条` +
            (p.coord_fixed_points ? `\n坐标纠偏：${p.coord_fixed_points} 个轨迹点` : ""),
          showCancel: false,
          confirmText: "知道了",
        });
      })
      .catch((err) => {
        this.setData({ previewing: false });
        wx.showToast({ title: err.message || "预览失败", icon: "none" });
      });
  },

  onRun() {
    if (this.data.running) return;
    const start = () =>
      api.pipelines
        .run(this.data.id)
        .then((res) => {
          if (res.status === "pending" || res.status === "running") {
            return this.pollRun(this.data.id);
          }
          return res;
        })
        .then((res) => {
          this.setData({ running: false });
          wx.hideLoading();
          if (!res) {
            wx.showToast({ title: "已提交执行", icon: "none" });
            this.load();
            return;
          }
          this.applyRunResult(res);
        })
        .catch((err) => {
          this.setData({ running: false });
          wx.hideLoading();
          wx.showToast({
            title: err.status === 0 ? "无法连接后端服务" : err.message,
            icon: "none",
          });
        });

    if (this.data.dirty) {
      wx.showModal({
        title: "有未保存的修改",
        content: "运行前需要先保存配置，是否保存并运行？",
        confirmText: "保存并运行",
        success: (r) => {
          if (!r.confirm) return;
          this.save(true).then((p) => {
            if (!p) return;
            this.setData({ running: true });
            wx.showLoading({ title: "运行中…", mask: true });
            start();
          });
        },
      });
      return;
    }
    this.setData({ running: true });
    wx.showLoading({ title: "运行中…", mask: true });
    start();
  },

  applyRunResult(res) {
    const stats = res.stats || {};
    const st = theme.RUN_STATUS[res.status] || { label: res.status, color: "#94a3b8" };
    const rows = [
      { label: "命中活动", value: `${stats.activities || 0} 条` },
      { label: "成功同步", value: `${stats.uploaded || 0} 条`, tint: "success" },
      { label: "跳过", value: `${stats.skipped || 0} 条` },
      { label: "失败", value: `${stats.failed || 0} 条`, tint: stats.failed ? "danger" : "" },
    ];
    if (stats.coord_fixed_points) {
      rows.push({ label: "坐标纠偏", value: `${stats.coord_fixed_points} 点` });
    }
    // 非活动类内容（资料/体重/睡眠…）的执行结果
    Object.keys(stats.contents || {}).forEach((k) => {
      const c = stats.contents[k];
      rows.push({ label: `内容·${k}`, value: `${c.status}${c.items ? ` (${c.items})` : ""}` });
    });
    this.setData({
      statsRows: rows,
      runStatus: Object.assign({ key: res.status }, st),
    });
    wx.showToast({ title: `执行${st.label}`, icon: st.key === "success" ? "success" : "none" });
    this.load();
  },

  pollRun(id) {
    return new Promise((resolve) => {
      let tries = 0;
      const tick = () => {
        tries += 1;
        api.pipelines
          .runStatus(id)
          .then((s) => {
            if (s.done || tries > 30) {
              resolve({ status: s.status || "pending", stats: s.stats || {} });
              return;
            }
            setTimeout(tick, 1200);
          })
          .catch(() => resolve(null));
      };
      setTimeout(tick, 900);
    });
  },

  onDelete() {
    wx.showModal({
      title: "删除同步任务",
      content: `确定删除「${this.data.config.name}」？该操作不可撤销。`,
      confirmText: "删除",
      confirmColor: "#ef4444",
      success: (r) => {
        if (!r.confirm) return;
        api.pipelines
          .remove(this.data.id)
          .then(() => {
            wx.showToast({ title: "已删除", icon: "success" });
            setTimeout(() => wx.navigateBack(), 500);
          })
          .catch((err) => wx.showToast({ title: err.message || "删除失败", icon: "none" }));
      },
    });
  },
});

/** 把后端重建出来的节点图整理成移动端可读的纵向流程 */
function buildFlow(p) {
  const nodes = p.nodes || [];
  const accName = (n) =>
    (n.account_detail && (n.account_detail.display_name || n.account_detail.platform_user_id)) ||
    "未绑定账号";
  const sources = nodes
    .filter((n) => n.node_type === "source")
    .map((n) => ({ id: n.id, primary: p.source_label || n.config.source_type, secondary: accName(n) }));
  const filters = nodes
    .filter((n) => n.node_type === "filter")
    .map((n) => {
      const c = n.config || {};
      return {
        id: n.id,
        primary: c.filter_type === "by_date_range" ? "时间范围过滤" : c.filter_type || "过滤器",
        secondary: c.summary || c.label || "按配置筛选",
      };
    });
  const targets = nodes
    .filter((n) => n.node_type === "target")
    .map((n) => ({
      id: n.id,
      primary: (n.account_detail && n.account_detail.platform && n.account_detail.platform.name) || "目标账号",
      secondary: accName(n),
    }));
  return { sources, filters, targets };
}
