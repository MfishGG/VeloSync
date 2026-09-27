import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Command } from "cmdk";
import { FileText, RefreshCw, Workflow } from "lucide-react";
import { useMatrix, usePipelines } from "../api/queries";
import { useUiStore } from "../stores/uiStore";

const PAGES = [
  { path: "/", label: "仪表盘" },
  { path: "/pipelines", label: "管道" },
  { path: "/matrix", label: "活动矩阵" },
  { path: "/accounts", label: "账号管理" },
  { path: "/logs", label: "同步日志" },
  { path: "/settings", label: "设置" },
];

export default function CommandPalette() {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const setContext = useUiStore((s) => s.setContext);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: pipelines } = usePipelines();
  const { data: matrix } = useMatrix();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, setOpen]);

  if (!open) return null;

  const go = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 pt-24"
      onMouseDown={() => setOpen(false)}
    >
      <Command
        loop
        className="w-[560px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <Command.Input
          autoFocus
          placeholder="搜索页面、管道、活动，或执行操作…"
          className="w-full border-b border-slate-100 px-4 py-3.5 text-sm outline-none placeholder:text-slate-400"
        />
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-slate-400">
            没有匹配结果
          </Command.Empty>

          <Command.Group heading="页面" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-slate-400">
            {PAGES.map((p) => (
              <Command.Item
                key={p.path}
                value={`page-${p.label}`}
                onSelect={() => go(p.path)}
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm data-[selected=true]:bg-indigo-50 data-[selected=true]:text-indigo-700"
              >
                <FileText className="h-4 w-4 text-slate-400" />
                {p.label}
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading="管道" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-slate-400">
            {(pipelines ?? []).map((p) => (
              <Command.Item
                key={p.id}
                value={`pipeline-${p.id}-${p.name}`}
                onSelect={() => go(`/pipelines/${p.id}`)}
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm data-[selected=true]:bg-indigo-50 data-[selected=true]:text-indigo-700"
              >
                <Workflow className="h-4 w-4 text-slate-400" />
                {p.name}
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading="活动（跳转到矩阵）" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-slate-400">
            {(matrix?.activities ?? []).slice(0, 20).map((a) => (
              <Command.Item
                key={a.id}
                value={`activity-${a.id}-${a.name}`}
                onSelect={() => {
                  setContext({ type: "activity", id: a.id });
                  go("/matrix");
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm data-[selected=true]:bg-indigo-50 data-[selected=true]:text-indigo-700"
              >
                <span className="text-xs text-slate-400">{a.activity_type}</span>
                <span className="truncate">{a.name}</span>
                <span className="ml-auto text-xs text-slate-400">
                  {new Date(a.start_timestamp).toLocaleDateString("zh-CN")}
                </span>
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading="操作" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-slate-400">
            <Command.Item
              value="refresh-data"
              onSelect={() => {
                void queryClient.invalidateQueries();
                setOpen(false);
              }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm data-[selected=true]:bg-indigo-50 data-[selected=true]:text-indigo-700"
            >
              <RefreshCw className="h-4 w-4 text-slate-400" />
              刷新所有数据
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
