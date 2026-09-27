"""管道执行引擎：按拓扑顺序执行 source → filter → target，节点状态实时写入 PipelineRun。"""
from collections import defaultdict, deque

from django.utils import timezone

from apps.activities.dedup import find_duplicate
from apps.activities.models import Activity, ActivitySyncState
from apps.activities.tasks import sync_activity_to_platform
from apps.platforms.adapters import get_adapter
from apps.platforms.models import Platform
from apps.pipelines.filters import FilterRegistry
from apps.synclogs.models import SyncLog


class PipelineEngine:
    def __init__(self, pipeline, run):
        self.pipeline = pipeline
        self.run = run
        self.user = pipeline.user

    # ---------- 日志 / 状态 ----------
    def log(self, level: str, message: str, activity=None, detail: dict | None = None):
        SyncLog.objects.create(
            user=self.user,
            pipeline=self.pipeline,
            activity=activity,
            level=level,
            message=message,
            detail=detail or {},
        )

    def set_node_state(self, node_id: int, status: str, message: str = ""):
        state = dict(self.run.nodes_state or {})
        state[str(node_id)] = {
            "status": status,
            "message": message[:200],
            "updated_at": timezone.now().isoformat(),
        }
        self.run.nodes_state = state
        self.run.save(update_fields=["nodes_state"])

    # ---------- 主流程 ----------
    def execute(self):
        self.run.status = "running"
        self.run.started_at = timezone.now()
        self.run.save(update_fields=["status", "started_at"])

        nodes = {
            n.id: n
            for n in self.pipeline.nodes.select_related("account__platform", "account__user")
        }
        edges = list(self.pipeline.edges.all())
        order = self._topo_order(nodes, edges)

        incoming: dict[int, list[int]] = defaultdict(list)
        for e in edges:
            incoming[e.target_node_id].append(e.source_node_id)

        outputs: dict[int, list] = {}
        errors = 0
        for nid in order:
            node = nodes.get(nid)
            if node is None:
                continue
            try:
                self.set_node_state(nid, "running")
                inputs = [x for src in incoming[nid] for x in outputs.get(src, [])]
                if node.node_type == "source":
                    outputs[nid] = self._run_source(node)
                elif node.node_type == "filter":
                    outputs[nid] = FilterRegistry.apply(node.config, inputs)
                elif node.node_type == "target":
                    self._run_target(node, inputs)
                    outputs[nid] = inputs
                self.set_node_state(nid, "done")
            except Exception as exc:  # noqa: BLE001
                errors += 1
                self.set_node_state(nid, "error", str(exc))
                self.log("error", f"节点执行失败（{node.node_type}）: {exc}", detail={"node_id": nid})

        self.run.status = "error" if errors == len(order) else ("partial" if errors else "success")
        self.run.finished_at = timezone.now()
        self.run.save(update_fields=["status", "finished_at", "nodes_state"])
        self.pipeline.last_run_at = self.run.finished_at
        self.pipeline.save(update_fields=["last_run_at"])
        self.log(
            "success" if not errors else "warning",
            f"管道《{self.pipeline.name}》执行完成：{self.run.status}（{len(order)} 个节点，{errors} 个失败）",
        )
        return self.run

    @staticmethod
    def _topo_order(nodes: dict, edges: list) -> list[int]:
        """Kahn 拓扑排序；出现环时把剩余节点按 id 顺序兜底执行。"""
        indegree = {nid: 0 for nid in nodes}
        adjacency: dict[int, list[int]] = defaultdict(list)
        for e in edges:
            if e.source_node_id in nodes and e.target_node_id in nodes:
                adjacency[e.source_node_id].append(e.target_node_id)
                indegree[e.target_node_id] += 1
        queue = deque(sorted(n for n, d in indegree.items() if d == 0))
        order: list[int] = []
        while queue:
            nid = queue.popleft()
            order.append(nid)
            for nxt in adjacency[nid]:
                indegree[nxt] -= 1
                if indegree[nxt] == 0:
                    queue.append(nxt)
        order.extend(sorted(n for n in nodes if n not in set(order)))
        return order

    # ---------- 节点执行 ----------
    def _run_source(self, node) -> list:
        """源节点：拉取活动 → 去重 → 入库并初始化矩阵状态。"""
        if node.account is None:
            raise ValueError("源节点未绑定平台账号")
        adapter = get_adapter(node.account)
        fetched = adapter.fetch_activities() or []

        created: list[Activity] = []
        for item in fetched:
            duplicate = find_duplicate(self.user, item["start_timestamp"], item.get("fit_hash"))
            if duplicate:
                self.log("info", f"检测到重复活动「{item.get('name') or duplicate.name}」，已跳过", activity=duplicate)
                created.append(duplicate)
                continue

            activity = Activity.objects.create(
                user=self.user,
                name=item.get("name") or "未命名活动",
                start_timestamp=item["start_timestamp"],
                activity_type=item.get("activity_type") or "unknown",
                duration=item.get("duration") or 0,
                distance=item.get("distance") or 0,
                source_platform=node.account.platform.code,
                source_activity_id=str(item.get("remote_id") or ""),
                fit_hash=item.get("fit_hash") or "",
            )
            self._init_sync_states(activity)
            self.log(
                "info",
                f"拉取新活动「{activity.name}」({activity.activity_type}, {activity.distance}km)",
                activity=activity,
            )
            created.append(activity)
        return created

    def _init_sync_states(self, activity: Activity):
        """为活动初始化所有平台的矩阵单元格：源平台=已同步，可上传平台=待同步，其余=不适用。"""
        for platform in Platform.objects.filter(is_active=True):
            if platform.code == activity.source_platform:
                ActivitySyncState.objects.create(
                    activity=activity,
                    platform=platform,
                    status="synced",
                    remote_activity_id=activity.source_activity_id,
                    synced_at=activity.start_timestamp,
                )
            else:
                ActivitySyncState.objects.create(
                    activity=activity,
                    platform=platform,
                    status="pending" if (platform.capabilities or {}).get("upload") else "na",
                )

    def def_run_target(self, node, activities):  # pragma: no cover —— 兼容旧名，勿用
        self._run_target(node, activities)

    def _run_target(self, node, activities: list):
        """目标节点：逐个上传活动到节点账号所属平台。"""
        if node.account is None:
            raise ValueError("目标节点未绑定平台账号")
        platform = node.account.platform
        for activity in activities:
            sync_activity_to_platform(
                activity.id, platform.id, account_id=node.account.id, pipeline=self.pipeline
            )
