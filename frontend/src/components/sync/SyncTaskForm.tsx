import { useMemo } from "react";
import { AlertTriangle, CalendarRange, Compass, Database, Layers, SlidersHorizontal, Users } from "lucide-react";
import type { FitRecordOption, SpecAccount, SyncSpec, SyncTaskConfig, TimeRange } from "../../api/types";

interface Props {
  spec: SyncSpec;
  value: SyncTaskConfig;
  onChange: (patch: Partial<SyncTaskConfig>) => void;
  /** 向导模式：只渲染某一步（source / content / target / time） */
  only?: "source" | "content" | "target" | "time";
}

const SECTION_ICON = "h-4 w-4";

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <header className="mb-3 flex items-start gap-2">
        <span className="mt-0.5 text-indigo-500">{icon}</span>
        <div>
          <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
          {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

/** 同步任务配置表单：数据来源 → 同步内容 → 目标账号 → 时间范围 → 同步选项。
 *  新建向导与任务编辑页共用同一份实现，保证两处行为一致。 */
export default function SyncTaskForm({ spec, value, onChange, only }: Props) {
  const show = (step: string) => !only || only === step;
  const sourceSpec = spec.sources.find((s) => s.code === value.source_type) ?? spec.sources[0];
  const contents = spec.contents[value.source_type] ?? [];
  const recordOptions: FitRecordOption[] = spec.fit_records ?? [];
  const selectedRecord = recordOptions.find((r) => r.id === value.source_fit_detail) ?? null;

  /** FIT 来源的可选时间边界：指定记录用该记录范围，否则取全部记录的外包范围 */
  const fitBounds = useMemo(() => {
    if (value.source_type !== "fit") return null;
    if (selectedRecord) return { start: selectedRecord.start, end: selectedRecord.end };
    if (!recordOptions.length) return null;
    const starts = recordOptions.map((r) => r.start);
    const ends = recordOptions.map((r) => r.end);
    return { start: starts.reduce((a, b) => (a < b ? a : b)), end: ends.reduce((a, b) => (a > b ? a : b)) };
  }, [value.source_type, selectedRecord, recordOptions]);

  /** 平台来源的候选账号：优先同平台账号，其次全部账号 */
  const sourceAccounts: SpecAccount[] = useMemo(() => {
    const all = spec.accounts ?? [];
    if (value.source_type === "fit") return [];
    const same = all.filter((a) => a.platform === value.source_type);
    return same.length ? same : all;
  }, [spec.accounts, value.source_type]);

  const timeModes = sourceSpec?.time_modes ?? ["file"];
  const timeModeSpecs = spec.time_modes.filter((t) => timeModes.includes(t.code));

  const toggleContent = (key: string) => {
    const next = value.sync_content.includes(key)
      ? value.sync_content.filter((k) => k !== key)
      : [...value.sync_content, key];
    onChange({ sync_content: next });
  };

  const toggleTarget = (id: number) => {
    const next = value.target_accounts.includes(id)
      ? value.target_accounts.filter((t) => t !== id)
      : [...value.target_accounts, id];
    onChange({ target_accounts: next });
  };

  const setTimeRange = (patch: Partial<TimeRange>) =>
    onChange({ time_range: { ...value.time_range, ...patch } });

  const setOption = (key: string, val: unknown) =>
    onChange({ options: { ...value.options, [key]: val } });

  /** 选项是否与当前勾选内容相关（无关项置灰） */
  const optionRelevant = (applies: string[]) =>
    applies.includes("*") || applies.some((a) => value.sync_content.includes(a));

  const toLocalInput = (iso: string | null) => (iso ? iso.slice(0, 16) : "");

  return (
    <div className="space-y-4">
      {/* ---------------- 数据来源 ---------------- */}
      {show("source") && (
      <Section
        icon={<Database className={SECTION_ICON} />}
        title="数据来源"
        hint="选择要同步出去的数据来自哪里"
      >
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          {spec.sources.map((s) => {
            const active = value.source_type === s.code;
            return (
              <button
                key={s.code}
                type="button"
                onClick={() =>
                  onChange({
                    source_type: s.code,
                    source_account: s.need_account ? value.source_account : null,
                    source_fit_detail: s.code === "fit" ? value.source_fit_detail : null,
                    sync_content: (spec.contents[s.code] ?? [])
                      .filter((c) => c.default)
                      .map((c) => c.key),
                    time_range: {
                      ...value.time_range,
                      mode: (s.time_modes[0] ?? "file") as TimeRange["mode"],
                    },
                  })
                }
                className={`rounded-lg border p-3 text-left transition ${
                  active
                    ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`text-sm font-medium ${active ? "text-indigo-700" : "text-slate-700"}`}>
                    {s.label}
                  </span>
                  {s.kind === "file" && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">本地</span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">{s.desc}</p>
              </button>
            );
          })}
        </div>

        {sourceSpec?.need_account && (
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-slate-500">来源账号</label>
            <select
              value={value.source_account ?? ""}
              onChange={(e) =>
                onChange({ source_account: e.target.value ? Number(e.target.value) : null })
              }
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            >
              <option value="">— 未选择 —</option>
              {sourceAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.platform_name} · {a.display_name}
                </option>
              ))}
            </select>
            {!sourceAccounts.length && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5" /> 还没有绑定 {sourceSpec.label} 账号，请先在「账号」页绑定
              </p>
            )}
          </div>
        )}

        {value.source_type === "fit" && (
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-slate-500">
              FIT 记录（默认全部本地记录）
            </label>
            <select
              value={value.source_fit_detail ?? ""}
              onChange={(e) =>
                onChange({ source_fit_detail: e.target.value ? Number(e.target.value) : null })
              }
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            >
              <option value="">全部本地 FIT 记录（{recordOptions.length} 条）</option>
              {recordOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.file_name || r.activity_name} · {new Date(r.start).toLocaleString("zh-CN")}
                </option>
              ))}
            </select>
            {!recordOptions.length && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5" /> 还没有导入 FIT 文件，请先在「FIT 解析」页上传
              </p>
            )}
          </div>
        )}
      </Section>
      )}

      {/* ---------------- 同步内容 ---------------- */}
      {show("content") && (
      <Section
        icon={<Layers className={SECTION_ICON} />}
        title="同步内容"
        hint={`${sourceSpec?.label ?? ""} 支持同步的数据项，可多选`}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {contents.map((c) => {
            const checked = value.sync_content.includes(c.key);
            return (
              <label
                key={c.key}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition ${
                  checked ? "border-indigo-300 bg-indigo-50/60" : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleContent(c.key)}
                  className="mt-0.5 accent-indigo-600"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                    {c.label}
                    {!c.implemented && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">预留</span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-400">{c.desc}</span>
                </span>
              </label>
            );
          })}
        </div>
        {!value.sync_content.length && (
          <p className="mt-2 text-xs text-amber-500">至少选择一项同步内容</p>
        )}
      </Section>
      )}

      {/* ---------------- 目标账号 ---------------- */}
      {show("target") && (
      <Section
        icon={<Users className={SECTION_ICON} />}
        title="目标账号"
        hint="可同时同步到多个已绑定的平台账号"
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(spec.accounts ?? []).map((a) => {
            const checked = value.target_accounts.includes(a.id);
            const noUpload = !a.capabilities?.upload;
            return (
              <label
                key={a.id}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 transition ${
                  checked ? "border-emerald-300 bg-emerald-50/60" : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleTarget(a.id)}
                  className="accent-emerald-600"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-700">
                    {a.platform_name} · {a.display_name}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-400">
                    {a.status === "active" ? "账号有效" : `账号${a.status === "expired" ? "已过期" : "已撤销"}`}
                    {noUpload && " · 该平台未开放上传"}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {!(spec.accounts ?? []).length && (
          <p className="mt-2 text-xs text-amber-500">还没有绑定任何平台账号，请先在「账号」页绑定</p>
        )}
      </Section>
      )}

      {/* ---------------- 时间范围 ---------------- */}
      {show("time") && (
      <Section
        icon={<CalendarRange className={SECTION_ICON} />}
        title="时间范围"
        hint={sourceSpec?.time_note}
      >
        <div className="flex flex-wrap gap-2">
          {timeModeSpecs.map((t) => {
            const active = value.time_range.mode === t.code;
            return (
              <button
                key={t.code}
                type="button"
                onClick={() => setTimeRange({ mode: t.code as TimeRange["mode"] })}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {value.time_range.mode === "recent" && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-slate-500">最近</span>
            <input
              type="number"
              min={1}
              max={3650}
              value={value.time_range.days ?? 30}
              onChange={(e) => setTimeRange({ days: Number(e.target.value) || 30 })}
              className="w-24 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
            />
            <span className="text-xs text-slate-500">天内的记录</span>
          </div>
        )}

        {value.time_range.mode === "custom" && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">开始时间</label>
              <input
                type="datetime-local"
                value={toLocalInput(value.time_range.start)}
                min={fitBounds ? toLocalInput(fitBounds.start) : undefined}
                max={fitBounds ? toLocalInput(fitBounds.end) : undefined}
                onChange={(e) => setTimeRange({ start: e.target.value || null })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">结束时间</label>
              <input
                type="datetime-local"
                value={toLocalInput(value.time_range.end)}
                min={fitBounds ? toLocalInput(fitBounds.start) : undefined}
                max={fitBounds ? toLocalInput(fitBounds.end) : undefined}
                onChange={(e) => setTimeRange({ end: e.target.value || null })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
            </div>
            {fitBounds && (
              <p className="col-span-full text-xs text-slate-400">
                FIT 记录时间范围：{new Date(fitBounds.start).toLocaleString("zh-CN")} ~{" "}
                {new Date(fitBounds.end).toLocaleString("zh-CN")}，超出部分将被自动夹紧
              </p>
            )}
          </div>
        )}

        {value.time_range.mode === "file" && fitBounds && (
          <p className="mt-3 text-xs text-slate-400">
            将使用 FIT 文件自身记录的范围：{new Date(fitBounds.start).toLocaleString("zh-CN")} ~{" "}
            {new Date(fitBounds.end).toLocaleString("zh-CN")}
          </p>
        )}
      </Section>
      )}

      {/* ---------------- 同步选项 ---------------- */}
      {show("time") && (
      <Section
        icon={<SlidersHorizontal className={SECTION_ICON} />}
        title="同步选项"
        hint="已按最佳实践预置默认值，可按需调整"
      >
        <div className="space-y-3">
          {spec.options.map((o) => {
            const relevant = optionRelevant(o.applies_to ?? ["*"]);
            const raw = value.options?.[o.key] ?? o.default;
            return (
              <div
                key={o.key}
                className={`rounded-lg border p-3 ${
                  relevant ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"
                }`}
              >
                {o.type === "bool" && (
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={Boolean(raw)}
                      onChange={(e) => setOption(o.key, e.target.checked)}
                      className="mt-0.5 accent-indigo-600"
                    />
                    <span>
                      <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                        {o.label}
                        {o.key === "coord_fix" && <Compass className="h-3.5 w-3.5 text-sky-500" />}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-slate-400">{o.desc}</span>
                    </span>
                  </label>
                )}

                {o.type === "choice" && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">{o.label}</label>
                    <select
                      value={String(raw)}
                      onChange={(e) => setOption(o.key, e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                    >
                      {(o.choices ?? []).map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">{o.desc}</p>
                  </div>
                )}

                {o.type === "int" && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">{o.label}</label>
                    <input
                      type="number"
                      min={o.min}
                      max={o.max}
                      value={Number(raw)}
                      onChange={(e) => setOption(o.key, Number(e.target.value) || o.default)}
                      className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                    />
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">{o.desc}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>
      )}
    </div>
  );
}

/** 新建任务时的默认配置（用于向导与「另存为」） */
export function defaultTaskConfig(spec: SyncSpec, name: string): SyncTaskConfig {
  const source = spec.sources[0]?.code ?? "fit";
  return {
    name,
    description: "",
    is_active: true,
    auto_run: true,
    source_type: source,
    source_account: null,
    source_fit_detail: null,
    target_accounts: [],
    sync_content: (spec.contents[source] ?? []).filter((c) => c.default).map((c) => c.key),
    time_range: { mode: (spec.sources[0]?.time_modes[0] ?? "file") as TimeRange["mode"], start: null, end: null, days: 30 },
    options: Object.fromEntries(spec.options.map((o) => [o.key, o.default])),
  };
}
