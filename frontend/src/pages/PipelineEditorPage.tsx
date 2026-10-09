import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import ReactFlow, { Background, Controls, type Edge } from "reactflow";
import "reactflow/dist/style.css";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Play,
  RotateCw,
  Save,
  ScanEye,
} from "lucide-react";
import {
  fetchRunStatus,
  qk,
  usePipeline,
  usePreviewSyncTask,
  useRunPipeline,
  useSaveSyncTask,
  useSyncSpec,
} from "../api/queries";
import type { Pipeline, RunStats, SyncPreview, SyncTaskConfig } from "../api/types";
import VeloNode from "../components/pipeline/VeloNode";
import type { VeloNodeData } from "../components/pipeline/types";
import SyncTaskForm from "../components/sync/SyncTaskForm";

const nodeTypes = { velo: VeloNode };

/** 运行状态轮询间隔（毫秒）。取代原 SSE 长连接 */
const POLL_INTERVAL_MS = 1500;

const toConfig = (p: Pipeline): SyncTaskConfig => ({
  name: p.name,
  description: p.description ?? "",
  is_active: p.is_active,
  auto_run: p.auto_run,
  source_type: p.source_type ?? "fit",
  source_account: p.source_account ?? null,
  source_fit_detail: p.source_fit_detail ?? null,
  target_accounts: p.target_accounts ?? [],
  sync_content: p.sync_content ?? [],
  time_range: p.time_range ?? { mode: "file", start: null, end: null, days: 30 },
  options: p.options ?? {},
});

