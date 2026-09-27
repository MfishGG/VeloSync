import { useState } from "react";
import { Loader2, X } from "lucide-react";
import type { SocialProvider } from "../api/types";
import SocialIcon from "./SocialIcon";

const PRESETS = ["山道老王", "夜骑小分队", "破风手"];

interface Props {
  provider: SocialProvider;
  onCancel: () => void;
  onConfirm: (identity: string) => Promise<void>;
}

/** 演示模式（未配置真实凭证）下，用一个身份标识模拟第三方账号完成登录/注册 */
export default function SocialLoginDialog({ provider, onCancel, onConfirm }: Props) {
  const [identity, setIdentity] = useState(PRESETS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const value = identity.trim();
    if (!value) {
      setError("请输入一个演示身份");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onConfirm(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: provider.color }}
            >
              <SocialIcon code={provider.icon} className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-slate-800">{provider.name}快捷登录</h3>
              <p className="text-[11px] text-slate-400">演示模式 · 未配置真实凭证</p>
            </div>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
          当前未配置{provider.name}开放平台凭证，可用任意身份模拟授权：首次使用会自动创建账号并绑定，
          再次使用同一身份则直接登录。
        </p>

        <label className="mb-1 block text-xs font-medium text-slate-500">演示身份（昵称）</label>
        <input
          value={identity}
          onChange={(e) => setIdentity(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          autoFocus
        />

        <div className="mt-2 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setIdentity(p)}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-500 hover:bg-indigo-50 hover:text-indigo-600"
            >
              {p}
            </button>
          ))}
        </div>

        {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

        <button
          onClick={() => void submit()}
          disabled={loading}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          以{provider.name}身份进入
        </button>
      </div>
    </div>
  );
}
