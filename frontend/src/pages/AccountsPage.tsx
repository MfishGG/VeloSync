import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Info,
  Link2,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Terminal,
  UserCheck,
} from "lucide-react";
import { ApiError, api } from "../api/client";
import { useAccounts, useDeleteAccount, usePlatforms, qk } from "../api/queries";
import type { Platform } from "../api/types";

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: "有效", cls: "bg-emerald-50 text-emerald-600" },
  expired: { label: "已过期", cls: "bg-amber-50 text-amber-600" },
  revoked: { label: "已撤销", cls: "bg-red-50 text-red-600" },
};

/** 未配置凭证的平台：记录缺失字段，用于展开引导面板 */
interface CredentialGap {
  platform: Platform;
  missing: string[];
}

export default function AccountsPage() {
  const { data: platforms } = usePlatforms();
  const { data: accounts, refetch, isFetching } = useAccounts();
  const deleteMutation = useDeleteAccount();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [gap, setGap] = useState<CredentialGap | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  const bind = async (platform: Platform) => {
    setBusy(platform.code);
    setMessage(null);
    setGap(null);
    try {
      const res = await api<{ authorize_url: string | null; mock?: boolean }>(
        `/accounts/${platform.code}/authorize/`
      );
      if (res.authorize_url) {
        window.location.href = res.authorize_url; // 跳转平台授权页
        return;
      }
      // 演示平台：后端已直接建号
      setOk(true);
      setMessage(`${platform.name} 演示账号已绑定`);
      await queryClient.invalidateQueries({ queryKey: qk.accounts });
    } catch (err) {
      setOk(false);
      if (err instanceof ApiError && err.code === "oauth_not_configured") {
        const missing = (err.payload?.missing as string[] | undefined) ?? platform.oauth_missing ?? [];
        setGap({ platform, missing });
        setMessage(null);
      } else {
        setMessage(err instanceof Error ? err.message : "绑定失败");
      }
    } finally {
      setBusy(null);
    }
  };

  /** 未配置凭证时的本地演示绑定：后端签发演示 Token，用于跑通全链路 */
  const demoBind = async (platform: Platform) => {
    setDemoBusy(true);
    try {
      await api(`/accounts/${platform.code}/demo-bind/`, { method: "POST" });
      setOk(true);
      setGap(null);
      setMessage(`已以演示身份绑定 ${platform.name}（本地体验用，平台侧不会收到真实请求）`);
      await queryClient.invalidateQueries({ queryKey: qk.accounts });
    } catch (err) {
      setOk(false);
      setMessage(err instanceof Error ? err.message : "演示绑定失败");
    } finally {
      setDemoBusy(false);
    }
  };

  const boundByPlatform = (code: string) => (accounts ?? []).filter((a) => a.platform.code === code);
  const boundPlatformIds = new Set((accounts ?? []).map((a) => a.platform.id));

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-xl font-bold text-slate-800">账号管理</h1>
        <p className="text-sm text-slate-400">
          OAuth 授权绑定各运动平台 · Token 加密存储 · 支持同平台多账号
        </p>
      </header>

      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            ok ? "bg-indigo-50 text-indigo-700" : "bg-red-50 text-red-600"
          }`}
        >
          {message}
        </div>
      )}

      {/* 未配置凭证时的引导面板 */}
      {gap && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-800">
                {gap.platform.name} 还没有配置 OAuth 凭证
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-700">
                绑定真实账号需要先在 {gap.platform.name} 的开放平台申请应用，拿到凭证后写入平台数据：
              </p>
              {gap.missing.length > 0 && (
                <p className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-amber-700">缺少：</span>
                  {gap.missing.map((f) => (
                    <code
                      key={f}
                      className="rounded bg-white/70 px-1.5 py-0.5 text-[11px] text-amber-800"
                    >
                      {f}
                    </code>
                  ))}
                </p>
              )}
              <div className="mt-3 space-y-1.5 rounded-lg border border-amber-200 bg-white/70 p-3 text-xs text-amber-800">
                <p className="flex items-center gap-1.5 font-medium">
                  <Info className="h-3.5 w-3.5" /> 两种做法
                </p>
                <p className="pl-5">
                  <span className="font-medium">① 本地体验（推荐先用）：</span>
                  点下面的「以演示身份绑定」，即可跑通「绑定 → 建同步任务 → 运行 → 看日志」全链路。
                </p>
                <p className="flex items-start gap-1.5 pl-0">
                  <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="pl-0">
                    <span className="font-medium">② 真实接入：</span>
                    拿到凭证后，在 Django Admin 的「平台」里填写，
                    <br />
                    或执行：
                    <code className="ml-1 rounded bg-white px-1.5 py-0.5 text-[11px]">
                      python manage.py set_platform_oauth {gap.platform.code} --authorize-url … --token-url …
                      --client-id … --client-secret … --scopes …
                    </code>
                    <br />
                    查看各平台状态与申请入口：
                    <code className="ml-1 rounded bg-white px-1.5 py-0.5 text-[11px]">
                      python manage.py set_platform_oauth --list
                    </code>
                  </span>
                </p>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => void demoBind(gap.platform)}
                  disabled={demoBusy}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  {demoBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <UserCheck className="h-3.5 w-3.5" />
                  )}
                  以演示身份绑定
                </button>
                <button
                  onClick={() => setGap(null)}
                  className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
                >
                  先不绑定
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-600">可绑定的平台</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(platforms ?? []).map((p) => {
            const bound = boundByPlatform(p.code);
            const needsCreds = p.auth_type !== "mock" && !p.oauth_ready;
            return (
              <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                      <Link2 className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-800">{p.name}</h3>
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">
                        {p.auth_type} · {(p.capabilities ?? {}).upload ? "可上传" : "仅拉取"}
                      </p>
                    </div>
                  </div>
                  {boundPlatformIds.has(p.id) ? (
                    <ShieldCheck className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <ShieldAlert className="h-5 w-5 text-slate-300" />
                  )}
                </div>
                {needsCreds && (
                  <p
                    className="mt-3 flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-600"
                    title={`缺少：${p.oauth_missing.join("、")}`}
                  >
                    <AlertTriangle className="h-3 w-3 shrink-0" /> 未配置 OAuth 凭证 · 可演示绑定
                  </p>
                )}
                <button
                  onClick={() => void bind(p)}
                  disabled={busy === p.code}
                  className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 py-2 text-xs font-medium text-indigo-600 hover:bg-indigo-100 disabled:opacity-50"
                >
                  {busy === p.code ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" />
                  )}
                  {bound.length > 0 ? "重新授权 / 再绑一个账号" : "绑定账号"}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-600">已绑定账号（{(accounts ?? []).length}）</h2>
          <button
            onClick={() => void refetch()}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> 刷新
          </button>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">平台</th>
                <th className="px-5 py-3 font-medium">账号</th>
                <th className="px-5 py-3 font-medium">状态</th>
                <th className="px-5 py-3 font-medium">Token 有效期</th>
                <th className="px-5 py-3 font-medium">绑定时间</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {(accounts ?? []).map((a) => {
                const badge = STATUS_BADGE[a.status] ?? STATUS_BADGE.active;
                return (
                  <tr key={a.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-3 font-medium text-slate-700">{a.platform.name}</td>
                    <td className="px-5 py-3 text-slate-500">
                      <span className="inline-flex items-center gap-1.5">
                        {a.display_name || a.platform_user_id}
                        {/^(demo|mock)-/.test(a.platform_user_id) && (
                          <span
                            className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
                            title="本地演示身份，未接入真实平台，无法真实拉取/上传数据"
                          >
                            演示身份
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`rounded-md px-2 py-0.5 text-xs ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-400">
                      {a.token_expires_at ? new Date(a.token_expires_at).toLocaleString("zh-CN") : "长期"}
                    </td>
                    <td className="px-5 py-3 text-slate-400">
                      {new Date(a.created_at).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => void bind(a.platform)}
                        className="mr-1 rounded-md p-1.5 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"
                        title="重新授权"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`确定解绑 ${a.platform.name} · ${a.display_name || a.platform_user_id} 吗？`)) {
                            void deleteMutation.mutateAsync(a.id);
                          }
                        }}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                        title="解绑"
                      >
                        <LogOut className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {(accounts ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                    尚未绑定任何平台账号，点击上方卡片开始绑定
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
