const api = require("../../api/index");
const auth = require("../../utils/auth");
const theme = require("../../utils/theme");
const fmt = require("../../utils/format");

const PAGE_SIZE = 20;

Page({
  data: {
    loading: true,
    loadingMore: false,
    error: "",
    list: [],
    count: 0,
    page: 1,
    hasMore: true,
    levels: [
      { value: "", label: "全部" },
      { value: "info", label: "信息" },
      { value: "success", label: "成功" },
      { value: "warning", label: "警告" },
      { value: "error", label: "错误" },
    ],
    level: "",
    pipelines: [],
    pipelineLabels: ["全部任务"],
    pipelineIds: [""],
    pipelineIndex: 0,
  },

  onLoad() {
    if (!auth.isLoggedIn()) return;
    api.pipelines
      .list()
      .then((list) => {
        const ids = [""];
        const labels = ["全部任务"];
        (list || []).forEach((p) => {
          ids.push(String(p.id));
          labels.push(p.name);
        });
        this.setData({ pipelineIds: ids, pipelineLabels: labels, pipelines: list || [] });
      })
      .catch(() => {});
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      auth.redirectToLogin();
      return;
    }
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) this.loadMore();
  },

  refresh() {
    this.setData({ error: "", page: 1, hasMore: true, list: [] });
    return this.fetch(1).then(() => {});
  },

  loadMore() {
    if (!this.data.hasMore) return;
    this.setData({ loadingMore: true });
    this.fetch(this.data.page + 1).then(() => this.setData({ loadingMore: false }));
  },

  fetch(page) {
    const params = { page, page_size: PAGE_SIZE };
    if (this.data.level) params.level = this.data.level;
    const pid = this.data.pipelineIds[this.data.pipelineIndex];
    if (pid) params.pipeline = pid;

    return api.logs
      .list(params)
      .then((res) => {
        const rows = (res.results || []).map((r) => {
          const meta = theme.LOG_LEVELS[r.level] || theme.LOG_LEVELS.info;
          return {
            id: r.id,
            level: r.level,
            levelLabel: meta.label,
            color: meta.color,
            bg: meta.bg,
            message: r.message,
            detailText: r.detail && Object.keys(r.detail).length ? JSON.stringify(r.detail) : "",
            pipeline: r.pipeline_name || "手动操作",
            activity: r.activity_name || "",
            time: fmt.fmtDateTime(r.created_at, true),
          };
        });
        const merged = page === 1 ? rows : this.data.list.concat(rows);
        this.setData({
          list: merged,
          count: res.count || merged.length,
          page,
          hasMore: !!res.next,
          loading: false,
        });
      })
      .catch((err) => {
        this.setData({
          loading: false,
          error:
            err.status === 0
              ? "无法连接后端服务，请先启动 Django（127.0.0.1:8000）"
              : err.message,
        });
      });
  },

  onLevelTap(e) {
    const level = e.currentTarget.dataset.value;
    if (level === this.data.level) return;
    this.setData({ level, loading: true });
    this.refresh();
  },

  onPipelineChange(e) {
    this.setData({ pipelineIndex: Number(e.detail.value), loading: true });
    this.refresh();
  },

  onItemTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const item = this.data.list[idx];
    const lines = [item.message];
    if (item.pipeline) lines.push(`任务：${item.pipeline}`);
    if (item.activity) lines.push(`活动：${item.activity}`);
    lines.push(`时间：${item.time}`);
    if (item.detailText) lines.push(`详情：${item.detailText}`);
    wx.showModal({
      title: `${item.levelLabel}日志`,
      content: lines.join("\n"),
      showCancel: false,
      confirmText: "关闭",
    });
  },
});
