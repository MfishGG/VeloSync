import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarRange,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Users,
} from "lucide-react";
import { qk, runPipeline, useDeletePipeline, usePipelines, useSyncSpec } from "../api/queries";
import SyncTaskWizard from "../components/sync/SyncTaskWizard";

const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  success: { label: "上次运行成功", cls: "bg-emerald-50 text-emerald-600" },
  partial: { label: "上次部分成功", cls: "bg-amber-50 text-amber-600" },
  error: { label: "上次运行失败", cls: "bg-red-50 text-red-600" },
  running: { label: "运行中", cls: "bg-blue-50 text-blue-600" },
  pending: { label: "排队中", cls: "bg-slate-100 text-slate-500" },
};

export default function PipelinesPage() {
  const { data: pipelines, isLoading } = usePipelines();
  const { data: spec } = useSyncSpec();
  const deleteMutation = useDeletePipeline();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [wizard, setWizard] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);

  const runTask = async (id: number) => {
    setRunningId(id);
    try {
      await runPipeline(id);
      void queryClient.invalidateQueries({ queryKey: qk.pipelines });
      void queryClient.invalidateQueries({ queryKey: qk.logs("") });
      void queryClient.invalidateQueries({ queryKey: qk.matrix });
    } finally {
      setRunningId(null);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm("确定删除这条同步任务？删除后不可恢复。")) return;
    await deleteMutation.mutateAsync(id);
  };

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">同步任务</h1>
          <p className="text-sm text-slate-400">
            数据来源 → 同步内容 → 目标账号，可设定时间范围与纠偏 / 去重等策略
          </p>
        </div>
        <button
          onClick={() => setWizard(true)}
          disabled={!spec}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          新建同步任务
        </button>
      </header>

      {isLoading ? (
        <div className="p-8 text-sm text-slate-400">加载同步任务中…</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {(pipelines ?? []).map((p) => {
            const runStatus = p.last_run_status ? RUN_STATUS[p.last_run_status] : null;
            return (
              <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-slate-800">{p.name}</h3>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">
                      {p.description || "暂无描述"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Link
                      to={`/pipelines/${p.id}`}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-50 hover:text-indigo-600"
                      title="配置任务"
                    >
                      <Settings2 className="h-4 w-4" />
                    </Link>
                    <button
                      onClick={() => void remove(p.id)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                      title="删除任务"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* 源 → 目标 */}
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span className="rounded-md bg-indigo-50 px-2 py-0.5 font-medium text-indigo-600">
                    {p.source_label || "未设置来源"}
                  </span>
                  <span className="text-slate-300">→</span>
                  {p.target_count ? (
                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-600">
                      <Users className="mr-1 inline h-3 w-3" />
                      {p.target_summary}
                    </span>
                  ) : (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-400">未选目标账号</span>
                  )}
                </div>

                {/* 同步内容 */}
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.content_labels?.length ? (
                    p.content_labels.map((c) => (
                      <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                        {c}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-slate-300">未选择同步内容</span>
                  )}
                </div>

                {/* 时间范围 */}
                <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-400">
                  <CalendarRange className="h-3 w-3" />
                  {p.time_summary || "未设置时间范围"}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-md px-2 py-0.5 ${p.is_active ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                    {p.is_active ? "已启用" : "已停用"}
                  </span>
                  <span className={`rounded-md px-2 py-0.5 ${p.auto_run ? "bg-sky-50 text-sky-600" : "bg-slate-100 text-slate-400"}`}>
                    {p.auto_run ? "定时自动运行" : "手动运行"}
                  </span>
                  {runStatus && <span className={`rounded-md px-2 py-0.5 ${runStatus.cls}`}>{runStatus.label}</span>}
                  <button
                    onClick={() => void runTask(p.id)}
                    disabled={runningId !== null || !p.is_active}
                    className="ml-auto flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {runningId === p.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    {runningId === p.id ? "执行中…" : "立即运行"}
                  </button>
                </div>
                <div className="mt-2 text-[11px] text-slate-300">
                  {p.last_run_at ? `上次运行 ${new Date(p.last_run_at).toLocaleString("zh-CN")}` : "从未运行"}
                </div>
              </div>
            );
          })}

          {(pipelines ?? []).length === 0 && (
            <div className="col-span-full rounded-xl bg-white p-10 text-center text-sm text-slate-400">
              还没有同步任务，点击右上角「新建同步任务」开始
              <RefreshCw className="mx-auto mt-2 h-5 w-5 text-slate-300" />
            </div>
          )}
        </div>
      )}

      {wizard && spec && (
        <SyncTaskWizard
          spec={spec}
          onClose={() => setWizard(false)}
          onCreated={(id) => {
            setWizard(false);
            navigate(`/pipelines/${id}`);
          }}
        />
      )}
    </div>
  );
}
