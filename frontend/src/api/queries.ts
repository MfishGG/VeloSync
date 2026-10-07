import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type {
  Activity,
  DashboardStats,
  FitDetail,
  FitHistoryItem,
  FitUploadResult,
  MatrixData,
  Paginated,
  Pipeline,
  PipelineSummary,
  Platform,
  PlatformAccount,
  SocialAuthorizeResult,
  SocialLoginResult,
  SocialProvider,
  SyncLog,
  TokenPair,
  User,
} from "./types";

export const qk = {
  platforms: ["platforms"] as const,
  accounts: ["accounts"] as const,
  pipelines: ["pipelines"] as const,
  pipeline: (id: number) => ["pipelines", id] as const,
  activities: (params: string) => ["activities", params] as const,
  matrix: ["matrix"] as const,
  logs: (params: string) => ["logs", params] as const,
  dashboard: ["dashboard"] as const,
  fitHistory: ["fit", "history"] as const,
};

// ---------- 查询 ----------

export function usePlatforms() {
  return useQuery({ queryKey: qk.platforms, queryFn: () => api<Platform[]>("/platforms/") });
}

export function useAccounts() {
  return useQuery({ queryKey: qk.accounts, queryFn: () => api<PlatformAccount[]>("/accounts/") });
}

export function usePipelines() {
  return useQuery({ queryKey: qk.pipelines, queryFn: () => api<PipelineSummary[]>("/pipelines/") });
}

export function usePipeline(id: number) {
  return useQuery({
    queryKey: qk.pipeline(id),
    queryFn: () => api<Pipeline>(`/pipelines/${id}/`),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useActivities(params: string) {
  return useQuery({
    queryKey: qk.activities(params),
    queryFn: () => api<Paginated<Activity>>(`/activities/${params}`),
  });
}

export function useActivity(id: number | null) {
  return useQuery({
    queryKey: ["activities", "detail", id],
    queryFn: () => api<Activity>(`/activities/${id}/`),
    enabled: id != null,
  });
}

export function useMatrix() {
  return useQuery({ queryKey: qk.matrix, queryFn: () => api<MatrixData>("/activities/matrix/") });
}

export function useLogs(params: string) {
  return useQuery({
    queryKey: qk.logs(params),
    queryFn: () => api<Paginated<SyncLog>>(`/logs/${params}`),
  });
}

export function useDashboardStats() {
  return useQuery({ queryKey: qk.dashboard, queryFn: () => api<DashboardStats>("/dashboard/stats/") });
}

/** 活动是否已解析过 FIT（未解析时后端返回 404） */
export function useFitDetail(activityId: number | null) {
  return useQuery({
    queryKey: ["fit", activityId],
    queryFn: () => api<FitDetail>(`/activities/${activityId}/fit/`),
    enabled: Number.isFinite(activityId) && (activityId ?? 0) > 0,
    retry: false,
  });
}

/** FIT 导入历史（按解析时间倒序） */
export function useFitHistory() {
  return useQuery({
    queryKey: qk.fitHistory,
    queryFn: () => api<FitHistoryItem[]>("/activities/fit-history/"),
  });
}

/** 上传并解析 FIT 文件（multipart） */
export function uploadFit(file: File, name?: string) {
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);
  return api<FitUploadResult>("/activities/upload-fit/", { method: "POST", body: form });
}

/** 删除 FIT 解析详情；withActivity=true 时连活动记录一并删除（204 空响应） */
export function deleteFit(activityId: number, withActivity = false) {
  return api<void>(
    `/activities/${activityId}/fit/${withActivity ? "?with_activity=1" : ""}`,
    { method: "DELETE" },
  );
}

// ---------- 变更 ----------

export function useCreatePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      api<Pipeline>("/pipelines/", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.pipelines }),
  });
}

export function useDeletePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/pipelines/${id}/`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.pipelines }),
  });
}

export interface SavePipelinePayload {
  name: string;
  description: string;
  is_active: boolean;
  auto_run: boolean;
  nodes: {
    client_id: string;
    node_type: string;
    account: number | null;
    config: Record<string, unknown>;
    position_x: number;
    position_y: number;
  }[];
  edges: { source: string; target: string }[];
}

export function useSavePipeline(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SavePipelinePayload) =>
      api<Pipeline>(`/pipelines/${id}/`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: (data) => {
      qc.setQueryData(qk.pipeline(id), data);
      qc.invalidateQueries({ queryKey: qk.pipelines });
    },
  });
}

export function useRunPipeline(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ id: number; status: string }>(`/pipelines/${id}/run/`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.pipelines });
      qc.invalidateQueries({ queryKey: qk.logs("") });
    },
  });
}

export function useSyncCell() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { activityId: number; platformId: number }) =>
      api<{ status: string; error_message: string }>(`/activities/${vars.activityId}/sync/`, {
        method: "POST",
        body: JSON.stringify({ platform_id: vars.platformId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.matrix });
      qc.invalidateQueries({ queryKey: qk.dashboard });
      qc.invalidateQueries({ queryKey: qk.logs("") });
    },
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/accounts/${id}/`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.accounts }),
  });
}

// ---------- 认证 ----------

export function login(username: string, password: string) {
  return api<TokenPair>("/auth/login/", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function register(payload: {
  username: string;
  password: string;
  email?: string;
  nickname?: string;
}) {
  return api<TokenPair>("/auth/register/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchMe() {
  return api<User>("/auth/me/");
}

/** 可用的第三方快捷登录方式（后端按是否配置凭证返回 oauth / mock 模式） */
export function fetchSocialProviders() {
  return api<{ results: SocialProvider[] }>("/auth/social/providers/").then((r) => r.results);
}

export function socialAuthorize(provider: string) {
  return api<SocialAuthorizeResult>(`/auth/social/${provider}/authorize/`);
}

/** 第三方登录/注册：oauth 模式传 code，mock 模式传 identity（演示身份昵称） */
export function socialLogin(vars: { provider: string; code?: string; identity?: string }) {
  return api<SocialLoginResult>("/auth/social/login/", {
    method: "POST",
    body: JSON.stringify(vars),
  });
}
