import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link2, Loader2, LogOut, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react";
import { api } from "../api/client";
import { useAccounts, useDeleteAccount, usePlatforms, qk } from "../api/queries";
import type { Platform } from "../api/types";

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: "有效", cls: "bg-emerald-50 text-emerald-600" },
  expired: { label: "已过期", cls: "bg-amber-50 text-amber-600" },
  revoked: { label: "已撤销", cls: "bg-red-50 text-red-600" },
};

export default function AccountsPage() {
  const { data: platforms } = usePlatforms();
  const { data: accounts, refetch, isFetching } = useAccounts();
  const deleteMutation = useDeleteAccount();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const bind = async (platform: Platform) => {
    setBusy(platform.code);
    setMessage(null);
    try {
      const res = await api<{ authorize_url: string | null; mock?: boolean }>(
        `/accounts/${platform.code}/authorize/`
      );
      if (res.authorize_url) {
        window.location.href = res.authorize_url; // 跳转平台授权页
        return;
      }
      // 演示平台：后端已直接建号
      setMessage(`✅ ${platform.name} 演示账号已绑定`);
      await queryClient.invalidateQueries({ queryKey: qk.accounts });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "绑定失败");
    } finally {
      setBusy(null);
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
        <div className="rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-700">{message}</div>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-600">可绑定的平台</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(platforms ?? []).map((p) => {
            const bound = boundByPlatform(p.code);
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
                      {a.display_name || a.platform_user_id}
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
