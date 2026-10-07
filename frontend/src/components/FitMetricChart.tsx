import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FitMetricStats } from "../api/types";
import type { MetricDef } from "../utils/fitMetrics";

export interface ChartAxis {
  dataKey: string;
  type: "number";
  domain: [number, number];
  tickFormatter: (v: number) => string;
}

interface Props {
  title: string;
  /** 1 个 = 单指标独占一行；多个 = 叠加在同一张图 */
  defs: MetricDef[];
  data: Array<Record<string, unknown>>;
  axis: ChartAxis;
  axisLabel: string;
  labelFormatter: (v: number) => string;
  stats: Record<string, FitMetricStats>;
  onHover: (index: number | null) => void;
  height?: number;
  /** 右上角小标记，如「预留」「无数据」 */
  badge?: string;
}

/** 单个指标（或叠加多个指标）的曲线卡片；无数据时画空白图而不是隐藏卡片 */
export default function FitMetricChart({
  title,
  defs,
  data,
  axis,
  axisLabel,
  labelFormatter,
  stats,
  onHover,
  height = 220,
  badge,
}: Props) {
  const hasData = (d: MetricDef) => (stats[d.key]?.count ?? 0) > 0;
  const empty = defs.every((d) => !hasData(d));
  // 完全没有数据时传空数组，避免 Recharts 用 [0,1] 兜底出奇怪的刻度
  const rows = empty ? [] : data;

  const single = defs.length === 1 ? defs[0] : null;
  const stat = single ? stats[single.key] : undefined;
  const subtitle = single
    ? hasData(single)
      ? `${axisLabel}轴 · 平均 ${stat?.avg ?? "-"} ${single.unit} · 峰值 ${stat?.max ?? "-"} ${single.unit}`
      : `${axisLabel}轴 · 暂无数据`
    : `${axisLabel}轴 · 已叠加 ${defs.length} 项指标`;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          {title}
          <span className="text-[11px] font-normal text-slate-400">{subtitle}</span>
        </h3>
        {badge && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-400">{badge}</span>
        )}
      </div>

      <div className="relative">
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            data={rows}
            margin={{ top: 5, right: 12, left: -18, bottom: 0 }}
            onMouseMove={(state: any) => {
              const i = state?.activeTooltipIndex;
              if (typeof i === "number") onHover(i);
            }}
            onMouseLeave={() => onHover(null)}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis {...axis} tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={28} />
            {defs.map((d, i) => (
              <YAxis
                key={d.key}
                yAxisId={d.key}
                orientation={i === 0 ? "left" : "right"}
                hide={i >= 2}
                domain={hasData(d) ? undefined : d.blank}
                tick={{ fontSize: 10, fill: defs.length > 1 ? d.color : "#94a3b8" }}
                width={i === 0 ? 44 : 40}
              />
            ))}
            <Tooltip
              labelFormatter={labelFormatter}
              formatter={(value: unknown, name: unknown) => {
                const def = defs.find((d) => d.label === name);
                if (value == null) return ["—", String(name)];
                return [`${value} ${def?.unit ?? ""}`, String(name)];
              }}
            />
            {defs.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {single && hasData(single) && stat?.avg != null && (
              <ReferenceLine
                yAxisId={single.key}
                y={stat.avg}
                stroke={single.color}
                strokeDasharray="4 4"
                strokeOpacity={0.55}
                label={{
                  value: `平均 ${stat.avg} ${single.unit}`,
                  fontSize: 10,
                  fill: single.color,
                  position: "insideTopRight",
                }}
              />
            )}
            {defs.map((d, i) =>
              d.kind === "area" ? (
                <Area
                  key={d.key}
                  yAxisId={d.key}
                  type="monotone"
                  dataKey={d.key}
                  name={d.label}
                  stroke={d.color}
                  fill={defs.length > 1 ? "none" : d.fill}
                  fillOpacity={defs.length > 1 ? 0 : 0.5}
                  strokeWidth={1.6}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={d.key}
                  yAxisId={d.key}
                  type={i === 0 ? "monotone" : "monotone"}
                  dataKey={d.key}
                  name={d.label}
                  stroke={d.color}
                  strokeWidth={1.6}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>

        {empty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded-md bg-white/85 px-3 py-1.5 text-xs text-slate-400">
              该 FIT 文件未记录此项 —— 设备或运动类型不支持
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
