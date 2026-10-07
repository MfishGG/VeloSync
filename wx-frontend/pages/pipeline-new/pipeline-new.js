const api = require("../../api/index");

const STEPS = [
  { key: "source", label: "数据来源" },
  { key: "content", label: "同步内容" },
  { key: "target", label: "目标账号" },
  { key: "time", label: "时间与选项" },
];

/** 把规格目录里的选项默认值展开成初始 options */
function defaultOptions(spec) {
  const out = {};
  (spec.options || []).forEach((o) => {
    out[o.key] = o.default;
  });
  return out;
}

function defaultContents(spec, code) {
  return ((spec.contents || {})[code] || []).filter((c) => c.default).map((c) => c.key);
}

Page({
  data: {
    steps: STEPS.map((s, i) => Object.assign({}, s, { index: i })),
    step: 0,
    spec: null,
    config: null,
    loading: true,
    error: "",
    submitting: false,
    previewing: false,
    preview: null,
    stepProblems: [],
  },

  onLoad() {
    api.pipelines
      .syncSpec()
      .then((spec) => {
        const first = (spec.sources || [])[0] || { code: "fit" };
        const config = {
          name: "",
          description: "",
          is_active: true,
          auto_run: true,
          source_type: first.code,
          source_account: null,
          source_fit_detail: null,
          target_accounts: [],
          sync_content: defaultContents(spec, first.code),
          time_range: {
            mode: first.code === "fit" ? "file" : "all",
            start: null,
            end: null,
            days: 30,
          },
          options: defaultOptions(spec),
        };
        this.setData({ spec, config, loading: false });
        this.validate();
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
    this.setData({ config });
    this.validate();
  },

  onSwitch(e) {
    const field = e.currentTarget.dataset.field;
    const config = Object.assign({}, this.data.config);
    config[field] = e.detail.value;
    this.setData({ config });
  },

  /** 表单组件抛出的增量补丁 */
  onFormChange(e) {
    const config = Object.assign({}, this.data.config, e.detail);
    // 来源变更是对象/数组整体替换，直接合并即可
    this.setData({ config });
    this.validate();
  },

  /** 只校验「当前这一步」——避免后面的步骤把前面的按钮锁死 */
  validate() {
    const { config, spec, step } = this.data;
    if (!config || !spec) return [];
    const key = STEPS[step].key;
    const list = [];
    if (key === "source") {
      if (!config.name.trim()) list.push("请填写任务名称");
      const src = (spec.sources || []).find((s) => s.code === config.source_type);
      if (src && src.need_account && !config.source_account) {
        list.push(`请选择 ${src.label} 的来源账号`);
      }
      if (config.source_type === "fit" && !(spec.fit_records || []).length) {
        list.push("还没有导入任何 FIT 文件，请先到「FIT」页上传");
      }
    } else if (key === "content") {
      if (!config.sync_content.length) list.push("请至少选择一项同步内容");
    } else if (key === "target") {
      if (!config.target_accounts.length) list.push("请至少选择一个目标账号");
    } else if (key === "time") {
      const tr = config.time_range;
      if (tr.mode === "custom" && !tr.start && !tr.end) {
        list.push("请填写自定义时间范围的起止时间");
      }
    }
    this.setData({ stepProblems: list });
    return list;
  },

  prev() {
    if (this.data.step === 0) return;
    const step = this.data.step - 1;
    this.setData({ step });
    this.validate();
  },

  next() {
    if (this.validate().length) {
      wx.showToast({ title: this.data.stepProblems[0], icon: "none" });
      return;
    }
    if (this.data.step >= STEPS.length - 1) return;
    const step = this.data.step + 1;
    this.setData({ step });
    this.validate();
  },

  goStep(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (index <= this.data.step) {
      this.setData({ step: index });
      this.validate();
    }
  },

  /** 试运行预览：不写入任何数据 */
  runPreview() {
    this.setData({ previewing: true });
    api.pipelines
      .syncPreview(this.data.config)
      .then((p) => {
        this.setData({ preview: p, previewing: false });
        const contents = (p.contents || []).map((c) => c.label).join("、") || "无";
        wx.showModal({
          title: "试运行预览",
          content:
            `将同步 ${p.activity_count} 条活动到 ${(p.targets || []).length} 个账号\n` +
            `同步内容：${contents}\n` +
            `时间窗口：${fmtWindow(p.window)}\n` +
            `命中 ${p.stats.fetched} 条 · 超出范围 ${p.stats.out_of_range} 条 · 无 GPS ${p.stats.no_gps} 条` +
            (p.coord_fixed_points ? `\n坐标纠偏：${p.coord_fixed_points} 个轨迹点` : ""),
          showCancel: false,
          confirmText: "知道了",
        });
      })
      .catch((err) => {
        this.setData({ previewing: false });
        wx.showToast({
          title: err.status === 0 ? "无法连接后端服务" : err.message,
          icon: "none",
        });
      });
  },

  submit() {
    const problems = this.validate();
    const all = this.fullProblems();
    if (all.length) {
      wx.showToast({ title: all[0], icon: "none" });
      if (!problems.length) {
        // 当前步没问题，但其它步缺东西 → 跳到那一步
        this.jumpToProblem();
      }
      return;
    }
    this.setData({ submitting: true });
    api.pipelines
      .create(this.data.config)
      .then((p) => {
        this.setData({ submitting: false });
        wx.showToast({ title: "任务已创建", icon: "success" });
        setTimeout(() => {
          wx.redirectTo({ url: `/pages/pipeline-edit/pipeline-edit?id=${p.id}` });
        }, 600);
      })
      .catch((err) => {
        this.setData({ submitting: false });
        wx.showToast({
          title: err.status === 0 ? "无法连接后端服务" : err.message,
          icon: "none",
        });
      });
  },

  fullProblems() {
    const list = [];
    const { config, spec } = this.data;
    if (!config.name.trim()) list.push("请填写任务名称");
    const src = (spec.sources || []).find((s) => s.code === config.source_type);
    if (src && src.need_account && !config.source_account) list.push("请选择来源账号");
    if (config.source_type === "fit" && !(spec.fit_records || []).length) {
      list.push("还没有导入任何 FIT 文件");
    }
    if (!config.sync_content.length) list.push("请至少选择一项同步内容");
    if (!config.target_accounts.length) list.push("请至少选择一个目标账号");
    return list;
  },

  jumpToProblem() {
    const { config, spec } = this.data;
    let idx = 0;
    if (!config.name.trim()) idx = 0;
    else if (!config.sync_content.length) idx = 1;
    else if (!config.target_accounts.length) idx = 2;
    else idx = 3;
    this.setData({ step: idx });
    this.validate();
  },
});

function fmtWindow(win) {
  if (!win || (!win.start && !win.end)) return "不限";
  const f = (v) => (v ? String(v).slice(0, 16).replace("T", " ") : "—");
  return `${f(win.start)} ~ ${f(win.end)}`;
}
