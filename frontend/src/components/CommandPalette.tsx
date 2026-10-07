import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Command } from "cmdk";
import { FileText, LogOut, RefreshCw, Workflow } from "lucide-react";
import { useMatrix, usePipelines } from "../api/queries";
import ConfirmDialog from "./ConfirmDialog";
import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";

const PAGES = [
  { path: "/", label: "仪表盘" },
  { path: "/pipelines", label: "同步任务" },
  { path: "/matrix", label: "活动矩阵" },
  { path: "/fit", label: "FIT 解析" },
  { path: "/accounts", label: "账号管理" },
  { path: "/logs", label: "同步日志" },
  { path: "/settings", label: "设置" },
];

export default function CommandPalette() {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const setContext = useUiStore((s) => s.setContext);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: pipelines } = usePipelines();
  const { data: matrix } = useMatrix();
  const [logoutOpen, setLogoutOpen] = useState(false);

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

  // 退出确认弹窗可能在命令面板关闭后仍需渲染
  if (!open && !logoutOpen) return null;

  const go = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  const doLogout = () => {
    setLogoutOpen(false);
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <>
      {open && (
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
              placeholder="搜索页面、同步任务、活动，或执行操作…"
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

              <Command.Group heading="同步任务" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-slate-400">
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
                <Command.Item
                  value="logout"
                  onSelect={() => {
                    setOpen(false);
                    setLogoutOpen(true);
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-red-600 data-[selected=true]:bg-red-50 data-[selected=true]:text-red-700"
                >
                  <LogOut className="h-4 w-4 text-red-400" />
                  退出登录
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </div>
      )}

      <ConfirmDialog
        open={logoutOpen}
        title="退出登录"
        confirmText="退出登录"
        danger
        onConfirm={doLogout}
        onCancel={() => setLogoutOpen(false)}
      >
        退出后需要重新输入账号密码才能进入工作台，本地保存的登录凭证将被清除。
      </ConfirmDialog>
    </>
  );
}
