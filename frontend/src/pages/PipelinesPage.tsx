import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, Plus, Settings2, Trash2, Workflow } from "lucide-react";
import { qk, useCreatePipeline, useDeletePipeline, usePipelines } from "../api/queries";

const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  success: { label: "上次运行成功", cls: "bg-emerald-50 text-emerald-600" },
  partial: { label: "上次部分成功", cls: "bg-amber-50 text-amber-600" },
  error: { label: "上次运行失败", cls: "bg-red-50 text-red-600" },
  running: { label: "运行中", cls: "bg-blue-50 text-blue-600" },
  pending: { label: "排队中", cls: "bg-slate-100 text-slate-500" },
};

export default function PipelinesPage() {
  const { data: pipelines, isLoading } = usePipelines();
  const createMutation = useCreatePipeline();
  const deleteMutation = useDeletePipeline();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const p = await createMutation.mutateAsync({ name: name.trim(), description });
      void queryClient.invalidateQueries({ queryKey: qk.pipelines });
      navigate(`/pipelines/${p.id}`);
    } finally {
      setCreating(false);
      setName("");
      setDescription("");
    }
  };

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-xl font-bold text-slate-800">同步管道</h1>
        <p className="text-sm text-slate-400">可视化数据流：源 → 过滤器 → 目标</p>
      </header>

      <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-4">
        <div className="min-w-48 flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-500">新管道名称</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：骑行活动 → Strava"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
          />
        </div>
        <div className="min-w-48 flex-[2]">
          <label className="mb-1 block text-xs font-medium text-slate-500">描述（可选）</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="这条管道做什么"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
          />
        </div>
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          创建并编辑
        </button>
      </form>

      {isLoading ? (
        <div className="p-8 text-sm text-slate-400">加载管道中…</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(pipelines ?? []).map((p) => {
            const runStatus = p.last_run_status ? RUN_STATUS[p.last_run_status] : null;
            return (
              <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                      <Workflow className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-800">{p.name}</h3>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{p.description || "暂无描述"}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Link
                      to={`/pipelines/${p.id}`}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-50 hover:text-indigo-600"
                      title="打开编辑器"
                    >
                      <Settings2 className="h-4 w-4" />
                    </Link>
                    <button
                      onClick={() => void deleteMutation.mutateAsync(p.id)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                      title="删除管道"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-500">{p.node_count} 个节点</span>
                  <span className={`rounded-md px-2 py-0.5 ${p.is_active ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                    {p.is_active ? "已启用" : "已停用"}
                  </span>
                  <span className={`rounded-md px-2 py-0.5 ${p.auto_run ? "bg-sky-50 text-sky-600" : "bg-slate-100 text-slate-400"}`}>
                    {p.auto_run ? "定时自动运行" : "手动运行"}
                  </span>
                  {runStatus && <span className={`rounded-md px-2 py-0.5 ${runStatus.cls}`}>{runStatus.label}</span>}
                  <span className="ml-auto text-slate-300">
                    {p.last_run_at ? new Date(p.last_run_at).toLocaleString("zh-CN") : "从未运行"}
                  </span>
                </div>
              </div>
            );
          })}
          {(pipelines ?? []).length === 0 && (
            <div className="col-span-full rounded-xl bg-white p-10 text-center text-sm text-slate-400">
              还没有管道，先创建一个吧
              <Play className="mx-auto mt-2 h-5 w-5 text-slate-300" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
