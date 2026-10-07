import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Activity as ActivityIcon,
  Eye,
  FileUp,
  History,
  Loader2,
  MapPin,
  Trash2,
  Upload,
} from "lucide-react";
import { deleteFit, uploadFit, useFitDetail, useFitHistory } from "../api/queries";
import type { FitDetail, FitHistoryItem, FitMetricStats } from "../api/types";
import { isAMapConfigured } from "../utils/amap";
import { fmtClock, fmtDuration } from "../utils/format";
import AmapTrackPlayer from "../components/AmapTrackPlayer";
import ConfirmDialog from "../components/ConfirmDialog";
import FitMetricChart, { type ChartAxis } from "../components/FitMetricChart";
import { FIT_METRICS, defaultOverlayKeys, type MetricDef } from "../utils/fitMetrics";

const TYPE_LABEL: Record<string, string> = {
  cycling: "骑行",
  running: "跑步",
  swimming: "游泳",
  hiking: "徒步",
};

type Axis = "time" | "distance";
/** split = 每个指标占一行；overlay = 多个指标叠在一张图 */
type ChartMode = "split" | "overlay";

function Metric({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-700">
        {value}
        {unit && <span className="ml-0.5 text-[11px] font-normal text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}

/** 未配置高德 Key 时的降级视图：SVG 画出 GPS 轨迹（归一化到画布，保留长宽比） */
function TrackView({ track }: { track: [number, number][] }) {
  if (track.length < 2) return null;
  const lngs = track.map((p) => p[0]);
  const lats = track.map((p) => p[1]);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const spanLng = maxLng - minLng || 1e-6;
  const spanLat = maxLat - minLat || 1e-6;
  const W = 640;
  const H = 320;
  const pad = 14;
  const scale = Math.min((W - pad * 2) / spanLng, (H - pad * 2) / spanLat);
  const offX = (W - spanLng * scale) / 2;
  const offY = (H - spanLat * scale) / 2;
  const project = (p: [number, number]) => [
    offX + (p[0] - minLng) * scale,
    H - offY - (p[1] - minLat) * scale, // 纬度越大越靠上
  ];
  const path = track
    .map((p, i) => `${i === 0 ? "M" : "L"}${project(p)[0].toFixed(1)},${project(p)[1].toFixed(1)}`)
    .join(" ");
  const start = project(track[0]);
  const end = project(track[track.length - 1]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-72 w-full">
      <rect x="0" y="0" width={W} height={H} rx="8" fill="#f8fafc" />
      <path d={path} fill="none" stroke="#4f46e5" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={start[0]} cy={start[1]} r={4} fill="#10b981" />
      <circle cx={end[0]} cy={end[1]} r={4} fill="#ef4444" />
      <text x="10" y="16" fontSize="10" fill="#94a3b8">
        起点
      </text>
      <text x={W - 34} y="16" fontSize="10" fill="#94a3b8">
        终点
      </text>
    </svg>
  );
}

export default function FitPage() {
  const [params, setParams] = useSearchParams();
  const activityId = Number(params.get("activity") || 0) || null;
  const { data: queried, isFetching } = useFitDetail(activityId);
  const [uploaded, setUploaded] = useState<FitDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [axis, setAxis] = useState<Axis>("time");
  const [chartMode, setChartMode] = useState<ChartMode>("split");
  const [showEmpty, setShowEmpty] = useState(true);
  const [overlayKeys, setOverlayKeys] = useState<string[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FitHistoryItem | null>(null);
  const [withActivity, setWithActivity] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const showNotice = (text: string) => {
    setNotice(text);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3200);
  };

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const historyQuery = useFitHistory();
  const history = historyQuery.data ?? [];

  const upload = useMutation({
    mutationFn: (vars: { file: File; name?: string }) => uploadFit(vars.file, vars.name),
    onSuccess: (res) => {
      setUploaded(res.detail);
      setError(null);
      setParams({ activity: String(res.activity.id) }, { replace: true });
      void historyQuery.refetch();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "解析失败"),
  });

  const remove = useMutation({
    mutationFn: (vars: { activityId: number; withActivity: boolean }) =>
      deleteFit(vars.activityId, vars.withActivity),
    onSuccess: (_data, vars) => {
      setPendingDelete(null);
      setError(null);
      // 删的正是当前查看的活动时，清掉展示与 URL 上的 activity 参数
      if (activityId === vars.activityId) {
        setUploaded(null);
        setParams({}, { replace: true });
      }
      void historyQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["matrix"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["activities"] });
      void queryClient.invalidateQueries({ queryKey: ["fit"] });
      showNotice(
        vars.withActivity
          ? "已删除该条导入记录及其活动（同步矩阵中的对应行已移除）"
          : "已删除该条 FIT 解析记录（活动本身保留）",
      );
    },
    onError: (err) => {
      setPendingDelete(null);
      setError(err instanceof Error ? err.message : "删除失败");
    },
  });

  // 以"本次上传结果"优先，其次是按 activity 查询到的详情
  const detail = uploaded ?? queried ?? null;

  const series = useMemo<Array<Record<string, unknown>>>(
    () =>
      (detail?.samples ?? []).map((s) => ({ ...s, d: s.distance_km ?? 0 }) as Record<string, unknown>),
    [detail],
  );

  // 全部指标的统计（后端预留 15 个槽位，没有数据的 count=0）
  // 旧记录（本次改动前解析的）没有 summary.metrics，退化为从采样点现算，避免误判成"无数据"
  const stats = useMemo<Record<string, FitMetricStats>>(() => {
    if (detail?.summary.metrics) return detail.summary.metrics;
    const fallback: Record<string, FitMetricStats> = {};
    for (const m of FIT_METRICS) {
      const vals = series
        .map((row) => row[m.key])
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      fallback[m.key] = vals.length
        ? {
            count: vals.length,
            avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10,
            max: Math.round(Math.max(...vals) * 10) / 10,
            min: Math.round(Math.min(...vals) * 10) / 10,
          }
        : { count: 0, avg: null, max: null, min: null };
    }
    return fallback;
  }, [detail, series]);

  const available = useMemo(
    () =>
      detail?.summary.available_metrics ??
      FIT_METRICS.filter((m) => (stats[m.key]?.count ?? 0) > 0).map((m) => m.key),
    [detail, stats],
  );
  const hasMetric = (m: MetricDef) => (stats[m.key]?.count ?? 0) > 0;

  // 切换活动时重置叠加选择（默认勾选有数据的核心指标）
  const detailKey = detail?.activity ?? 0;
  useEffect(() => {
    setOverlayKeys(defaultOverlayKeys(detail?.summary.available_metrics));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailKey]);

  const toggleOverlay = (key: string) =>
    setOverlayKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const bounds = useMemo(() => {
    const rows = detail?.samples ?? [];
    if (!rows.length) return { maxT: 0, maxD: 0 };
    return {
      maxT: Math.max(...rows.map((s) => s.t ?? 0)),
      maxD: Math.max(...rows.map((s) => s.distance_km ?? 0)),
    };
  }, [detail]);

  const axisProps = useMemo<ChartAxis>(
    () =>
      axis === "time"
        ? {
            dataKey: "t",
            type: "number",
            domain: [0, bounds.maxT],
            tickFormatter: (v: number) => fmtClock(v),
          }
        : {
            dataKey: "d",
            type: "number",
            domain: [0, bounds.maxD],
            tickFormatter: (v: number) => `${Number(v).toFixed(1)}`,
          },
    [axis, bounds],
  );
  const axisLabel = axis === "time" ? "时间" : "距离";

  const labelFormatter = (v: number) =>
    axis === "time" ? `时间 ${fmtClock(v)}` : `里程 ${Number(v).toFixed(2)} km`;

  const send = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".fit")) {
      setError("请选择 .fit 文件");
      return;
    }
    upload.mutate({ file });
  };

  const hasMap = isAMapConfigured();
  const splitDefs = showEmpty ? FIT_METRICS : FIT_METRICS.filter(hasMetric);
  const overlayDefs = FIT_METRICS.filter((m) => overlayKeys.includes(m.key));
  const gpsCount = detail?.track.length ?? 0;
  const rawGps = detail?.summary.raw_track_count ?? gpsCount;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
          <FileUp className="h-5 w-5 text-indigo-600" />
          FIT 文件解析
        </h1>
        <p className="mt-1 text-xs text-slate-400">
          上传 .fit 文件查看完整运动数据：汇总指标、15 类指标曲线（可切换时间或距离维度、可叠加对比）、海拔剖面与
          GPS 轨迹回放；文件里没有的指标会保留空白图位
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) send(file);
        }}
        className={`mb-6 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
          dragging ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-slate-50"
        }`}
      >
        <Upload className="mb-2 h-6 w-6 text-slate-400" />
        <p className="text-sm text-slate-500">把 .fit 文件拖到这里，或</p>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
          className="mt-3 flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {upload.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          选择文件并解析
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".fit"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) send(file);
            e.target.value = "";
          }}
        />
        <p className="mt-3 text-[11px] text-slate-400">
          没有真实文件？在项目根目录跑
          <code className="mx-1 rounded bg-slate-200 px-1 py-0.5">python backend/tools/make_sample_fit.py</code>
          生成一份样例
        </p>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
      {notice && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</p>}

      <div className="mb-6 rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <History className="h-4 w-4 text-indigo-600" />
            导入历史
            <span className="text-[11px] font-normal text-slate-400">
              {historyQuery.isFetching ? "加载中…" : `共 ${history.length} 条`}
            </span>
          </h2>
          <button
            onClick={() => void historyQuery.refetch()}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-50"
          >
            刷新
          </button>
        </div>

        {history.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-slate-400">
            还没有导入记录 —— 上传一个 .fit 文件后会出现在这里
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-slate-400">
                  <th className="px-5 py-2 font-normal">活动</th>
                  <th className="px-3 py-2 font-normal">开始时间</th>
                  <th className="px-3 py-2 font-normal">距离</th>
                  <th className="px-3 py-2 font-normal">时长</th>
                  <th className="px-3 py-2 font-normal">文件</th>
                  <th className="px-3 py-2 font-normal">点位</th>
                  <th className="px-3 py-2 font-normal">导入时间</th>
                  <th className="px-5 py-2 text-right font-normal">操作</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr
                    key={item.id}
                    className={`border-t border-slate-50 transition ${
                      item.activity_id === activityId ? "bg-indigo-50/60" : "hover:bg-slate-50"
                    }`}
                  >
                    <td className="max-w-[180px] truncate px-5 py-2.5 text-slate-700">
                      {item.activity_name}
                      <span className="ml-1.5 text-[11px] text-slate-400">
                        {TYPE_LABEL[item.activity_type] ?? item.activity_type}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">
                      {new Date(item.start_timestamp).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{item.distance} km</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">
                      {fmtDuration(item.duration)}
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-2.5 font-mono text-[11px] text-slate-400">
                      {item.file_name || "-"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">
                      {item.sample_count}
                      {item.has_gps ? ` / GPS ${item.track_point_count}` : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-400">
                      {new Date(item.parsed_at).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-right">
                      <button
                        onClick={() => {
                          setUploaded(null);
                          setParams({ activity: String(item.activity_id) }, { replace: true });
                        }}
                        title="查看解析详情"
                        className="mr-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-indigo-600 hover:bg-indigo-50"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        查看
                      </button>
                      <button
                        onClick={() => {
                          setPendingDelete(item);
                          setWithActivity(false);
                        }}
                        title="删除这条导入记录"
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-red-500 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!detail && !isFetching && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          暂无解析结果 —— 上传一个 FIT 文件，或从活动详情面板选择已解析的活动
        </div>
      )}

      {isFetching && !detail && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-10 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载解析详情…
        </div>
      )}

      {detail && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
                <ActivityIcon className="h-4 w-4 text-indigo-600" />
                {TYPE_LABEL[detail.summary.activity_type] ?? detail.summary.activity_type ?? "运动"} ·{" "}
                {detail.summary.distance_km} km
              </h2>
              <span className="text-[11px] text-slate-400">
                {detail.file_name} · {(detail.file_size / 1024).toFixed(1)} KB ·{" "}
                {detail.summary.raw_record_count} 个原始采样点
                {rawGps ? ` · GPS ${gpsCount}/${rawGps} 点` : ""}
                {detail.summary.downsampled ? "（超长已抽稀）" : ""}
                {detail.device.manufacturer ? ` · 设备 ${detail.device.manufacturer}` : ""}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="总距离" value={detail.summary.distance_km} unit="km" />
              <Metric label="总时长" value={fmtDuration(detail.summary.duration)} />
              <Metric label="累计爬升" value={detail.summary.total_ascent ?? "-"} unit="m" />
              <Metric label="累计下降" value={detail.summary.total_descent ?? "-"} unit="m" />
              <Metric label="消耗" value={detail.summary.calories ?? "-"} unit="kcal" />
              <Metric label="平均心率" value={detail.summary.avg_heart_rate ?? "-"} unit="bpm" />
              <Metric label="最大心率" value={detail.summary.max_heart_rate ?? "-"} unit="bpm" />
              <Metric label="平均功率" value={detail.summary.avg_power ?? "-"} unit="W" />
              <Metric label="最大功率" value={detail.summary.max_power ?? "-"} unit="W" />
              <Metric label="标准化功率 NP" value={detail.summary.normalized_power ?? "-"} unit="W" />
              <Metric label="平均踏频" value={detail.summary.avg_cadence ?? "-"} unit="rpm" />
              <Metric label="平均速度" value={detail.summary.avg_speed_kmh ?? "-"} unit="km/h" />
              {detail.summary.avg_temperature != null && (
                <Metric label="平均温度" value={detail.summary.avg_temperature} unit="°C" />
              )}
              {detail.summary.avg_grade != null && (
                <Metric label="平均坡度" value={detail.summary.avg_grade} unit="%" />
              )}
              {detail.summary.threshold_power != null && (
                <Metric label="功率阈值 FTP" value={detail.summary.threshold_power} unit="W" />
              )}
              {detail.summary.training_stress_score != null && (
                <Metric label="训练负荷 TSS" value={detail.summary.training_stress_score} />
              )}
              {detail.summary.intensity_factor != null && (
                <Metric label="强度因子 IF" value={detail.summary.intensity_factor} />
              )}
              {detail.summary.total_training_effect != null && (
                <Metric label="训练效果 TE" value={detail.summary.total_training_effect} />
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">横轴</span>
                <div className="flex rounded-lg bg-slate-100 p-0.5">
                  {(
                    [
                      ["time", "按时间"],
                      ["distance", "按距离"],
                    ] as [Axis, string][]
                  ).map(([key, text]) => (
                    <button
                      key={key}
                      onClick={() => setAxis(key)}
                      className={`rounded-md px-3 py-1 text-xs transition ${
                        axis === key
                          ? "bg-white font-medium text-indigo-600 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">图表</span>
                <div className="flex rounded-lg bg-slate-100 p-0.5">
                  {(
                    [
                      ["split", "分指标"],
                      ["overlay", "叠加"],
                    ] as [ChartMode, string][]
                  ).map(([key, text]) => (
                    <button
                      key={key}
                      onClick={() => setChartMode(key)}
                      className={`rounded-md px-3 py-1 text-xs transition ${
                        chartMode === key
                          ? "bg-white font-medium text-indigo-600 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
                <input
                  type="checkbox"
                  checked={showEmpty}
                  onChange={(e) => setShowEmpty(e.target.checked)}
                  className="h-3.5 w-3.5 accent-indigo-600"
                />
                显示无数据指标
              </label>
            </div>
            <p className="text-[11px] text-slate-400">
              鼠标移到曲线上可同步定位地图上的当前位置 · 共 {series.length} 个采样点 · 本文件含{" "}
              {available.length}/{FIT_METRICS.length} 项指标
            </p>
          </div>

          {chartMode === "split" ? (
            <div className="space-y-5">
              {splitDefs.map((d) => (
                <FitMetricChart
                  key={d.key}
                  title={`${d.label}（${d.unit}）`}
                  defs={[d]}
                  data={series}
                  axis={axisProps}
                  axisLabel={axisLabel}
                  labelFormatter={labelFormatter}
                  stats={stats}
                  onHover={setHoverIndex}
                  badge={hasMetric(d) ? d.group : "预留 · 无数据"}
                />
              ))}
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-400">叠加指标</span>
                  {FIT_METRICS.map((m) => {
                    const on = overlayKeys.includes(m.key);
                    return (
                      <button
                        key={m.key}
                        onClick={() => toggleOverlay(m.key)}
                        title={`${m.group}${hasMetric(m) ? "" : "（本文件未记录，叠加后不会画线）"}`}
                        className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                          on
                            ? "border-transparent text-white"
                            : "border-slate-200 text-slate-500 hover:bg-slate-50"
                        }`}
                        style={on ? { backgroundColor: m.color } : undefined}
                      >
                        {m.label}
                        {!hasMetric(m) && (
                          <span className={on ? "ml-1 opacity-70" : "ml-1 text-slate-300"}>空</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  每项一条独立纵轴：左侧第一项、右侧第二项，其余隐藏刻度但比例正确。带「空」的表示本文件未记录该指标。
                </p>
              </div>

              {overlayDefs.length > 0 ? (
                <FitMetricChart
                  title="多指标叠加"
                  defs={overlayDefs}
                  data={series}
                  axis={axisProps}
                  axisLabel={axisLabel}
                  labelFormatter={labelFormatter}
                  stats={stats}
                  onHover={setHoverIndex}
                  height={340}
                  badge={`${overlayDefs.length} 项`}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-8 text-center text-xs text-slate-400">
                  至少选择一个指标才会绘制叠加图
                </div>
              )}
            </>
          )}

          {detail.summary.has_gps && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <MapPin className="h-4 w-4 text-indigo-600" />
                GPS 轨迹回放（{gpsCount} 点）
              </h3>
              {hasMap ? (
                <AmapTrackPlayer samples={detail.samples} externalIndex={hoverIndex} />
              ) : (
                <>
                  <TrackView track={detail.track} />
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
                    当前为内置简图。配置高德地图 Key 可启用卫星/路网底图与轨迹回放：在{" "}
                    <code className="rounded bg-amber-100 px-1">frontend/.env</code> 写入{" "}
                    <code className="rounded bg-amber-100 px-1">VITE_AMAP_KEY</code> 与{" "}
                    <code className="rounded bg-amber-100 px-1">VITE_AMAP_SECURITY_CODE</code> 后重启
                    dev server。
                  </p>
                </>
              )}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">文件信息</h3>
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              <div className="flex justify-between rounded bg-slate-50 px-3 py-2">
                <dt className="text-slate-400">SHA256</dt>
                <dd className="font-mono text-slate-600">{detail.file_hash.slice(0, 24)}…</dd>
              </div>
              <div className="flex justify-between rounded bg-slate-50 px-3 py-2">
                <dt className="text-slate-400">解析时间</dt>
                <dd className="text-slate-600">{new Date(detail.parsed_at).toLocaleString("zh-CN")}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        title="删除这条 FIT 导入记录？"
        confirmText={remove.isPending ? "删除中…" : "确认删除"}
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          remove.mutate({ activityId: pendingDelete.activity_id, withActivity });
        }}
      >
        {pendingDelete && (
          <>
            <p className="rounded-md bg-slate-50 px-3 py-2 text-slate-600">
              <span className="font-medium text-slate-700">{pendingDelete.activity_name}</span>
              <br />
              {pendingDelete.file_name || "（无文件名）"} · {pendingDelete.distance} km ·{" "}
              {fmtDuration(pendingDelete.duration)} · {pendingDelete.sample_count} 个采样点
            </p>
            <p className="mt-2">删除后将无法查看该文件的曲线与轨迹，需要重新上传才能再次解析。</p>
            <label className="mt-3 flex items-start gap-2 rounded-md border border-slate-200 px-3 py-2">
              <input
                type="checkbox"
                checked={withActivity}
                onChange={(e) => setWithActivity(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-red-600"
              />
              <span>
                同时删除活动记录
                <span className="block text-[11px] text-slate-400">
                  勾选后该活动会从活动矩阵、仪表盘统计中一并移除（不可恢复）
                </span>
              </span>
            </label>
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