export default function PipelineEditorPage() {
  const params = useParams();
  const pipelineId = Number(params.id);
  const queryClient = useQueryClient();
  const { data: pipeline } = usePipeline(pipelineId);
  const { data: spec } = useSyncSpec();
  const saveMutation = useSaveSyncTask(pipelineId);
  const runMutation = useRunPipeline(pipelineId);
  const previewMutation = usePreviewSyncTask(pipelineId);

  const [config, setConfig] = useState<SyncTaskConfig | null>(null);
  const [nodeStatus, setNodeStatus] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lastStats, setLastStats] = useState<RunStats | null>(null);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const loadedRef = useRef(false);
  const toastTimer = useRef<number | undefined>(undefined);
  /** 运行状态轮询的定时器与停止标记（取代原 SSE 长连接） */
  const pollTimer = useRef<number | undefined>(undefined);
  const pollingStopped = useRef(true);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  // 离开页面时停掉轮询，避免组件卸载后仍在后台发请求
  useEffect(
    () => () => {
      pollingStopped.current = true;
      window.clearTimeout(pollTimer.current);
    },
    []
  );

  // 初次加载：后端配置 → 表单
  useEffect(() => {
    if (!pipeline || loadedRef.current || pipelineId <= 0) return;
    loadedRef.current = true;
    setConfig(toConfig(pipeline));
  }, [pipeline, pipelineId]);

  const patch = useCallback((p: Partial<SyncTaskConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...p } : prev));
  }, []);

  // 画布：由后端按配置重建的节点图（源 → 时间范围 → 目标账号）
  const displayNodes = useMemo(() => {
    const nodes = pipeline?.nodes ?? [];
    return nodes.map((n) => ({
      id: `n${n.id}`,
      type: "velo",
      position: { x: n.position_x, y: n.position_y },
      data: {
        clientKey: `n${n.id}`,
        dbId: n.id,
        nodeType: n.node_type,
        account: n.account,
        accountName: n.account_detail
          ? `${n.account_detail.platform.name} · ${n.account_detail.display_name || n.account_detail.platform_user_id}`
          : undefined,
        config: n.config ?? {},
        status: nodeStatus[`n${n.id}`] ?? (running ? "running" : undefined),
      } as VeloNodeData,
      draggable: false,
    }));
  }, [pipeline, nodeStatus, running]);

  const edges: Edge[] = useMemo(
    () =>
      (pipeline?.edges ?? []).map((e, i) => ({
        id: `e${i}`,
        source: `n${e.source}`,
        target: `n${e.target}`,
      })),
    [pipeline]
  );

  const save = useCallback(
    async (silent = false) => {
      if (!config) return;
      const updated = await saveMutation.mutateAsync({ ...config, name: config.name.trim() || "未命名任务" });
      setConfig(toConfig(updated));
      if (!silent) showToast("✅ 同步任务已保存");
    },
    [config, saveMutation, showToast]
  );

  const doPreview = async () => {
    if (!config) return;
    try {
      const result = await previewMutation.mutateAsync(config);
      setPreview(result);
      showToast(`🔍 试运行：将同步 ${result.activity_count} 条活动`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "预览失败");
    }
  };

  const runTask = useCallback(async () => {
    if (running) return;
    try {
      await save(true);
      const result = await runMutation.mutateAsync();
      const runId = result.id;
      setLastStats(result.stats ?? null);
      setRunning(true);
      setNodeStatus({});
      showToast("🚀 同步任务已开始执行…");

      // 短轮询取代原来的 EventSource。
      // 原 SSE 端点在服务端最长挂 600 秒且独占一个请求槽位，全站只有 8 个槽位 ——
      // 8 个并发打开本页的用户就能让整个 API（含健康检查）停止响应。
      pollingStopped.current = false;
      const finish = (finalStatus: string) => {
        pollingStopped.current = true;
        window.clearTimeout(pollTimer.current);
        setRunning(false);
        showToast(
          finalStatus === "success"
            ? "✅ 同步任务执行完成"
            : finalStatus === "partial"
              ? "⚠️ 部分内容同步失败"
              : "❌ 同步任务执行失败"
        );
        void queryClient.invalidateQueries({ queryKey: qk.matrix });
        void queryClient.invalidateQueries({ queryKey: qk.dashboard });
        void queryClient.invalidateQueries({ queryKey: qk.logs("") });
        void queryClient.invalidateQueries({ queryKey: qk.pipeline(pipelineId) });
      };

      const tick = async () => {
        if (pollingStopped.current) return;
        try {
          const payload = await fetchRunStatus(pipelineId, runId);
          const mapped: Record<string, string> = {};
          Object.entries(payload.nodes ?? {}).forEach(([k, v]) => {
            mapped[`n${k}`] = v.status;
          });
          setNodeStatus(mapped);
          if (payload.stats && Object.keys(payload.stats).length) setLastStats(payload.stats);
          if (payload.done) {
            finish(payload.status);
            return;
          }
        } catch {
          // 单次请求失败（网络抖动 / 后端重启）不终止轮询，下一轮继续
        }
        pollTimer.current = window.setTimeout(tick, POLL_INTERVAL_MS);
      };
      void tick();
    } catch (err) {
      pollingStopped.current = true;
      setRunning(false);
      showToast(err instanceof Error ? err.message : "执行失败");
    }
  }, [pipelineId, running, runMutation, save, showToast, queryClient]);

  if ((!pipeline || !config || !spec) && pipelineId > 0) {
    return <div className="p-8 text-sm text-slate-400">加载同步任务中…</div>;
  }
  if (!config || !spec) return null;

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <Link
          to="/pipelines"
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
          title="返回同步任务列表"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <input
          value={config.name}
          onChange={(e) => patch({ name: e.target.value })}
          className="w-56 rounded-lg border border-transparent px-2 py-1.5 text-sm font-semibold text-slate-800 outline-none hover:border-slate-200 focus:border-indigo-400"
          placeholder="任务名称"
        />
        <input
          value={config.description}
          onChange={(e) => patch({ description: e.target.value })}
          className="hidden w-72 rounded-lg border border-transparent px-2 py-1.5 text-xs text-slate-500 outline-none hover:border-slate-200 focus:border-indigo-400 lg:block"
          placeholder="描述（可选）"
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={config.is_active}
            onChange={(e) => patch({ is_active: e.target.checked })}
            className="accent-indigo-600"
          />
          启用
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={config.auto_run}
            onChange={(e) => patch({ auto_run: e.target.checked })}
            className="accent-indigo-600"
          />
          定时自动运行
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void save()}
            disabled={saveMutation.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            保存
          </button>
          <button
            onClick={() => void doPreview()}
            disabled={previewMutation.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-600 hover:bg-sky-100"
          >
            {previewMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ScanEye className="h-3.5 w-3.5" />
            )}
            试运行预览
          </button>
          <button
            onClick={() => void runTask()}
            disabled={running}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {running ? "执行中…" : "运行任务"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 配置表单 */}
        <div className="min-w-0 flex-1 overflow-y-auto bg-slate-50 p-5">
          <SyncTaskForm spec={spec} value={config} onChange={patch} />

          {preview && (
            <section className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-sky-700">
                <ScanEye className="h-4 w-4" /> 试运行预览（未写入任何数据）
              </h3>
              <div className="mt-2 space-y-1 text-xs text-sky-800">
                <p>
                  来源：{preview.source_label} · 将同步 <b>{preview.activity_count}</b> 条活动到{" "}
                  <b>{preview.targets.length}</b> 个账号
                  {preview.coord_fixed_points > 0 && ` · 坐标纠偏轨迹点 ${preview.coord_fixed_points} 个`}
                </p>
                <p>
                  目标：
                  {preview.targets.length
                    ? preview.targets.map((t) => `${t.platform_name}·${t.name}`).join("、")
                    : "未选择"}
                </p>
                <p>
                  内容：{preview.contents.map((c) => c.label).join("、") || "未选择"}
                  {preview.contents.some((c) => c.non_activity) && "（含账号类内容，部分平台为预留）"}
                </p>
                <p>
                  时间范围：
                  {preview.window.start
                    ? `${new Date(preview.window.start).toLocaleString("zh-CN")} ~ ${
                        preview.window.end ? new Date(preview.window.end).toLocaleString("zh-CN") : "不限"
                      }`
                    : "不限（FIT 使用文件自身范围）"}
                  {preview.stats.out_of_range > 0 && ` · 已排除 ${preview.stats.out_of_range} 条范围外记录`}
                </p>
                {preview.items.length > 0 && (
                  <p className="text-sky-700/80">
                    示例：
                    {preview.items
                      .slice(0, 4)
                      .map((i) => i.name)
                      .join("、")}
                    {preview.activity_count > preview.items.length && " …"}
                  </p>
                )}
              </div>
            </section>
          )}
        </div>

        {/* 执行视图：节点图 + 运行统计 */}
        <aside className="flex w-[42%] min-w-[380px] shrink-0 flex-col border-l border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-2.5">
            <h3 className="text-xs font-semibold text-slate-600">执行视图</h3>
            <p className="mt-0.5 text-[11px] text-slate-400">
              按配置自动生成的执行图：源 → 时间范围 → 目标账号（保存后刷新）
            </p>
          </div>
          <div className="relative h-72 shrink-0">
            {displayNodes.length ? (
              <ReactFlow
                nodes={displayNodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                zoomOnDoubleClick={false}
              >
                <Background gap={18} color="#e2e8f0" />
                <Controls showInteractive={false} />
              </ReactFlow>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">
                保存任务后生成执行图
              </div>
            )}
          </div>

          {/* 运行统计 */}
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-600">最近一次运行</h3>
              <button
                onClick={() => void queryClient.invalidateQueries({ queryKey: qk.pipeline(pipelineId) })}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-50"
                title="刷新"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
            </div>
            {lastStats ? (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { label: "命中活动", value: lastStats.activities },
                    { label: "已同步", value: lastStats.uploaded },
                    { label: "已跳过", value: lastStats.skipped },
                    { label: "失败", value: lastStats.failed },
                  ].map((s) => (
                    <div key={s.label} className="rounded-lg bg-slate-50 px-3 py-2">
                      <div className="text-slate-400">{s.label}</div>
                      <div className="mt-0.5 text-base font-semibold text-slate-700">{s.value ?? 0}</div>
                    </div>
                  ))}
                </div>
                {lastStats.coord_fixed_points > 0 && (
                  <p className="flex items-center gap-1 text-xs text-sky-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    坐标纠偏轨迹点 {lastStats.coord_fixed_points} 个
                  </p>
                )}
                {Object.keys(lastStats.contents ?? {}).length > 0 && (
                  <div className="space-y-1">
                    {Object.entries(lastStats.contents).map(([key, v]) => (
                      <div key={key} className="flex items-center justify-between rounded-md bg-slate-50 px-2.5 py-1.5 text-xs">
                        <span className="text-slate-500">{key}</span>
                        <span
                          className={
                            v.status === "synced"
                              ? "text-emerald-600"
                              : v.status === "reserved"
                                ? "text-amber-500"
                                : v.status === "failed"
                                  ? "text-red-500"
                                  : "text-slate-400"
                          }
                        >
                          {v.status === "synced"
                            ? `已同步 ${v.items} 条`
                            : v.status === "reserved"
                              ? "预留（平台未实现）"
                              : v.status === "planned"
                                ? "试运行"
                                : v.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 flex items-center gap-1 text-xs text-slate-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                还没有运行记录，点击右上角「运行任务」或先「试运行预览」
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-800 px-5 py-2.5 text-sm text-white shadow-xl">
          {running && <Loader2 className="h-4 w-4 animate-spin" />}
          {toast}
        </div>
      )}
    </div>
  );
}
