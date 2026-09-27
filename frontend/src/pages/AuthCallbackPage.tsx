import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";

/** 第三方 OAuth 回调落地页：接收后端签发的 JWT 后进入工作台 */
export default function AuthCallbackPage() {
  const [params] = useSearchParams();
  const applyTokenPair = useAuthStore((s) => s.applyTokenPair);
  const [state, setState] = useState<"pending" | "done" | "error">("pending");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const access = params.get("access");
    const refresh = params.get("refresh");
    if (!access || !refresh) {
      setError("回调缺少令牌，请重新发起登录");
      setState("error");
      return;
    }
    applyTokenPair(access, refresh);
    setState("done");
  }, [params, applyTokenPair]);

  if (state === "done") return <Navigate to="/" replace />;

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-indigo-50 via-slate-100 to-sky-50">
      <div className="w-80 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl">
        {state === "error" ? (
          <>
            <AlertCircle className="mx-auto mb-3 h-8 w-8 text-red-500" />
            <p className="mb-4 text-sm text-slate-600">{error}</p>
            <Link
              to="/login"
              className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
            >
              返回登录
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-indigo-600" />
            <p className="text-sm text-slate-500">正在完成第三方登录…</p>
          </>
        )}
      </div>
    </div>
  );
}
