import { useRef } from "react";
import { Outlet } from "react-router-dom";
import { useUiStore } from "../../stores/uiStore";
import CommandPalette from "../CommandPalette";
import ContextPanel from "./ContextPanel";
import Sidebar from "./Sidebar";

export default function AppShell() {
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth);
  const contextType = useUiStore((s) => s.context.type);
  const dragging = useRef(false);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    const move = (ev: PointerEvent) => {
      if (dragging.current) setSidebarWidth(ev.clientX);
    };
    const up = () => {
      dragging.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {!collapsed && (
        <>
          <Sidebar />
          <div
            onPointerDown={startDrag}
            className="w-1 shrink-0 cursor-col-resize bg-slate-200 transition-colors hover:bg-indigo-400"
            title="拖拽调整宽度"
          />
        </>
      )}
      {collapsed && <Sidebar />}

      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>

      {contextType != null && <ContextPanel />}
      <CommandPalette />
    </div>
  );
}
