import { X } from "lucide-react";
import { Link } from "react-router-dom";
import { useUiStore } from "../../stores/uiStore";
import { useActivity, useFitDetail } from "../../api/queries";
import { StatusIcon, statusLabel } from "../StatusIcon";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} 时 ${m} 分` : `${m} 分`;
}

export default function ContextPanel() {
  const context = useUiStore((s) => s.context);
  const setContext = useUiStore((s) => s.setContext);
  const isActivity = context.type === "activity";
  const { data: activity } = useActivity(isActivity ? Number(context.id) : null);
  const { data: fit } = useFitDetail(isActivity ? Number(context.id) : null);

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex h-14 items-center justify-between border-b border-slate-100 px-4">
        <span className="text-sm font-semibold text-slate-700">详情面板</span>
        <button
          onClick={() => setContext({ type: null })}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {isActivity && activity && (
          <>
            <div>
              <h3 className="text-base font-semibold text-slate-800">{activity.name}</h3>
              <p className="mt-1 text-xs text-slate-500">
                {new Date(activity.start_timestamp).toLocaleString("zh-CN")}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
              <div>
                <dt className="text-xs text-slate-400">运动类型</dt>
                <dd className="mt-0.5 font-medium">{activity.activity_type}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">距离</dt>
                <dd className="mt-0.5 font-medium">{activity.distance} km</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">时长</dt>
                <dd className="mt-0.5 font-medium">{formatDuration(activity.duration)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">来源平台</dt>
                <dd className="mt-0.5 font-medium">{activity.source_platform}</dd>
              </div>
            </dl>
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                各平台同步状态
              </h4>
              <ul className="space-y-2">
                {(activity.sync_states ?? []).map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <StatusIcon status={s.status} />
                      {s.platform_name}
                    </span>
                    <span className="text-xs text-slate-400">{statusLabel(s.status)}</span>
                  </li>
                ))}
              </ul>
            </div>
            {fit && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  FIT 解析详情
                </h4>
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 text-xs text-slate-600">
                  <p>
                    距离 {fit.summary.distance_km} km · 爬升 {fit.summary.total_ascent ?? "-"} m · NP{" "}
                    {fit.summary.normalized_power ?? "-"} W
                  </p>
                  <p className="mt-0.5">
                    心率 {fit.summary.avg_heart_rate ?? "-"}/{fit.summary.max_heart_rate ?? "-"} bpm · 功率{" "}
                    {fit.summary.avg_power ?? "-"}/{fit.summary.max_power ?? "-"} W
                  </p>
                  <Link
                    to={`/fit?activity=${activity?.id}`}
                    className="mt-2 inline-block text-indigo-600 hover:underline"
                  >
                    查看曲线与轨迹 →
                  </Link>
                </div>
              </div>
            )}
            {activity?.fit_hash && (
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  FIT 哈希
                </h4>
                <p className="break-all rounded bg-slate-50 p-2 font-mono text-[10px] text-slate-500">
                  {activity.fit_hash}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
