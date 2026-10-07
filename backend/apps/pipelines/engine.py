"""同步任务执行引擎 + 试运行规划器。

任务模型：数据来源（FIT / iGPSPORT / Garmin …）→ 同步内容 → 目标账号。
画布节点图由结构化配置自动生成，因此本引擎同时服务于：
- 画布可视化（节点状态经 SSE 实时推送）
- 结构化配置的执行（按 source_type / sync_content / time_range / options）
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta

from django.utils import timezone

from apps.activities.coords import wgs84_to_gcj02
from apps.activities.dedup import find_duplicate
from apps.activities.models import Activity, ActivityFitDetail, ActivitySyncState
from apps.platforms.adapters import AdapterError, get_adapter
from apps.platforms.models import Platform
from apps.pipelines.filters import FilterRegistry
from apps.pipelines.spec import NON_ACTIVITY_CONTENTS, content_label, source_label
from apps.synclogs.models import SyncLog

#: 解析 ISO 时间字符串，失败返回 None
def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


class TaskPlanner:
    """按任务配置计算「将要同步什么」，供试运行预览与实际执行共用。"""

    def __init__(self, pipeline, target_accounts=None):
        self.pipeline = pipeline
        self.target_accounts = target_accounts
        self.source_type = pipeline.source_type
        self.source_account = pipeline.source_account
        self.user = pipeline.user
        self.options = pipeline.options or {}
        self.contents = pipeline.sync_content or []

    # ---------- 时间范围 ----------
    def window(self):
        """返回 (start, end)，None 表示不限。FIT 的 file 模式返回 (None, None)。"""
        tr = self.pipeline.time_range or {}
        mode = tr.get("mode") or "file"
        if mode == "recent":
            days = int(tr.get("days") or 30)
            return timezone.now() - timedelta(days=days), timezone.now()
        if mode == "custom":
            return _parse_dt(tr.get("start")), _parse_dt(tr.get("end"))
        return None, None

    @staticmethod
    def fit_bounds(activity, detail=None) -> tuple:
        """FIT 记录自身的时间边界（start ~ start + duration）。"""
        start = activity.start_timestamp
        duration = activity.duration or 0
        if detail is not None:
            duration = (detail.summary or {}).get("duration") or duration
        return start, start + timedelta(seconds=int(duration or 0))

    def fit_time_bounds_all(self) -> tuple:
        """FIT 来源的整体时间边界（用于前端限制选择范围）。"""
        details = self._fit_details()
        if not details:
            return None, None
        starts = [d.activity.start_timestamp for d in details]
        ends = [self.fit_bounds(d.activity, d)[1] for d in details]
        return min(starts), max(ends)

    # ---------- 数据来源 ----------
    def _fit_details(self):
        qs = ActivityFitDetail.objects.filter(activity__user=self.user).select_related("activity")
        if self.pipeline.source_fit_detail_id:
            qs = qs.filter(pk=self.pipeline.source_fit_detail_id)
        return list(qs)

    def collect_activities(self) -> tuple[list[Activity], dict]:
        """按来源取活动并应用时间窗与选项过滤，返回 (活动列表, 统计)。"""
        stats = {"fetched": 0, "out_of_range": 0, "no_gps": 0}
        start, end = self.window()

        if self.source_type == "fit":
            details = self._fit_details()
            candidates: list[Activity] = []
            for d in details:
                activity = d.activity
                stats["fetched"] += 1
                bounds = self.fit_bounds(activity, d)
                if start and bounds[1] < start:
                    stats["out_of_range"] += 1
                    continue
                if end and bounds[0] > end:
                    stats["out_of_range"] += 1
                    continue
                if self.options.get("only_gps") and not (d.track or []):
                    stats["no_gps"] += 1
                    continue
                candidates.append(activity)
            return candidates, stats

        # 平台来源：交由适配器拉取（since 交由平台侧过滤，本地再做一次时间窗校验）
        account = self.source_account
        if account is None:
            return [], stats
        try:
            fetched = get_adapter(account).fetch_activities(since=start) or []
        except AdapterError:
            fetched = []
        created: list[Activity] = []
        for item in fetched:
            ts = item.get("start_timestamp")
            stats["fetched"] += 1
            if start and ts and ts < start:
                stats["out_of_range"] += 1
                continue
            if end and ts and ts > end:
                stats["out_of_range"] += 1
                continue
            duplicate = find_duplicate(self.user, ts, item.get("fit_hash"))
            if duplicate:
                created.append(duplicate)
                continue
            activity = Activity.objects.create(
                user=self.user,
                name=item.get("name") or "未命名活动",
                start_timestamp=ts,
                activity_type=item.get("activity_type") or "unknown",
                duration=item.get("duration") or 0,
                distance=item.get("distance") or 0,
                source_platform=account.platform.code,
                source_activity_id=str(item.get("remote_id") or ""),
                fit_hash=item.get("fit_hash") or "",
            )
            created.append(activity)
        return created, stats

    # ---------- 载荷构建 ----------
    def build_payload(self, activity: Activity) -> tuple[dict, int]:
        """按勾选内容拼装同步载荷；返回 (payload, 已纠偏的轨迹点数)。"""
        contents = set(self.contents)
        payload: dict = {
            "activity": {
                "name": activity.name,
                "activity_type": activity.activity_type,
                "start_timestamp": activity.start_timestamp.isoformat(),
                "duration": activity.duration,
                "distance": activity.distance,
                "source_platform": activity.source_platform,
            }
        }
        detail = ActivityFitDetail.objects.filter(activity=activity).first()
        if detail is None:
            return payload, 0

        if "summary" in contents:
            payload["summary"] = detail.summary or {}
        if "samples" in contents:
            payload["samples"] = detail.samples or []
        if "device" in contents:
            payload["device"] = detail.device or {}
        if "laps" in contents:
            payload["laps"] = []
        fixed = 0
        if "track" in contents:
            track = [tuple(p) for p in (detail.track or []) if p and len(p) >= 2]
            limit = int(self.options.get("max_track_points") or 30000)
            if len(track) > limit:  # 等距抽稀，始终保留首尾点
                step = len(track) / float(limit)
                idx = sorted({int(i * step) for i in range(limit)} | {len(track) - 1})
                track = [track[i] for i in idx]
            if self.options.get("coord_fix"):
                track = [wgs84_to_gcj02(float(lng), float(lat)) for lng, lat in track]
                fixed = len(track)
            payload["track"] = [[round(lng, 6), round(lat, 6)] for lng, lat in track]
        return payload, fixed

    def target_list(self):
        if self.target_accounts is not None:
            return list(self.target_accounts)
        return list(self.pipeline.target_accounts.select_related("platform"))

    # ---------- 试运行预览 ----------
    def plan(self) -> dict:
        activities, stats = self.collect_activities()
        detail_points = 0
        coord_points = 0
        items = []
        for activity in activities:
            _, fixed = self.build_payload(activity)
            coord_points += fixed
            detail_points += 1
            items.append(
                {
                    "activity_id": activity.id,
                    "name": activity.name,
                    "type": activity.activity_type,
                    "start": activity.start_timestamp.isoformat(),
                    "distance": activity.distance,
                }
            )
        fit_start, fit_end = (None, None)
        if self.source_type == "fit":
            fit_start, fit_end = self.fit_time_bounds_all()
        window_start, window_end = self.window()
        return {
            "source_type": self.source_type,
            "source_label": source_label(self.source_type),
            "contents": [
                {"key": k, "label": content_label(k), "non_activity": k in NON_ACTIVITY_CONTENTS}
                for k in self.contents
            ],
            "targets": [
                {
                    "id": a.id,
                    "platform": a.platform.code,
                    "platform_name": a.platform.name,
                    "name": a.display_name or a.platform_user_id,
                }
                for a in self.target_list()
            ],
            "time_range": self.pipeline.time_range or {},
            "window": {
                "start": window_start.isoformat() if window_start else None,
                "end": window_end.isoformat() if window_end else None,
            },
            "fit_bounds": {
                "start": fit_start.isoformat() if fit_start else None,
                "end": fit_end.isoformat() if fit_end else None,
            },
            "options": self.options,
            "activity_count": len(activities),
            "coord_fixed_points": coord_points,
            "stats": stats,
            "items": items[:50],
        }


class PipelineEngine:
    def __init__(self, pipeline, run):
        self.pipeline = pipeline
        self.run = run
        self.user = pipeline.user
        self.planner = TaskPlanner(pipeline)
        self.stats = {
            "activities": 0,
            "uploaded": 0,
            "skipped": 0,
            "failed": 0,
            "coord_fixed_points": 0,
            "contents": {},
        }

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
        self.run.stats = self.stats
        self.run.save(update_fields=["nodes_state", "stats"])

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

        incoming: dict[int, list[int]] = {}
        for e in edges:
            incoming.setdefault(e.target_node_id, []).append(e.source_node_id)

        outputs: dict[int, list] = {}
        errors = 0
        stop = bool((self.pipeline.options or {}).get("stop_on_error"))
        for nid in order:
            node = nodes.get(nid)
            if node is None:
                continue
            try:
                self.set_node_state(nid, "running")
                inputs = [x for src in incoming.get(nid, []) for x in outputs.get(src, [])]
                if node.node_type == "source":
                    outputs[nid] = self._run_source(node)
                elif node.node_type == "filter":
                    outputs[nid] = self._run_filter(node, inputs)
                elif node.node_type == "target":
                    self._run_target(node, inputs)
                    outputs[nid] = inputs
                self.set_node_state(nid, "done")
            except Exception as exc:  # noqa: BLE001
                errors += 1
                self.set_node_state(nid, "error", str(exc))
                self.log("error", f"节点执行失败（{node.node_type}）: {exc}", detail={"node_id": nid})
                if stop:
                    self.log("warning", "已按「遇到失败立即中止」选项终止任务")
                    break

        if errors >= len(order):
            final_status = "error"
        elif errors or self.stats["failed"]:
            final_status = "partial"
        else:
            final_status = "success"
        self.run.status = final_status
        self.run.finished_at = timezone.now()
        self.run.stats = self.stats
        self.run.save(update_fields=["status", "finished_at", "nodes_state", "stats"])
        self.pipeline.last_run_at = self.run.finished_at
        self.pipeline.save(update_fields=["last_run_at"])
        self.log(
            "success" if not errors else "warning",
            f"同步任务《{self.pipeline.name}》执行完成：{self.run.status}"
            f"（{self.stats['uploaded']} 条已同步，{self.stats['skipped']} 条跳过，{self.stats['failed']} 条失败）",
            detail=self.stats,
        )
        return self.run

    @staticmethod
    def _topo_order(nodes: dict, edges: list) -> list[int]:
        """Kahn 拓扑排序；出现环时把剩余节点按 id 顺序兜底执行。"""
        indegree = {nid: 0 for nid in nodes}
        adjacency: dict[int, list[int]] = {}
        for e in edges:
            if e.source_node_id in nodes and e.target_node_id in nodes:
                adjacency.setdefault(e.source_node_id, []).append(e.target_node_id)
                indegree[e.target_node_id] += 1
        queue = sorted(n for n, d in indegree.items() if d == 0)
        order: list[int] = []
        while queue:
            nid = queue.pop(0)
            order.append(nid)
            for nxt in adjacency.get(nid, []):
                indegree[nxt] -= 1
                if indegree[nxt] == 0:
                    queue.append(nxt)
        done = set(order)
        order.extend(sorted(n for n in nodes if n not in done))
        return order

    # ---------- 节点执行 ----------
    def _resolve_source(self, node):
        """确定生效的数据来源：优先结构化配置，兼容早期只绑了源账号的画布管道。"""
        pipeline = self.pipeline
        if pipeline.source_type != "fit" or pipeline.source_account_id or pipeline.source_fit_detail_id:
            return pipeline.source_type, pipeline.source_account
        if node is not None and node.account_id:
            return node.account.platform.code, node.account
        return "fit", None

    def _run_source(self, node) -> list:
        """源节点：按 source_type 取数（FIT 本地记录 / 平台账号拉取）。"""
        source_type, source_account = self._resolve_source(node)
        self.planner.source_type = source_type
        self.planner.source_account = source_account

        activities, stats = self.planner.collect_activities()
        self.stats["activities"] = len(activities)

        if source_type == "fit":
            scope = "指定 FIT 记录" if self.pipeline.source_fit_detail_id else "全部本地 FIT 记录"
            self.log(
                "info",
                f"FIT 来源（{scope}）：命中 {len(activities)} 条记录，"
                f"跳过 {stats['out_of_range']} 条不在时间范围内",
            )
        else:
            if source_account is None:
                raise ValueError("数据来源未绑定平台账号")
            self.log("info", f"{source_label(source_type)} 来源：拉取到 {len(activities)} 条记录")

        for activity in activities:
            self._init_sync_states(activity)
        return activities

    def _run_filter(self, node, activities: list) -> list:
        """过滤器节点：先走画布规则，再按任务时间窗与选项过滤。"""
        filtered = FilterRegistry.apply(node.config, activities)
        return filtered

    def _init_sync_states(self, activity: Activity):
        """为活动初始化所有平台的矩阵单元格：源平台=已同步，可上传平台=待同步，其余=不适用。"""
        for platform in Platform.objects.filter(is_active=True):
            if ActivitySyncState.objects.filter(activity=activity, platform=platform).exists():
                continue
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

    def _run_target(self, node, activities: list):
        """目标节点：上传活动内容 + 账号类内容（资料/课程/路线/体重/睡眠…）。"""
        if node.account is None:
            raise ValueError("目标节点未绑定平台账号")
        account = node.account
        platform = account.platform
        contents = set(self.pipeline.sync_content or [])
        options = self.pipeline.options or {}
        dry_run = bool(options.get("dry_run"))
        adapter = get_adapter(account)

        if dry_run:
            self.log("info", f"[试运行] 将向 {platform.name} 同步 {len(activities)} 条活动（内容：{self._content_text()}）")

        if "activity" in contents:
            for activity in activities:
                self._sync_activity(activity, account, platform, adapter, dry_run)

        # 账号类内容（与单条活动无关）
        for key in self.pipeline.sync_content or []:
            if key not in NON_ACTIVITY_CONTENTS:
                continue
            self._sync_content(key, account, platform, adapter, dry_run)

    def _content_text(self) -> str:
        labels = [content_label(k) for k in (self.pipeline.sync_content or [])]
        return "、".join(labels) or "未选择"

    # ---------- 单条活动同步 ----------
    def _sync_activity(self, activity, account, platform, adapter, dry_run: bool):
        options = self.pipeline.options or {}
        conflict = options.get("conflict") or "skip"

        state = ActivitySyncState.objects.filter(activity=activity, platform=platform).first()
        if options.get("dedup") and state and state.status == "synced":
            self.stats["skipped"] += 1
            self.log("info", f"「{activity.name}」在 {platform.name} 已存在，按去重策略跳过", activity=activity)
            return

        payload, fixed = self.planner.build_payload(activity)
        self.stats["coord_fixed_points"] += fixed

        if dry_run:
            self.stats["skipped"] += 0
            self.log(
                "info",
                f"[试运行] 将同步「{activity.name}」到 {platform.name}"
                f"（{len(payload.get('track') or [])} 个轨迹点，纠偏 {fixed} 个）",
                activity=activity,
                detail={"payload_keys": list(payload.keys())},
            )
            return

        if conflict == "skip":
            try:
                existed = adapter.check_exists(activity.start_timestamp)
            except Exception:  # noqa: BLE001
                existed = None
            if existed:
                self.stats["skipped"] += 1
                if state:
                    state.status = "synced"
                    state.remote_activity_id = str(existed)
                    state.synced_at = timezone.now()
                    state.save()
                self.log("info", f"「{activity.name}」在 {platform.name} 已存在（ID {existed}），按冲突策略跳过", activity=activity)
                return

        if self.planner.source_type == "fit":
            fit_data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        else:
            try:
                fit_data = adapter.download_fit(activity.source_activity_id or activity.id)
            except Exception:  # noqa: BLE001
                fit_data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        try:
            remote_id = adapter.upload_fit(fit_data, name=activity.name)
        except Exception as exc:  # noqa: BLE001
            self.stats["failed"] += 1
            if state:
                state.status = "failed"
                state.error_message = str(exc)[:500]
                state.save()
            self.log("error", f"同步「{activity.name}」到 {platform.name} 失败: {exc}", activity=activity)
            return

        self.stats["uploaded"] += 1
        if state:
            state.status = "synced"
            state.error_message = ""
            state.remote_activity_id = "" if not options.get("write_back", True) else str(remote_id)
            state.synced_at = timezone.now()
            state.save()
        self.log("success", f"已将「{activity.name}」同步到 {platform.name}", activity=activity, detail={"remote_id": str(remote_id)})

    # ---------- 账号类内容同步 ----------
    def _sync_content(self, key: str, account, platform, adapter, dry_run: bool):
        label = content_label(key)
        window_start, window_end = self.planner.window()
        entry = {"status": "pending", "items": 0}

        source_adapter = None
        if self.pipeline.source_account_id:
            try:
                source_adapter = get_adapter(self.pipeline.source_account)
            except Exception:  # noqa: BLE001
                source_adapter = None

        try:
            if source_adapter is None:
                payload: dict = {}
            else:
                payload = source_adapter.fetch_content(key, window_start, window_end)
            count = len(payload.get("items") or []) if isinstance(payload, dict) else 0
            entry["items"] = count

            if dry_run:
                entry["status"] = "planned"
                self.log("info", f"[试运行] 将向 {platform.name} 同步「{label}」{count} 条")
            else:
                remote = adapter.push_content(key, payload)
                entry["status"] = "synced"
                entry["remote"] = str(remote)
                self.log("success", f"已同步「{label}」到 {platform.name}（{count} 条）", detail=entry)
        except NotImplementedError:
            entry["status"] = "reserved"
            self.log("warning", f"{platform.name} 暂未实现「{label}」同步，已预留（本次跳过）")
        except AdapterError as exc:
            entry["status"] = "failed"
            self.stats["failed"] += 1
            self.log("error", f"同步「{label}」到 {platform.name} 失败: {exc}")
        except Exception as exc:  # noqa: BLE001
            entry["status"] = "failed"
            self.stats["failed"] += 1
            self.log("error", f"同步「{label}」到 {platform.name} 异常: {exc}")

        self.stats["contents"][key] = entry

    def def_run_target(self, node, activities):  # pragma: no cover —— 兼容旧名，勿用
        self._run_target(node, activities)
