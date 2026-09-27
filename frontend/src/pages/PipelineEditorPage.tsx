import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import ReactFlow, {
  Background,
  Controls,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  ArrowLeft,
  Loader2,
  Play,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { getAccessToken } from "../api/client";
import { qk, useAccounts, usePipeline, useRunPipeline, useSavePipeline } from "../api/queries";
import VeloNode from "../components/pipeline/VeloNode";
import type { VNode, VeloNodeData } from "../components/pipeline/types";

const nodeTypes = { velo: VeloNode };

const TYPE_LABEL: Record<VeloNodeData["nodeType"], string> = {
  source: "源节点",
  filter: "过滤器",
  target: "目标节点",
};

export default function PipelineEditorPage() {
  const params = useParams();
  const pipelineId = Number(params.id);
  const queryClient = useQueryClient();
  const { data: pipeline } = usePipeline(pipelineId);
  const { data: accounts } = useAccounts();
  const saveMutation = useSavePipeline(pipelineId);
  const runMutation = useRunPipeline(pipelineId);

  const [nodes, setNodes, onNodesChange] = useNodesState<VeloNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [meta, setMeta] = useState({ name: "", description: "", is_active: true, auto_run: true });
  const [nodeStatus, setNodeStatus] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  // 初次加载：后端数据 → ReactFlow 画布
  useEffect(() => {
    if (!pipeline || loadedRef.current || pipelineId <= 0) return;
    loadedRef.current = true;
    setMeta({
      name: pipeline.name,
      description: pipeline.description ?? "",
      is_active: pipeline.is_active,
      auto_run: pipeline.auto_run,
    });
    setNodes(
      pipeline.nodes.map((n) => ({
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
        },
      }))
    );
    setEdges(
      pipeline.edges.map((e, i) => ({ id: `e${i}`, source: `n${e.source}`, target: `n${e.target}` }))
    );
  }, [pipeline, pipelineId, setNodes, setEdges]);

  // ---------- 保存 / 运行 ----------
  const saveGraph = useCallback(
    async (silent = false) => {
      const payload = {
        ...meta,
        nodes: nodes.map((n) => ({
          client_id: n.data.clientKey,
          node_type: n.data.nodeType,
          account: n.data.account ?? null,
          config: n.data.config ?? {},
          position_x: n.position.x,
          position_y: n.position.y,
        })),
        edges: edges.map((e) => ({ source: e.source, target: e.target })),
      };
      const updated = await saveMutation.mutateAsync(payload);
      // 用数据库 id 重建画布（保持位置）
      setNodes(
        updated.nodes.map((n) => ({
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
          },
        }))
      );
      setEdges(
        updated.edges.map((e, i) => ({ id: `e${i}`, source: `n${e.source}`, target: `n${e.target}` }))
      );
      setSelectedKey(null);
      if (!silent) showToast("✅ 管道已保存");
      return updated;
    },
    [meta, nodes, edges, saveMutation, setNodes, setEdges, showToast]
  );

  const runPipeline = useCallback(async () => {
    if (running) return;
    try {
      await saveGraph(true); // 先保存，保证节点 id 与 SSE 状态对应
      await runMutation.mutateAsync();
      setRunning(true);
      setNodeStatus({});
      showToast("🚀 管道已开始执行…");

      const es = new EventSource(
        `/api/pipelines/${pipelineId}/stream/?access_token=${getAccessToken() ?? ""}`
      );
      es.onmessage = (ev) => {
        const payload = JSON.parse(ev.data) as {
          status: string;
          nodes: Record<string, { status: string }>;
        };
        const mapped: Record<string, string> = {};
        Object.entries(payload.nodes ?? {}).forEach(([k, v]) => {
          mapped[`n${k}`] = v.status;
        });
        setNodeStatus(mapped);
        if (["success", "partial", "error"].includes(payload.status)) {
          es.close();
          setRunning(false);
          showToast(
            payload.status === "success"
              ? "✅ 管道执行完成"
              : payload.status === "partial"
                ? "⚠️ 管道部分节点执行失败"
                : "❌ 管道执行失败"
          );
          void queryClient.invalidateQueries({ queryKey: qk.matrix });
          void queryClient.invalidateQueries({ queryKey: qk.dashboard });
          void queryClient.invalidateQueries({ queryKey: qk.logs("") });
        }
      };
      es.onerror = () => {
        es.close();
        setRunning(false);
      };
    } catch (err) {
      setRunning(false);
      showToast(err instanceof Error ? err.message : "执行失败");
    }
  }, [pipelineId, running, runMutation, saveGraph, showToast, queryClient]);

  // ---------- 画布操作 ----------
  const addNode = (nodeType: VeloNodeData["nodeType"]) => {
    const key = `new-${Date.now()}`;
    setNodes([
      ...nodes,
      {
        id: key,
        type: "velo",
        position: { x: 140 + Math.random() * 260, y: 80 + Math.random() * 240 },
        data: {
          clientKey: key,
          nodeType,
          account: null,
          config: nodeType === "filter" ? { filter_type: "by_sport", sport: "cycling" } : {},
        },
      },
    ]);
    setSelectedKey(key);
  };

  const onConnect = (connection: Connection) =>
    setEdges((eds) => addEdge({ ...connection, animated: false } as Edge, eds));

  const deleteSelected = () => {
    if (!selectedKey) return;
    setNodes(nodes.filter((n) => n.id !== selectedKey));
    setEdges(edges.filter((e) => e.source !== selectedKey && e.target !== selectedKey));
    setSelectedKey(null);
  };

  const selectedNode = nodes.find((n) => n.id === selectedKey) ?? null;

  const updateSelected = (patch: Partial<VeloNodeData>) => {
    if (!selectedKey) return;
    setNodes(
      nodes.map((n) => (n.id === selectedKey ? { ...n, data: { ...n.data, ...patch } } : n))
    );
  };

  const updateSelectedConfig = (patch: Record<string, unknown>) => {
    if (!selectedNode) return;
    updateSelected({ config: { ...selectedNode.data.config, ...patch } });
  };

  // 节点实时状态（SSE）映射到画布
  const displayNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: { ...n.data, status: nodeStatus[n.id] ?? (running ? "running" : undefined) },
      })),
    [nodes, nodeStatus, running]
  );

  if (!pipeline && pipelineId > 0) {
    return <div className="p-8 text-sm text-slate-400">加载管道中…</div>;
  }

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <Link to="/pipelines" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700" title="返回管道列表">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <input
          value={meta.name}
          onChange={(e) => setMeta({ ...meta, name: e.target.value })}
          className="w-56 rounded-lg border border-transparent px-2 py-1.5 text-sm font-semibold text-slate-800 outline-none hover:border-slate-200 focus:border-indigo-400"
          placeholder="管道名称"
        />
        <input
          value={meta.description}
          onChange={(e) => setMeta({ ...meta, description: e.target.value })}
          className="hidden w-72 rounded-lg border border-transparent px-2 py-1.5 text-xs text-slate-500 outline-none hover:border-slate-200 focus:border-indigo-400 lg:block"
          placeholder="描述（可选）"
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={meta.is_active}
            onChange={(e) => setMeta({ ...meta, is_active: e.target.checked })}
            className="accent-indigo-600"
          />
          启用
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={meta.auto_run}
            onChange={(e) => setMeta({ ...meta, auto_run: e.target.checked })}
            className="accent-indigo-600"
          />
          定时自动运行
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => addNode("source")}
            className="flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-100"
          >
            <Plus className="h-3.5 w-3.5" /> 源
          </button>
          <button
            onClick={() => addNode("filter")}
            className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-600 hover:bg-amber-100"
          >
            <Plus className="h-3.5 w-3.5" /> 过滤器
          </button>
          <button
            onClick={() => addNode("target")}
            className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-100"
          >
            <Plus className="h-3.5 w-3.5" /> 目标
          </button>
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <button
            onClick={() => void saveGraph()}
            disabled={saveMutation.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            保存
          </button>
          <button
            onClick={() => void runPipeline()}
            disabled={running}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {running ? "执行中…" : "运行管道"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 画布 */}
        <div className="relative min-w-0 flex-1">
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedKey(node.id)}
            onPaneClick={() => setSelectedKey(null)}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background gap={18} color="#e2e8f0" />
            <Controls showInteractive={false} />
          </ReactFlow>
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-4 py-1.5 text-[11px] text-slate-400 shadow-sm">
            拖拽节点连线 · Backspace 删除选中节点 · 点击节点配置参数
          </div>
        </div>

        {/* 节点配置面板 */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4">
          {!selectedNode ? (
            <div className="pt-10 text-center text-sm text-slate-400">
              <p>点击画布中的节点</p>
              <p className="mt-1 text-xs">在此配置账号与过滤规则</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">
                  {TYPE_LABEL[selectedNode.data.nodeType]}配置
                </h3>
                <button
                  onClick={deleteSelected}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" /> 删除节点
                </button>
              </div>

              {(selectedNode.data.nodeType === "source" || selectedNode.data.nodeType === "target") && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">平台账号</label>
                  <select
                    value={selectedNode.data.account ?? ""}
                    onChange={(e) => {
                      const accountId = e.target.value ? Number(e.target.value) : null;
                      const acc = (accounts ?? []).find((a) => a.id === accountId);
                      updateSelected({
                        account: accountId,
                        accountName: acc
                          ? `${acc.platform.name} · ${acc.display_name || acc.platform_user_id}`
                          : undefined,
                      });
                    }}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                  >
                    <option value="">— 未选择 —</option>
                    {(accounts ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.platform.name} · {a.display_name || a.platform_user_id}
                      </option>
                    ))}
                  </select>
                  {(accounts ?? []).length === 0 && (
                    <p className="mt-1.5 text-xs text-amber-500">还没有绑定任何平台账号</p>
                  )}
                </div>
              )}

              {selectedNode.data.nodeType === "filter" && (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">过滤规则</label>
                    <select
                      value={(selectedNode.data.config.filter_type as string) ?? "by_sport"}
                      onChange={(e) =>
                        updateSelectedConfig({
                          filter_type: e.target.value,
                          ...(e.target.value === "by_sport" ? { sport: (selectedNode.data.config.sport as string) ?? "cycling" } : {}),
                          ...(e.target.value === "by_distance" ? { min_distance: (selectedNode.data.config.min_distance as number) ?? 10 } : {}),
                          ...(e.target.value === "by_date_range" ? { date_from: (selectedNode.data.config.date_from as string) ?? "" } : {}),
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                    >
                      <option value="by_sport">按运动类型</option>
                      <option value="by_distance">按距离</option>
                      <option value="by_date_range">按日期范围</option>
                    </select>
                  </div>
                  {(selectedNode.data.config.filter_type ?? "by_sport") === "by_sport" && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">运动类型</label>
                      <select
                        value={(selectedNode.data.config.sport as string) ?? "cycling"}
                        onChange={(e) => updateSelectedConfig({ sport: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                      >
                        <option value="cycling">骑行</option>
                        <option value="running">跑步</option>
                        <option value="swimming">游泳</option>
                        <option value="hiking">徒步</option>
                      </select>
                    </div>
                  )}
                  {(selectedNode.data.config.filter_type as string) === "by_distance" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-500">最小 km</label>
                        <input
                          type="number"
                          value={(selectedNode.data.config.min_distance as number) ?? ""}
                          onChange={(e) => updateSelectedConfig({ min_distance: e.target.value ? Number(e.target.value) : null })}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-500">最大 km</label>
                        <input
                          type="number"
                          value={(selectedNode.data.config.max_distance as number) ?? ""}
                          onChange={(e) => updateSelectedConfig({ max_distance: e.target.value ? Number(e.target.value) : null })}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                        />
                      </div>
                    </div>
                  )}
                  {(selectedNode.data.config.filter_type as string) === "by_date_range" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-500">开始日期</label>
                        <input
                          type="date"
                          value={(selectedNode.data.config.date_from as string) ?? ""}
                          onChange={(e) => updateSelectedConfig({ date_from: e.target.value })}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-500">结束日期</label>
                        <input
                          type="date"
                          value={(selectedNode.data.config.date_to as string) ?? ""}
                          onChange={(e) => updateSelectedConfig({ date_to: e.target.value })}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-400">
                节点 ID：{selectedNode.data.dbId ?? "未保存（保存后分配）"}
              </div>
            </div>
          )}
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
