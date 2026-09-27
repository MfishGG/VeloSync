import { useMemo, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { useMatrix, useSyncCell } from "../api/queries";
import { StatusIcon, statusLabel } from "../components/StatusIcon";
import { useUiStore } from "../stores/uiStore";

interface MenuState {
  x: number;
  y: number;
  activityId: number;
  activityName: string;
  platformId: number;
  platformName: string;
}

const TYPE_LABELS: Record<string, string> = {
  cycling: "骑行",
  running: "跑步",
  swimming: "游泳",
  hiking: "徒步",
};

export default function MatrixPage() {
  const { data, isLoading } = useMatrix();
  const syncMutation = useSyncCell();
  const setContext = useUiStore((s) => s.setContext);
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);

  const rows = useMemo(() => {
    return (data?.activities ?? []).filter((a) => {
      if (typeFilter && a.activity_type !== typeFilter) return false;
      if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [data, typeFilter, search]);

  const manualSync = () => {
    if (!menu) return;
    syncMutation.mutate(
      { activityId: menu.activityId, platformId: menu.platformId },
      {
        onSuccess: (res) => {
          window.alert(
            res.status === "synced"
              ? `✅ 已同步到 ${menu.platformName}`
              : `⚠️ ${menu.platformName}：${res.error_message || res.status}`
          );
        },
        onError: (err) => window.alert(err.message),
      }
    );
    setMenu(null);
  };

  if (isLoading) return <div className="p-8 text-sm text-slate-400">加载矩阵中…</div>;

  return (
    <div
      className="flex h-full flex-col p-6"
      onMouseDown={() => setMenu(null)}
    >
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">活动矩阵</h1>
          <p className="text-sm text-slate-400">
            行 = 活动，列 = 平台 · 单元格可点击查看详情，右键手动同步
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-300" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索活动…"
              className="w-48 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-indigo-400"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
          >
            <option value="">全部类型</option>
            <option value="cycling">骑行</option>
            <option value="running">跑步</option>
            <option value="swimming">游泳</option>
            <option value="hiking">徒步</option>
          </select>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">活动</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">类型</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">距离</th>
              {(data?.platforms ?? []).map((p) => (
                <th key={p.id} className="px-4 py-3 text-center text-xs font-semibold text-slate-500">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-slate-50 hover:bg-slate-50/60">
                <td className="max-w-64 px-4 py-2.5">
                  <button
                    onClick={() => setContext({ type: "activity", id: a.id })}
                    className="truncate text-left font-medium text-slate-700 hover:text-indigo-600"
                  >
                    {a.name}
                  </button>
                  <div className="text-[10px] text-slate-400">
                    {new Date(a.start_timestamp).toLocaleString("zh-CN")}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-slate-500">{TYPE_LABELS[a.activity_type] ?? a.activity_type}</td>
                <td className="px-4 py-2.5 tabular-nums text-slate-500">{a.distance} km</td>
                {(data?.platforms ?? []).map((p) => {
                  const cell = a.states[p.id];
                  return (
                    <td
                      key={p.id}
                      className="cursor-pointer px-4 py-2.5 text-center"
                      title={cell?.error_message || statusLabel(cell?.status)}
                      onClick={() => setContext({ type: "activity", id: a.id })}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({
                          x: e.clientX,
                          y: e.clientY,
                          activityId: a.id,
                          activityName: a.name,
                          platformId: p.id,
                          platformName: p.name,
                        });
                      }}
                    >
                      <span className="inline-flex justify-center">
                        <StatusIcon status={cell?.status} />
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={(data?.platforms.length ?? 0) + 3} className="px-4 py-12 text-center text-slate-400">
                  没有符合筛选条件的活动
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 右键菜单 */}
      {menu && (
        <div
          className="fixed z-50 w-52 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="truncate px-3 py-1.5 text-[10px] text-slate-400">
            「{menu.activityName}」→ {menu.platformName}
          </div>
          <button
            onClick={manualSync}
            disabled={syncMutation.isPending}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50"
          >
            {syncMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            手动同步到此平台
          </button>
          <button
            onClick={() => {
              setContext({ type: "activity", id: menu.activityId });
              setMenu(null);
            }}
            className="w-full px-3 py-2 text-left text-sm text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
          >
            查看活动详情
          </button>
        </div>
      )}
    </div>
  );
}
