// 与后端 DRF 序列化器一一对应的类型定义

export interface User {
  id: number;
  username: string;
  email: string;
  nickname?: string;
  date_joined?: string;
}

export interface TokenPair {
  access: string;
  refresh: string;
  user: User;
}

export interface SocialProvider {
  code: string;
  name: string;
  color: string;
  icon: string;
  enabled: boolean;
  mode: "oauth" | "mock";
  /** 该登录方式归属的前端形态；`miniprogram` 的项在网页端不可用，必须过滤掉 */
  channel?: "web" | "miniprogram";
}

export interface SocialAuthorizeResult {
  provider: string;
  mode: "oauth" | "mock";
  authorize_url?: string;
}

export interface SocialLoginResult extends TokenPair {
  created: boolean;
  provider: string;
}

export interface Platform {
  id: number;
  code: string;
  name: string;
  auth_type: "oauth2" | "mock" | "api_key";
  api_base: string;
  scopes: string[];
  capabilities: { fetch?: boolean; upload?: boolean };
  is_active: boolean;
  /** OAuth 凭证是否齐备（authorize_url / token_url / client_id） */
  oauth_ready: boolean;
  /** 尚缺的凭证字段名 */
  oauth_missing: string[];
  /** 给用户看的下一步提示 */
  credential_hint: string;
}

export interface PlatformAccount {
  id: number;
  platform: Platform;
  platform_user_id: string;
  display_name: string;
  status: "active" | "expired" | "revoked";
  token_expires_at: string | null;
  created_at: string;
}

export type NodeType = "source" | "filter" | "target";

export interface PipelineNode {
  id: number;
  node_type: NodeType;
  account: number | null;
  account_detail: PlatformAccount | null;
  config: Record<string, unknown>;
  position_x: number;
  position_y: number;
}

export interface PipelineEdge {
  id: number;
  source: number;
  target: number;
}

// ---------- 同步任务（数据来源 / 同步内容 / 时间范围 / 选项） ----------

export interface SourceSpec {
  code: string;
  label: string;
  desc: string;
  need_account: boolean;
  kind: "file" | "platform";
  time_modes: string[];
  time_note: string;
}

export interface ContentSpec {
  key: string;
  label: string;
  desc: string;
  default: boolean;
  /** false 表示该内容尚未在适配器中实现（前端标注「预留」） */
  implemented: boolean;
}

export interface OptionSpec {
  key: string;
  label: string;
  desc: string;
  type: "bool" | "choice" | "int";
  default: unknown;
  choices?: { value: string; label: string }[];
  min?: number;
  max?: number;
  applies_to: string[];
}

export interface TimeModeSpec {
  code: string;
  label: string;
  desc: string;
}

export interface SpecAccount {
  id: number;
  platform: string;
  platform_name: string;
  display_name: string;
  status: string;
  capabilities: { fetch?: boolean; upload?: boolean };
}

export interface FitRecordOption {
  id: number;
  activity_id: number;
  activity_name: string;
  file_name: string;
  start: string;
  end: string;
  duration: number;
  distance: number;
  has_gps: boolean;
  track_point_count: number;
  sample_count: number;
}

export interface SyncSpec {
  sources: SourceSpec[];
  contents: Record<string, ContentSpec[]>;
  options: OptionSpec[];
  time_modes: TimeModeSpec[];
  accounts: SpecAccount[];
  fit_records: FitRecordOption[];
}

export interface TimeRange {
  mode: "file" | "all" | "recent" | "custom";
  start: string | null;
  end: string | null;
  days: number;
}

export interface SyncTaskConfig {
  name: string;
  description: string;
  is_active: boolean;
  auto_run: boolean;
  source_type: string;
  source_account: number | null;
  source_fit_detail: number | null;
  target_accounts: number[];
  sync_content: string[];
  time_range: TimeRange;
  options: Record<string, unknown>;
}

export interface SyncPreviewTarget {
  id: number;
  platform: string;
  platform_name: string;
  name: string;
}

export interface SyncPreview {
  source_type: string;
  source_label: string;
  contents: { key: string; label: string; non_activity: boolean }[];
  targets: SyncPreviewTarget[];
  time_range: TimeRange;
  window: { start: string | null; end: string | null };
  fit_bounds: { start: string | null; end: string | null };
  options: Record<string, unknown>;
  activity_count: number;
  coord_fixed_points: number;
  stats: { fetched: number; out_of_range: number; no_gps: number };
  items: {
    activity_id: number;
    name: string;
    type: string;
    start: string;
    distance: number;
  }[];
}

export interface PipelineSummary {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  auto_run: boolean;
  last_run_at: string | null;
  created_at: string;
  node_count: number;
  last_run_status: string | null;
  source_type: string;
  source_label: string;
  content_labels: string[];
  target_count: number;
  target_summary: string;
  time_summary: string;
}

export interface Pipeline extends PipelineSummary {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  source_account: number | null;
  source_account_detail: PlatformAccount | null;
  source_fit_detail: number | null;
  source_fit_name: string | null;
  target_accounts: number[];
  target_accounts_detail: PlatformAccount[];
  sync_content: string[];
  time_range: TimeRange;
  options: Record<string, unknown>;
}

