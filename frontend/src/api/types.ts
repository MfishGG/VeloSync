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
