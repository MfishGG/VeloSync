import { useMemo, useState } from "react";
import { CheckCircle2, Info, Table2, TriangleAlert, XCircle, List } from "lucide-react";
import { useLogs, usePipelines } from "../api/queries";

const LEVEL_META: Record<string, { icon: typeof Info; cls: string; dot: string; label: string }> = {
  info: { icon: Info, cls: "text-sky-600", dot: "bg-sky-400", label: "信息" },
  success: { icon: CheckCircle2, cls: "text-emerald-600", dot: "bg-emerald-400", label: "成功" },
  warning: { icon: TriangleAlert, cls: "text-amber-600", dot: "bg-amber-400", label: "警告" },
  error: { icon: XCircle, cls: "text-red-600", dot: "bg-red-400", label: "错误" },
};

export default function LogsPage() {
  const [level, setLevel] = useState("");
  const [pipelineId, setPipelineId] = useState("");
  const [view, setView] = useState<"table" | "timeline">("table");
  const { data: pipelines } = usePipelines();

  const params = useMemo(() => {
    const qs = new URLSearchParams();
    if (level) qs.set("level", level);
    if (pipelineId) qs.set("pipeline", pipelineId);
    return qs.toString() ? `?${qs.toString()}` : "";
  }, [level, pipelineId]);

  const { data, isLoading } = useLogs(params);

  return (
    <div className="flex h-full flex-col p-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">同步日志</h1>
          <p className="text-sm text-slate-400">时间轴 + 表格双视图 · 按级别 / 同步任务筛选</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
          >
            <option value="">全部级别</option>
            <option value="info">信息</option>
            <option value="success">成功</option>
            <option value="warning">警告</option>
            <option value="error">错误</option>
          </select>
          <select
            value={pipelineId}
            onChange={(e) => setPipelineId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
          >
            <option value="">全部同步任务</option>
            {(pipelines ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            <button
              onClick={() => setView("table")}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs ${view === "table" ? "bg-indigo-50 text-indigo-600" : "bg-white text-slate-400"}`}
            >
              <Table2 className="h-3.5 w-3.5" /> 表格
            </button>
            <button
              onClick={() => setView("timeline")}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs ${view === "timeline" ? "bg-indigo-50 text-indigo-600" : "bg-white text-slate-400"}`}
            >
              <List className="h-3.5 w-3.5" /> 时间轴
            </button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white p-4">
        {isLoading ? (
          <div className="p-8 text-sm text-slate-400">加载日志中…</div>
        ) : view === "table" ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-3 py-2.5 font-medium">级别</th>
                <th className="px-3 py-2.5 font-medium">消息</th>
                <th className="px-3 py-2.5 font-medium">同步任务</th>
                <th className="px-3 py-2.5 font-medium">活动</th>
                <th className="px-3 py-2.5 font-medium">时间</th>
              </tr>
            </thead>
            <tbody>
              {(data?.results ?? []).map((log) => {
                const meta = LEVEL_META[log.level] ?? LEVEL_META.info;
                const Icon = meta.icon;
                return (
                  <tr key={log.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5">
                      <span className={`flex items-center gap-1.5 text-xs ${meta.cls}`}>
                        <Icon className="h-3.5 w-3.5" /> {meta.label}
                      </span>
                    </td>
                    <td className="max-w-96 px-3 py-2.5">
                      <span className="line-clamp-1 text-slate-600" title={log.message}>
                        {log.message}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">{log.pipeline_name ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">{log.activity_name ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-400">
                      {new Date(log.created_at).toLocaleString("zh-CN")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="relative space-y-6 py-2 pl-2">
            {(data?.results ?? []).map((log) => {
              const meta = LEVEL_META[log.level] ?? LEVEL_META.info;
              const Icon = meta.icon;
              return (
                <div key={log.id} className="relative flex gap-4 border-l-2 border-slate-100 pl-6">
                  <span className={`absolute -left-[9px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white`}>
                    <Icon className={`h-4 w-4 ${meta.cls}`} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-700">{log.message}</p>
                    <p className="mt-0.5 flex gap-2 text-[10px] text-slate-400">
                      <span>{new Date(log.created_at).toLocaleString("zh-CN")}</span>
                      {log.pipeline_name && <span>· {log.pipeline_name}</span>}
                      {log.activity_name && <span>· {log.activity_name}</span>}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {(data?.results ?? []).length === 0 && !isLoading && (
          <div className="py-10 text-center text-sm text-slate-400">暂无日志</div>
        )}
      </div>

      {data && (
        <footer className="mt-3 text-xs text-slate-400">
          共 {data.count} 条 · 第 {data.results.length} 条已显示
        </footer>
      )}
    </div>
  );
}