export interface RunStats {
  activities: number;
  uploaded: number;
  skipped: number;
  failed: number;
  coord_fixed_points: number;
  contents: Record<string, { status: string; items: number }>;
}

/** GET /pipelines/{id}/run-status/ 的响应（取代原 SSE stream） */
export interface RunStatus {
  run_id: number | null;
  pipeline_id?: number;
  status: string;
  nodes: Record<string, { status: string; message?: string; updated_at?: string }>;
  stats?: RunStats;
  started_at?: string | null;
  finished_at?: string | null;
  /** 服务端给出的终态判定，前端不必自己维护终态集合 */
  done?: boolean;
}

export interface ActivitySyncState {
  id: number;
  platform: number;
  platform_code: string;
  platform_name: string;
  remote_activity_id: string;
  status: "synced" | "pending" | "failed" | "na";
  error_message: string;
  synced_at: string | null;
}

export interface Activity {
  id: number;
  name: string;
  start_timestamp: string;
  activity_type: string;
  duration: number;
  distance: number;
  source_platform: string;
  source_activity_id: string;
  fit_hash: string;
  created_at: string;
  sync_states?: ActivitySyncState[];
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export type CellStatus = "synced" | "pending" | "failed" | "na";

export interface CellState {
  status: CellStatus;
  error_message: string;
  remote_activity_id: string;
}

export interface MatrixActivity {
  id: number;
  name: string;
  start_timestamp: string;
  activity_type: string;
  duration: number;
  distance: number;
  source_platform: string;
  states: Record<string, CellState>;
}

export interface MatrixData {
  platforms: { id: number; code: string; name: string }[];
  activities: MatrixActivity[];
}

export interface SyncLog {
  id: number;
  level: "info" | "success" | "warning" | "error";
  message: string;
  detail: Record<string, unknown>;
  created_at: string;
  pipeline: number | null;
  pipeline_name: string | null;
  activity: number | null;
  activity_name: string | null;
}

// ---------- FIT 解析详情 ----------

export interface FitSummary {
  start_time: string | null;
  sport: string | null;
  activity_type: string;
  distance_km: number;
  duration: number;
  total_ascent: number | null;
  total_descent: number | null;
  calories: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  avg_power: number | null;
  max_power: number | null;
  normalized_power: number | null;
  avg_cadence: number | null;
  max_cadence: number | null;
  avg_speed_kmh: number | null;
  max_speed_kmh: number | null;
  sample_count: number;
  raw_record_count: number;
  /** 实际存储的轨迹点数 */
  track_point_count: number;
  /** FIT 原始含 GPS 的点数 */
  raw_track_count: number;
  /** 是否因超过上限而抽稀过（true 表示点数被裁剪） */
  downsampled: boolean;
  has_gps: boolean;
  /** 全部预留指标的槽位统计（无数据则 count=0），前端据此决定画曲线还是留空白图 */
  metrics: Record<string, FitMetricStats>;
  /** 该文件实际包含哪些指标（metrics 中 count>0 的键，顺序与后端注册表一致） */
  available_metrics: string[];
  threshold_power?: number | null;
  training_stress_score?: number | null;
  intensity_factor?: number | null;
  total_training_effect?: number | null;
  total_cycles?: number | null;
  avg_temperature?: number | null;
  max_temperature?: number | null;
  avg_grade?: number | null;
}

/** 单个指标的统计：有效点数与极值 */
export interface FitMetricStats {
  count: number;
  avg: number | null;
  max: number | null;
  min: number | null;
}

export interface FitSample {
  t: number | null;
  distance_km: number | null;
  speed_kmh?: number | null;
  heart_rate?: number | null;
  power?: number | null;
  cadence?: number | null;
  altitude?: number | null;
  lat?: number | null;
  lng?: number | null;
  /** 预留：其余 FIT 指标（坡度 / 温度 / 卡路里 / 垂直振幅 / 触地时间 / 步幅 / 肌氧 / 踩踏平顺度 / 扭矩效率 / 累计功率…） */
  [metric: string]: number | null | undefined;
}

export interface FitDetail {
  id: number;
  activity: number;
  file_name: string;
  file_size: number;
  file_hash: string;
  device: {
    manufacturer: string | null;
    product: string | null;
    serial_number: number | null;
    time_created: string | null;
  };
  summary: FitSummary;
  samples: FitSample[];
  /** 轨迹点，顺序为 [经度, 纬度] */
  track: [number, number][];
  parsed_at: string;
  created_at: string;
}

export interface FitUploadResult {
  created: boolean;
  activity: Activity;
  detail: FitDetail;
}

/** FIT 导入历史（列表项，不含采样点与轨迹） */
export interface FitHistoryItem {
  id: number;
  activity_id: number;
  activity_name: string;
  activity_type: string;
  start_timestamp: string;
  distance: number;
  duration: number;
  source_platform: string;
  file_name: string;
  file_size: number;
  file_hash: string;
  parsed_at: string;
  created_at: string;
  sample_count: number;
  track_point_count: number;
  has_gps: boolean;
  device_name: string;
}

export interface DashboardStats {
  total_activities: number;
  synced: number;
  pending: number;
  failed: number;
  sync_rate: number;
  platform_distribution: { platform: string; count: number }[];
  trend_30d: { date: string; count: number }[];
  recent_syncs: { activity_id: number; activity: string; platform: string; synced_at: string }[];
}
