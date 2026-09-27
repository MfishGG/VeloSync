import { Handle, Position, type NodeProps } from "reactflow";
import { ArrowDownToLine, Filter, Upload } from "lucide-react";
import type { VeloNodeData } from "./types";

const META: Record<VeloNodeData["nodeType"], { label: string; icon: typeof Filter; bg: string; text: string }> = {
  source: { label: "源 · 拉取活动", icon: ArrowDownToLine, bg: "bg-blue-50", text: "text-blue-600" },
  filter: { label: "过滤器", icon: Filter, bg: "bg-amber-50", text: "text-amber-600" },
  target: { label: "目标 · 上传", icon: Upload, bg: "bg-emerald-50", text: "text-emerald-600" },
};

const STATUS_RING: Record<string, string> = {
  running: "ring-2 ring-blue-400 animate-pulse",
  done: "ring-2 ring-emerald-400",
  error: "ring-2 ring-red-400",
};

export default function VeloNode({ data, selected }: NodeProps<VeloNodeData>) {
  const meta = META[data.nodeType];
  const Icon = meta.icon;
  return (
    <div
      className={`w-44 rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 shadow-sm transition-shadow ${
        selected ? "ring-2 ring-indigo-400" : ""
      } ${STATUS_RING[data.status ?? ""] ?? ""}`}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-slate-400" />
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${meta.bg} ${meta.text}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-slate-700">{meta.label}</div>
          <div className="truncate text-[10px] text-slate-400">
            {data.accountName ?? (data.nodeType === "filter" ? filterSummary(data.config) : "未选择账号")}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-slate-400" />
    </div>
  );
}

function filterSummary(config: Record<string, unknown>): string {
  const type = config.filter_type as string | undefined;
  if (type === "by_sport") return `按类型：${config.sport ?? "全部"}`;
  if (type === "by_distance") {
    const min = config.min_distance != null ? `≥${config.min_distance}km` : "";
    const max = config.max_distance != null ? `≤${config.max_distance}km` : "";
    return `按距离 ${min || max || "全部"}`;
  }
  if (type === "by_date_range") return "按日期范围";
  return "未配置规则";
}
