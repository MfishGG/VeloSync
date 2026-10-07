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
}

export interface Pipeline extends PipelineSummary {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
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
}

export interface FitSample {
  t: number | null;
  distance_km: number | null;
  speed_kmh: number | null;
  heart_rate: number | null;
  power: number | null;
  cadence: number | null;
  altitude: number | null;
  lat: number | null;
  lng: number | null;
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
