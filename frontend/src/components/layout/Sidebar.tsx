import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Activity,
  FileUp,
  Grid3X3,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings,
  Workflow,
} from "lucide-react";
import BrandMark from "../BrandMark";
import ConfirmDialog from "../ConfirmDialog";
import { useAuthStore } from "../../stores/authStore";
import { useUiStore } from "../../stores/uiStore";

const NAV = [
  { to: "/", label: "仪表盘", icon: LayoutDashboard, end: true },
  { to: "/pipelines", label: "同步任务", icon: Workflow, end: false },
  { to: "/matrix", label: "活动矩阵", icon: Grid3X3, end: false },
  { to: "/fit", label: "FIT 解析", icon: FileUp, end: false },
  { to: "/accounts", label: "账号", icon: Activity, end: false },
  { to: "/logs", label: "日志", icon: ScrollText, end: false },
  { to: "/settings", label: "设置", icon: Settings, end: false },
];

export default function Sidebar() {
  const width = useUiStore((s) => s.sidebarWidth);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const displayName = user?.nickname || user?.username || "未登录";
  const initial = displayName.slice(0, 1).toUpperCase();

  const doLogout = () => {
    setConfirmOpen(false);
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <aside
      className="flex shrink-0 flex-col border-r border-slate-200 bg-white"
      style={{ width: collapsed ? 56 : width }}
    >
      <div className="flex h-14 items-center gap-2 border-b border-slate-100 px-3">
        <BrandMark className="h-8 w-8 shrink-0" />
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-800">VeloSync</div>
            <div className="truncate text-[10px] text-slate-400">速同 · 数据同步中枢</div>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={label}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                collapsed ? "justify-center px-0" : ""
              } ${
                isActive
                  ? "bg-indigo-50 font-medium text-indigo-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-100 p-2">
        {collapsed ? (
          <button
            onClick={() => setConfirmOpen(true)}
            title={`退出登录（${displayName}）`}
            className="flex w-full items-center justify-center rounded-lg py-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
          >
            <LogOut className="h-4 w-4" />
          </button>
        ) : (
          <div className="flex items-center gap-2 rounded-lg px-1.5 py-1.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-slate-700" title={displayName}>
                {displayName}
              </div>
              <div className="truncate text-[10px] text-slate-400" title={user?.email ?? ""}>
                {user?.email || "已登录"}
              </div>
            </div>
            <button
              onClick={() => setConfirmOpen(true)}
              title="退出登录"
              className="shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <button
        onClick={toggle}
        className="flex items-center justify-center border-t border-slate-100 py-2.5 text-slate-400 hover:text-slate-700"
        title={collapsed ? "展开导航栏" : "折叠导航栏"}
      >
        {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </button>

      <ConfirmDialog
        open={confirmOpen}
        title="退出登录"
        confirmText="退出登录"
        danger
        onConfirm={doLogout}
        onCancel={() => setConfirmOpen(false)}
      >
        退出后需要重新登录才能进入工作台，本地保存的登录凭证将被清除。
      </ConfirmDialog>
    </aside>
  );
}
