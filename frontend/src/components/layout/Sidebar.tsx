import { NavLink } from "react-router-dom";
import {
  Activity,
  Grid3X3,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings,
  Workflow,
} from "lucide-react";
import { useUiStore } from "../../stores/uiStore";

const NAV = [
  { to: "/", label: "仪表盘", icon: LayoutDashboard, end: true },
  { to: "/pipelines", label: "管道", icon: Workflow, end: false },
  { to: "/matrix", label: "活动矩阵", icon: Grid3X3, end: false },
  { to: "/accounts", label: "账号", icon: Activity, end: false },
  { to: "/logs", label: "日志", icon: ScrollText, end: false },
  { to: "/settings", label: "设置", icon: Settings, end: false },
];

export default function Sidebar() {
  const width = useUiStore((s) => s.sidebarWidth);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);

  return (
    <aside
      className="flex shrink-0 flex-col border-r border-slate-200 bg-white"
      style={{ width: collapsed ? 56 : width }}
    >
      <div className="flex h-14 items-center gap-2 border-b border-slate-100 px-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
          VS
        </div>
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

      <button
        onClick={toggle}
        className="flex items-center justify-center border-t border-slate-100 py-2.5 text-slate-400 hover:text-slate-700"
        title={collapsed ? "展开导航栏" : "折叠导航栏"}
      >
        {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </button>
    </aside>
  );
}
