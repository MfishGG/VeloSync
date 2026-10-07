// API 客户端：JWT 自动附带 + 401 自动刷新重试

const BASE = "/api";

/** 带状态码与业务错误码的异常，便于页面按 code 分支处理（例如 oauth_not_configured） */
export class ApiError extends Error {
  status: number;
  code?: string;
  payload: Record<string, unknown> | null;

  constructor(message: string, status: number, payload: Record<string, unknown> | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = typeof payload?.code === "string" ? payload.code : undefined;
    this.payload = payload;
  }
}

let accessToken: string | null = localStorage.getItem("velosync_access");
let refreshToken: string | null = localStorage.getItem("velosync_refresh");

export function getAccessToken(): string | null {
  return accessToken;
}

export function setTokens(access: string, refresh: string): void {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem("velosync_access", access);
  localStorage.setItem("velosync_refresh", refresh);
}

export function clearTokens(): void {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem("velosync_access");
  localStorage.removeItem("velosync_refresh");
}

async function refreshAccess(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${BASE}/auth/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: refreshToken }),
    });
    if (!res.ok) {
      clearTokens();
      return false;
    }
    const data = (await res.json()) as { access: string; refresh?: string };
    setTokens(data.access, data.refresh ?? refreshToken);
    return true;
  } catch {
    return false;
  }
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  // FormData 交给浏览器自动设置带 boundary 的 Content-Type，不能写死 json
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  const doFetch = () =>
    fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        ...(isForm ? {} : { "Content-Type": "application/json" }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(options.headers ?? {}),
      },
    });

  let res = await doFetch();
  if (res.status === 401 && refreshToken) {
    if (await refreshAccess()) {
      res = await doFetch();
    }
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const detail = typeof body?.detail === "string" ? body.detail : `请求失败（${res.status}）`;
    throw new ApiError(detail, res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
