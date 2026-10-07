/**
 * 同步任务表单（新建向导 / 配置页共用）
 *
 * 四段结构化配置：数据来源 → 同步内容 → 目标账号 → 时间范围与选项。
 * 每次交互只把「变化的那部分」通过 change 事件抛给页面，页面合并进完整 config。
 *
 * 属性：
 *   spec  {Object} 后端 /pipelines/sync-spec/ 返回的规格目录
 *   value {Object} 当前 SyncTaskConfig
 *   step  {String} 仅渲染某一段：source | content | target | time；空串渲染全部
 */
const OPTION_BOOL_KEYS = ["coord_fix", "dedup", "only_gps", "write_back", "stop_on_error", "dry_run"];

function defaultContents(spec, sourceCode) {
  const list = (spec.contents && spec.contents[sourceCode]) || [];
  return list.filter((c) => c.default).map((c) => c.key);
}

Component({
  properties: {
    spec: { type: Object, value: null },
    value: { type: Object, value: null },
    step: { type: String, value: "" },
  },

  data: {
    ready: false,
    showSource: true,
    showContent: true,
    showTarget: true,
    showTime: true,

    // 数据来源
    sourceLabels: [],
    sourceIndex: 0,
    sourceSpec: null,
    needAccount: false,
    isFit: false,
    sourceAccountLabel: "",
    accountOptions: [], // 来源账号（单选）
    fitOptions: [], // FIT 记录（单选）
    fitIndex: -1,
    fitLabel: "",
    fitBounds: null,

    // 同步内容
    currentContents: [],

    // 目标账号（多选）
    targetOptions: [],

    // 时间范围
    timeModes: [],
    timeModeLabels: [],
    timeModeIndex: 0,
    timeRange: { mode: "file", start: null, end: null, days: 30 },
    startDate: "",
    startTime: "00:00",
    endDate: "",
    endTime: "23:59",
    customHint: "",
    dayOptions: [7, 14, 30, 60, 90, 180, 365],
    dayIndex: 2,

    // 选项
    optionRows: [],
  },

  observers: {
    "spec, value": function (spec, value) {
      if (!spec || !value) return;
      this.rebuild(spec, value);
    },
    step: function (step) {
      this.applyStep(step);
    },
  },

  lifetimes: {
    attached() {
      this.applyStep(this.data.step);
      if (this.data.spec && this.data.value) this.rebuild(this.data.spec, this.data.value);
    },
  },

  methods: {
    applyStep(step) {
      const s = step || "";
      this.setData({
        showSource: !s || s === "source",
        showContent: !s || s === "content",
        showTarget: !s || s === "target",
        showTime: !s || s === "time",
      });
    },

    emit(patch) {
      this.triggerEvent("change", patch);
    },

    /* ---------------- 构建视图数据 ---------------- */
    rebuild(spec, value) {
      const sourceSpec = (spec.sources || []).find((s) => s.code === value.source_type) || null;
      const sourceLabels = (spec.sources || []).map((s) => `${s.label}`);
      const sourceIndex = Math.max(
        0,
        (spec.sources || []).findIndex((s) => s.code === value.source_type),
      );
      const needAccount = !!(sourceSpec && sourceSpec.need_account);
      const isFit = value.source_type === "fit";

      const srcAccountId = value.source_account;
      const accountOptions = (spec.accounts || []).map((a) => ({
        id: a.id,
        label: `${a.platform_name} · ${a.display_name || a.platform}`,
        checked: a.id === srcAccountId,
        disabled: (a.status || "active") !== "active",
      }));

      const srcAccount = accountOptions.find((a) => a.checked) || null;

      const fitOptions = (spec.fit_records || []).map((r) => ({
        id: r.id,
        label: `${r.activity_name}（${String(r.start).slice(0, 16).replace("T", " ")}）`,
        start: r.start,
        end: r.end,
        duration: r.duration,
        distance: r.distance,
        has_gps: r.has_gps,
        track_point_count: r.track_point_count,
        sample_count: r.sample_count,
        checked: r.id === value.source_fit_detail,
      }));
      const curFit = fitOptions.find((f) => f.checked) || null;

      const contents = ((spec.contents || {})[value.source_type] || []).map((c) => ({
        key: c.key,
        label: c.label,
        desc: c.desc,
        implemented: c.implemented,
        checked: (value.sync_content || []).indexOf(c.key) >= 0,
      }));

      const targetOptions = (spec.accounts || []).map((a) => ({
        id: a.id,
        label: `${a.platform_name} · ${a.display_name || a.platform}`,
        upload: !!(a.capabilities && a.capabilities.upload),
        status: a.status,
        checked: (value.target_accounts || []).indexOf(a.id) >= 0,
      }));

      // 时间范围
      const tr = value.time_range || { mode: "file", start: null, end: null, days: 30 };
      const modeCodes = (sourceSpec && sourceSpec.time_modes) || ["all", "recent", "custom"];
      const timeModes = (spec.time_modes || []).filter((m) => modeCodes.indexOf(m.code) >= 0);
      const timeModeLabels = timeModes.map((m) => m.label);
      const timeModeIndex = Math.max(0, timeModes.findIndex((m) => m.code === tr.mode));
      const startParts = splitIso(tr.start);
      const endParts = splitIso(tr.end);
      const dayIndex = Math.max(0, this.data.dayOptions.indexOf(tr.days));

      // 选项
      const optionRows = (spec.options || [])
        .filter((o) => !o.applies_to || !o.applies_to.length || o.applies_to.indexOf(value.source_type) >= 0)
        .map((o) => {
          const raw = (value.options || {})[o.key];
          const cur = raw === undefined ? o.default : raw;
          const row = {
            key: o.key,
            label: o.label,
            desc: o.desc,
            type: o.type,
            min: o.min,
            max: o.max,
            value: cur,
          };
          if (o.type === "choice") {
            row.choices = o.choices || [];
            row.choiceLabels = (o.choices || []).map((c) => c.label);
            row.choiceIndex = Math.max(
              0,
              (o.choices || []).findIndex((c) => c.value === cur),
            );
            row.choiceLabel = (row.choices[row.choiceIndex] || {}).label || "";
          }
          return row;
        });

      this.setData({
        ready: true,
        sourceLabels,
        sourceIndex,
        sourceSpec,
        needAccount,
        isFit,
        sourceAccountLabel: srcAccount ? srcAccount.label : "",
        accountOptions,
        fitOptions,
        fitIndex: curFit ? curFit.id : -1,
        fitLabel: curFit ? curFit.label : "",
        fitBounds: curFit
          ? {
              start: curFit.start,
              end: curFit.end,
              text: `${String(curFit.start).slice(0, 16).replace("T", " ")} ~ ${String(
                curFit.end,
              )
                .slice(0, 16)
                .replace("T", " ")}, ${curFit.track_point_count} 个轨迹点 / ${
                curFit.sample_count
              } 个采样点`,
            }
          : null,
        currentContents: contents,
        targetOptions,
        timeModes,
        timeModeLabels,
        timeModeIndex,
        timeRange: tr,
        startDate: startParts.date,
        startTime: startParts.time,
        endDate: endParts.date,
        endTime: endParts.time,
        dayIndex,
        optionRows,
      });
    },

    /* ---------------- 数据来源 ---------------- */
    onSourceChange(e) {
      const idx = Number(e.detail.value);
      const spec = this.data.spec;
      const code = spec.sources[idx].code;
      const tr = this.data.timeRange || {};
      const defaultMode = code === "fit" ? "file" : "all";
      this.emit({
        source_type: code,
        source_account: null,
        source_fit_detail: null,
        sync_content: defaultContents(spec, code),
        time_range: Object.assign({}, tr, { mode: defaultMode, start: null, end: null }),
      });
    },

    onSourceAccount(e) {
      const id = this.data.accountOptions[Number(e.detail.value)].id;
      this.emit({ source_account: id });
    },

    onFitChange(e) {
      const rec = this.data.fitOptions[Number(e.detail.value)];
      this.emit({ source_fit_detail: rec.id });
    },

    /* ---------------- 同步内容 ---------------- */
    onContentChange(e) {
      this.emit({ sync_content: e.detail.value });
    },

    /* ---------------- 目标账号 ---------------- */
    onTargetChange(e) {
      this.emit({ target_accounts: e.detail.value.map(Number) });
    },

    /* ---------------- 时间范围 ---------------- */
    onTimeModeChange(e) {
      const mode = (this.data.timeModes[Number(e.detail.value)] || {}).code || "all";
      this.emit({
        time_range: Object.assign({}, this.data.timeRange, { mode }),
      });
    },

    onDaysChange(e) {
      const days = this.data.dayOptions[Number(e.detail.value)];
      this.emit({ time_range: Object.assign({}, this.data.timeRange, { mode: "recent", days }) });
    },

    onStartDate(e) {
      this.pushCustom(e.detail.value, this.data.startTime, this.data.endDate, this.data.endTime);
    },
    onStartTime(e) {
      this.pushCustom(this.data.startDate, e.detail.value, this.data.endDate, this.data.endTime);
    },
    onEndDate(e) {
      this.pushCustom(this.data.startDate, this.data.startTime, e.detail.value, this.data.endTime);
    },
    onEndTime(e) {
      this.pushCustom(this.data.startDate, this.data.startTime, this.data.endDate, e.detail.value);
    },

    pushCustom(startDate, startTime, endDate, endTime) {
      this.emit({
        time_range: Object.assign({}, this.data.timeRange, {
          mode: "custom",
          start: startDate ? `${startDate}T${startTime || "00:00"}` : null,
          end: endDate ? `${endDate}T${endTime || "23:59"}` : null,
        }),
      });
    },

    clearCustom() {
      this.emit({
        time_range: Object.assign({}, this.data.timeRange, {
          mode: "custom",
          start: null,
          end: null,
        }),
      });
    },

    /** 一键填入 FIT 记录自身的完整范围 */
    fillFitRange() {
      const b = this.data.fitBounds;
      if (!b) return;
      this.emit({
        time_range: Object.assign({}, this.data.timeRange, {
          mode: "custom",
          start: b.start,
          end: b.end,
        }),
      });
    },

    /* ---------------- 选项 ---------------- */
    onOptionSwitch(e) {
      const key = e.currentTarget.dataset.key;
      this.patchOption(key, e.detail.value);
    },

    onOptionChoice(e) {
      const key = e.currentTarget.dataset.key;
      const row = this.data.optionRows.find((r) => r.key === key);
      this.patchOption(key, row.choices[Number(e.detail.value)].value);
    },

    onOptionInt(e) {
      const key = e.currentTarget.dataset.key;
      const n = Number(e.detail.value);
      if (Number.isNaN(n)) return;
      this.patchOption(key, n);
    },

    patchOption(key, val) {
      const options = Object.assign({}, this.data.value.options || {});
      options[key] = val;
      this.emit({ options });
    },
  },
});

function splitIso(iso) {
  if (!iso) return { date: "", time: "" };
  const s = String(iso).replace(" ", "T");
  const parts = s.split("T");
  return { date: parts[0] || "", time: (parts[1] || "").slice(0, 5) || "" };
}
