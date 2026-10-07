import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Pause, Play, RotateCcw } from "lucide-react";
import type { FitSample } from "../api/types";
import { wgs84ToGcj02 } from "../utils/coords";
import { loadAMap } from "../utils/amap";
import { fmtClock, fmtNum } from "../utils/format";

const SPEEDS = [1, 2, 4, 8, 16, 32];

/** 在升序数组中找最后一个 <= target 的下标 */
function lowerBound(arr: number[], target: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

interface Props {
  samples: FitSample[];
  /** 外部联动索引（图表 hover 时传入的 samples 下标）；为 null 时地图自主回放 */
  externalIndex?: number | null;
  height?: number;
}

export default function AmapTrackPlayer({ samples, externalIndex = null, height = 420 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const passedLineRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const passedPathRef = useRef<[number, number][]>([]);
  const indexRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(8);

  /** 抽取出含 GPS 的点，并转 GCJ-02（高德坐标系） */
  const geo = useMemo(() => {
    const srcIdx: number[] = [];
    const path: [number, number][] = [];
    const times: number[] = [];
    samples.forEach((s, i) => {
      if (s.lat == null || s.lng == null) return;
      srcIdx.push(i);
      path.push(wgs84ToGcj02(s.lng, s.lat));
      times.push(s.t ?? i);
    });
    return { srcIdx, path, times };
  }, [samples]);

  const count = geo.path.length;

  // ---- 初始化地图 ----
  useEffect(() => {
    if (count < 2 || !containerRef.current) return;
    let disposed = false;
    setReady(false);
    loadAMap()
      .then((AMap) => {
        if (disposed || !containerRef.current) return;
        const map = new AMap.Map(containerRef.current, {
          zoom: 15,
          viewMode: "2D",
          mapStyle: "amap://styles/normal",
          resizeEnable: true,
        });

        const full = new AMap.Polyline({
          path: geo.path,
          strokeColor: "#94a3b8",
          strokeWeight: 4,
          strokeOpacity: 0.7,
          lineJoin: "round",
          lineCap: "round",
          zIndex: 50,
        });
        const passed = new AMap.Polyline({
          path: [geo.path[0]],
          strokeColor: "#4f46e5",
          strokeWeight: 5,
          strokeOpacity: 1,
          lineJoin: "round",
          lineCap: "round",
          zIndex: 60,
        });
        map.add([full, passed]);

        const dot = (color: string, size: number, ring: string) =>
          `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid ${ring};box-shadow:0 0 4px rgba(0,0,0,.35)"></div>`;

        const start = new AMap.Marker({
          position: geo.path[0],
          offset: new AMap.Pixel(-6, -6),
          content: dot("#10b981", 12, "#ffffff"),
          title: "起点",
          zIndex: 120,
        });
        const end = new AMap.Marker({
          position: geo.path[count - 1],
          offset: new AMap.Pixel(-6, -6),
          content: dot("#ef4444", 12, "#ffffff"),
          title: "终点",
          zIndex: 120,
        });
        const mover = new AMap.Marker({
          position: geo.path[0],
          offset: new AMap.Pixel(-9, -9),
          content: dot("#4f46e5", 18, "#ffffff"),
          zIndex: 200,
        });
        map.add([start, end, mover]);

        map.setFitView([full]);

        mapRef.current = map;
        passedLineRef.current = passed;
        markerRef.current = mover;
        passedPathRef.current = [geo.path[0]];
        setReady(true);
      })
      .catch((err) => {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      disposed = true;
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
      passedLineRef.current = null;
      markerRef.current = null;
    };
  }, [geo, count]);

  // ---- 索引变化 → 更新标记与已走过路径（增量追加，避免每帧切片大数组）----
  useEffect(() => {
    indexRef.current = index;
    if (!ready) return;
    const point = geo.path[index];
    if (!point) return;
    markerRef.current?.setPosition(point);
    const cur = passedPathRef.current;
    if (index + 1 > cur.length) {
      for (let i = cur.length; i <= index; i++) cur.push(geo.path[i]);
    } else if (index + 1 < cur.length) {
      passedPathRef.current = geo.path.slice(0, index + 1);
    }
    passedLineRef.current?.setPath(passedPathRef.current);
  }, [index, ready, geo]);

  // ---- 回放循环（按采样点真实时间推进，rAF 驱动）----
  useEffect(() => {
    if (!playing || count < 2) return;
    const times = geo.times;
    const total = times[times.length - 1] ?? 0;
    let last = performance.now();
    let vt = times[indexRef.current] ?? 0;
    let raf = 0;
    const tick = (now: number) => {
      vt += ((now - last) / 1000) * speed;
      last = now;
      if (vt >= total) {
        setIndex(count - 1);
        setPlaying(false);
        return;
      }
      const next = lowerBound(times, vt);
      if (next !== indexRef.current) {
        indexRef.current = next;
        setIndex(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, geo, count]);

  // ---- 外部（图表 hover）联动：入参是 samples 下标，需映射到轨迹点下标 ----
  const srcToPath = useRef<Map<number, number>>(new Map());
  useEffect(() => {
    const map = new Map<number, number>();
    geo.srcIdx.forEach((si, pi) => map.set(si, pi));
    srcToPath.current = map;
  }, [geo]);

  useEffect(() => {
    if (externalIndex == null || count === 0) return;
    setPlaying(false);
    let target = srcToPath.current.get(externalIndex);
    if (target === undefined) target = lowerBound(geo.srcIdx, externalIndex);
    setIndex(Math.max(0, Math.min(count - 1, target)));
  }, [externalIndex, count, geo]);

  const reset = useCallback(() => {
    setPlaying(false);
    indexRef.current = 0;
    setIndex(0);
    passedPathRef.current = [geo.path[0]];
    passedLineRef.current?.setPath(passedPathRef.current);
    markerRef.current?.setPosition(geo.path[0]);
  }, [geo]);

  const toggle = () => {
    if (!playing && indexRef.current >= count - 1) reset();
    setPlaying((p) => !p);
  };

  const current = samples[geo.srcIdx[index]] ?? null;
  const progress = count > 1 ? (index / (count - 1)) * 100 : 0;

  if (error) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
        地图加载失败：{error}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg border border-slate-200">
        <div ref={containerRef} style={{ height }} className="w-full bg-slate-100" />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-slate-50 text-xs text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载高德地图…
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={toggle}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {playing ? "暂停" : "播放"}
        </button>
        <button
          onClick={reset}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          重置
        </button>

        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`rounded px-2 py-1 text-[11px] transition ${
                speed === s
                  ? "bg-indigo-100 font-semibold text-indigo-700"
                  : "text-slate-400 hover:bg-slate-100"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <input
          type="range"
          min={0}
          max={Math.max(count - 1, 0)}
          value={index}
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
          className="h-1.5 min-w-[160px] flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-600"
        />
        <span className="whitespace-nowrap text-[11px] text-slate-400">
          {index + 1} / {count} 点
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Cell label="时刻" value={fmtClock(current?.t ?? null)} />
        <Cell label="里程" value={current?.distance_km != null ? fmtNum(current.distance_km, 2) : "-"} unit="km" />
        <Cell label="速度" value={current?.speed_kmh != null ? fmtNum(current.speed_kmh, 1) : "-"} unit="km/h" />
        <Cell label="心率" value={current?.heart_rate != null ? fmtNum(current.heart_rate) : "-"} unit="bpm" />
        <Cell label="功率" value={current?.power != null ? fmtNum(current.power) : "-"} unit="W" />
        <Cell label="海拔" value={current?.altitude != null ? fmtNum(current.altitude, 1) : "-"} unit="m" />
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-indigo-500 transition-[width] duration-75"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function Cell({ label, value, unit }: { label: string; value: string; unit?: string }) {
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
