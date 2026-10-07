import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, X } from "lucide-react";
import { useCreateSyncTask, usePreviewSyncConfig } from "../../api/queries";
import type { SyncSpec, SyncTaskConfig } from "../../api/types";
import SyncTaskForm, { defaultTaskConfig } from "./SyncTaskForm";

const STEPS: { key: "source" | "content" | "target" | "time"; label: string; hint: string }[] = [
  { key: "source", label: "数据来源", hint: "FIT 文件 / iGPSPORT / 佳明 …" },
  { key: "content", label: "同步内容", hint: "运动记录、轨迹、资料、体重、睡眠 …" },
  { key: "target", label: "目标账号", hint: "可多选" },
  { key: "time", label: "时间与选项", hint: "时间范围与纠偏、去重等策略" },
];

interface Props {
  spec: SyncSpec;
  onClose: () => void;
  onCreated: (id: number) => void;
}

export default function SyncTaskWizard({ spec, onClose, onCreated }: Props) {
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<SyncTaskConfig>(() => defaultTaskConfig(spec, ""));
  const createMutation = useCreateSyncTask();
  const preview = usePreviewSyncConfig();
  const [previewText, setPreviewText] = useState<string | null>(null);

  const patch = (p: Partial<SyncTaskConfig>) => setConfig((prev) => ({ ...prev, ...p }));

  /** 全量校验：仅在最后一步「创建任务」时使用 */
  const problems = useMemo(() => {
    const list: string[] = [];
    const src = spec.sources.find((s) => s.code === config.source_type);
    if (!config.name.trim()) list.push("请填写任务名称");
    if (src?.need_account && !config.source_account) list.push(`请选择 ${src.label} 的来源账号`);
    if (config.source_type === "fit" && !spec.fit_records.length) list.push("还没有导入任何 FIT 文件");
    if (!config.sync_content.length) list.push("请至少选择一项同步内容");
    if (!config.target_accounts.length) list.push("请至少选择一个目标账号");
    if (config.time_range.mode === "custom" && !config.time_range.start && !config.time_range.end)
      list.push("请填写自定义时间范围");
    return list;
  }, [config, spec]);

  /** 分步校验：只校验「当前这一步」该填的内容，避免后置步骤把前面的「下一步」锁死 */
  const stepProblems = useMemo(() => {
    const src = spec.sources.find((s) => s.code === config.source_type);
    switch (STEPS[step].key) {
      case "source": {
        const list: string[] = [];
        if (!config.name.trim()) list.push("请填写任务名称");
        if (src?.need_account && !config.source_account) list.push(`请选择 ${src.label} 的来源账号`);
        if (config.source_type === "fit" && !spec.fit_records.length)
          list.push("还没有导入任何 FIT 文件，请先在「FIT 解析」页上传");
        return list;
      }
      case "content":
        return config.sync_content.length ? [] : ["请至少选择一项同步内容"];
      case "target":
        return config.target_accounts.length ? [] : ["请至少选择一个目标账号"];
      case "time":
        return config.time_range.mode === "custom" && !config.time_range.start && !config.time_range.end
          ? ["请填写自定义时间范围"]
          : [];
      default:
        return [];
    }
  }, [config, spec, step]);

  const canNext = stepProblems.length === 0;

  const submit = async () => {
    const created = await createMutation.mutateAsync({ ...config, name: config.name.trim() });
    onCreated(created.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">新建同步任务</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              第 {step + 1} / {STEPS.length} 步 · {STEPS[step].hint}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* 步骤条 */}
        <div className="flex gap-1 border-b border-slate-200 bg-white px-5 pb-3">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              onClick={() => setStep(i)}
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                i === step
                  ? "bg-indigo-50 text-indigo-700"
                  : i < step
                    ? "text-emerald-600 hover:bg-emerald-50"
                    : "text-slate-400 hover:bg-slate-50"
              }`}
            >
              {i + 1}. {s.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {step === 0 && (
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
              <label className="mb-1 block text-xs font-medium text-slate-500">任务名称</label>
              <input
                value={config.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="例如：FIT 骑行记录 → Strava"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
              <label className="mb-1 mt-3 block text-xs font-medium text-slate-500">描述（可选）</label>
              <input
                value={config.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="这条任务做什么"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
            </div>
          )}

          <SyncTaskForm spec={spec} value={config} onChange={patch} only={STEPS[step].key} />

          {previewText && (
            <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-700">
              {previewText}
            </p>
          )}
          {(() => {
            const list = step === STEPS.length - 1 ? problems : stepProblems;
            if (!list.length) return null;
            return (
              <ul className="mt-4 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                {list.map((p) => (
                  <li key={p}>· {p}</li>
                ))}
              </ul>
            );
          })()}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-5 py-3">
          <button
            onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
            className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {step === 0 ? "取消" : "上一步"}
          </button>

          <div className="flex items-center gap-2">
            {step === STEPS.length - 1 && (
              <button
                onClick={() =>
                  void preview
                    .mutateAsync(config)
                    .then((r) =>
                      setPreviewText(
                        `试运行预览：将同步 ${r.activity_count} 条活动到 ${r.targets.length} 个账号` +
                          (r.coord_fixed_points ? `，纠偏轨迹点 ${r.coord_fixed_points} 个` : "") +
                          (r.items.length ? `。示例：${r.items.slice(0, 3).map((i) => i.name).join("、")}` : ""),
                      ),
                    )
                    .catch((e: Error) => setPreviewText(`预览失败：${e.message}`))
                }
                disabled={preview.isPending}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                {preview.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "试运行预览"}
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={!canNext}
                title={canNext ? "进入下一步" : stepProblems.join("；")}
                className="flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                下一步 <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={() => void submit()}
                disabled={problems.length > 0 || createMutation.isPending}
                title={problems.length ? problems.join("；") : "创建任务"}
                className="flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                创建任务
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
