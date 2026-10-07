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
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { deleteFit, uploadFit, useFitDetail, useFitHistory } from "../api/queries";
import type { FitDetail, FitHistoryItem } from "../api/types";
import { isAMapConfigured } from "../utils/amap";
import { fmtClock, fmtDuration } from "../utils/format";
import AmapTrackPlayer from "../components/AmapTrackPlayer";
import ConfirmDialog from "../components/ConfirmDialog";

const TYPE_LABEL: Record<string, string> = {
  cycling: "骑行",
  running: "跑步",
  swimming: "游泳",
  hiking: "徒步",
};

type Axis = "time" | "distance";

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

  const series = useMemo(
    () =>
      (detail?.samples ?? []).map((s) => ({
        t: s.t ?? 0,
        d: s.distance_km ?? 0,
        heart_rate: s.heart_rate,
        power: s.power,
        speed: s.speed_kmh,
        altitude: s.altitude,
        cadence: s.cadence,
      })),
    [detail],
  );

  const bounds = useMemo(() => {
    if (!series.length) return { maxT: 0, maxD: 0 };
    return {
      maxT: Math.max(...series.map((s) => s.t)),
      maxD: Math.max(...series.map((s) => s.d)),
    };
  }, [series]);

  const axisProps = useMemo(
    () =>
      axis === "time"
        ? {
            dataKey: "t",
            type: "number" as const,
            domain: [0, bounds.maxT] as [number, number],
            tickFormatter: (v: number) => fmtClock(v),
            label: "时长",
          }
        : {
            dataKey: "d",
            type: "number" as const,
            domain: [0, bounds.maxD] as [number, number],
            tickFormatter: (v: number) => `${Number(v).toFixed(1)}`,
            label: "里程 km",
          },
    [axis, bounds],
  );

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
          上传 .fit 文件查看完整运动数据：汇总指标、心率/功率曲线（可切换时间或距离维度）、海拔剖面与 GPS 轨迹回放
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
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">横轴维度</span>
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
            <p className="text-[11px] text-slate-400">
              鼠标移到曲线上可同步定位地图上的当前位置 · 共 {series.length} 个采样点
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">
                心率与功率
                <span className="ml-2 text-[11px] font-normal text-slate-400">
                  （{axis === "time" ? "时间" : "距离"}轴）
                </span>
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart
                  data={series}
                  margin={{ top: 5, right: 10, left: -18, bottom: 0 }}
                  onMouseMove={(state: any) => {
                    const i = state?.activeTooltipIndex;
                    if (typeof i === "number") setHoverIndex(i);
                  }}
                  onMouseLeave={() => setHoverIndex(null)}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis {...axisProps} tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={28} />
                  <YAxis yAxisId="hr" tick={{ fontSize: 10 }} domain={[60, "dataMax + 10"]} />
                  <YAxis yAxisId="pw" orientation="right" tick={{ fontSize: 10 }} />
                  <Tooltip labelFormatter={labelFormatter} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    yAxisId="hr"
                    type="monotone"
                    dataKey="heart_rate"
                    name="心率 bpm"
                    stroke="#ef4444"
                    dot={false}
                    strokeWidth={1.6}
                  />
                  <Line
                    yAxisId="pw"
                    type="monotone"
                    dataKey="power"
                    name="功率 W"
                    stroke="#f59e0b"
                    dot={false}
                    strokeWidth={1.6}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">
                速度与海拔
                <span className="ml-2 text-[11px] font-normal text-slate-400">
                  （{axis === "time" ? "时间" : "距离"}轴）
                </span>
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart
                  data={series}
                  margin={{ top: 5, right: 10, left: -18, bottom: 0 }}
                  onMouseMove={(state: any) => {
                    const i = state?.activeTooltipIndex;
                    if (typeof i === "number") setHoverIndex(i);
                  }}
                  onMouseLeave={() => setHoverIndex(null)}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis {...axisProps} tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={28} />
                  <YAxis yAxisId="sp" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="al" orientation="right" tick={{ fontSize: 10 }} />
                  <Tooltip labelFormatter={labelFormatter} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area
                    yAxisId="al"
                    type="monotone"
                    dataKey="altitude"
                    name="海拔 m"
                    fill="#e0e7ff"
                    stroke="#6366f1"
                    strokeWidth={1}
                  />
                  <Line
                    yAxisId="sp"
                    type="monotone"
                    dataKey="speed"
                    name="速度 km/h"
                    stroke="#0ea5e9"
                    dot={false}
                    strokeWidth={1.6}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

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
