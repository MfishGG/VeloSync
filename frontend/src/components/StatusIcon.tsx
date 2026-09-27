import { CheckCircle2, CircleDashed, Minus, XCircle } from "lucide-react";

export function StatusIcon({ status }: { status?: string }) {
  if (status === "synced") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-500" />;
  if (status === "pending") return <CircleDashed className="h-4 w-4 text-amber-500" />;
  return <Minus className="h-4 w-4 text-slate-300" />;
}

export function statusLabel(status?: string): string {
  switch (status) {
    case "synced":
      return "已同步";
    case "pending":
      return "待同步";
    case "failed":
      return "失败";
    default:
      return "不适用";
  }
}
