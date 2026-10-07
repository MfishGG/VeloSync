import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Bike, CheckCircle2, Loader2 } from "lucide-react";
import SocialIcon from "../components/SocialIcon";
import SocialLoginDialog from "../components/SocialLoginDialog";
import { fetchSocialProviders, socialAuthorize } from "../api/queries";
import type { SocialProvider } from "../api/types";
import { useAuthStore } from "../stores/authStore";

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

export default function LoginPage() {
  const token = useAuthStore((s) => s.token);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const socialLogin = useAuthStore((s) => s.socialLogin);
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [tab, setTab] = useState<"login" | "register">("login");

  // 登录
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // 注册
  const [rUsername, setRUsername] = useState("");
  const [rNickname, setRNickname] = useState("");
  const [rEmail, setREmail] = useState("");
  const [rPassword, setRPassword] = useState("");
  const [rConfirm, setRConfirm] = useState("");

  const [error, setError] = useState<string | null>(params.get("social_error"));
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<SocialProvider[]>([]);
  const [providersFailed, setProvidersFailed] = useState(false);
  const [dialog, setDialog] = useState<SocialProvider | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    fetchSocialProviders()
      .then((list) => alive && setProviders(list))
      .catch(() => {
        if (!alive) return;
        setProviders([]);
        setProvidersFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  if (token) return <Navigate to="/" replace />;

  const flash = (msg: string) => {
    setNotice(msg);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3200);
  };

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  const submitRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (rUsername.trim().length < 3) return setError("用户名至少 3 个字符");
    if (rPassword.length < 6) return setError("密码至少 6 位");
    if (rPassword !== rConfirm) return setError("两次输入的密码不一致");
    if (rEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rEmail)) return setError("邮箱格式不正确");

    setLoading(true);
    try {
      await register({
        username: rUsername.trim(),
        password: rPassword,
        email: rEmail.trim(),
        nickname: rNickname.trim(),
      });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setLoading(false);
    }
  };

  const handleSocial = async (provider: SocialProvider) => {
    setError(null);
    try {
      const res = await socialAuthorize(provider.code);
      if (res.mode === "oauth" && res.authorize_url) {
        window.location.href = res.authorize_url; // 跳真实授权页，回调会带回 token
        return;
      }
      setDialog(provider); // 演示模式：选个身份直接进
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取授权信息失败");
    }
  };

  const confirmSocial = async (identity: string) => {
    if (!dialog) return;
    const res = await socialLogin({ provider: dialog.code, identity });
    setDialog(null);
    flash(res.created ? `已用${dialog.name}创建账号并登录` : `欢迎回来，${res.user.nickname || res.user.username}`);
    navigate("/", { replace: true });
  };

  const switchTab = (next: "login" | "register") => {
    setTab(next);
    setError(null);
  };

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-indigo-50 via-slate-100 to-sky-50">
      <div className="w-96 rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <Bike className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">VeloSync 速同</h1>
            <p className="text-xs text-slate-400">跨平台运动数据同步中枢</p>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
          {(["login", "register"] as const).map((key) => (
            <button
              key={key}
              onClick={() => switchTab(key)}
              className={`rounded-md py-1.5 text-sm font-medium transition ${
                tab === key ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {key === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        {tab === "login" ? (
          <form onSubmit={submitLogin} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">用户名</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputCls}
                placeholder="demo"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
                placeholder="••••••••"
              />
            </div>
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
            {notice && (
              <p className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {notice}
              </p>
            )}
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              登录工作台
            </button>
          </form>
        ) : (
          <form onSubmit={submitRegister} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">用户名 *</label>
              <input
                value={rUsername}
                onChange={(e) => setRUsername(e.target.value)}
                className={inputCls}
                placeholder="rider01"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">昵称</label>
              <input
                value={rNickname}
                onChange={(e) => setRNickname(e.target.value)}
                className={inputCls}
                placeholder="破风手"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">邮箱</label>
              <input
                value={rEmail}
                onChange={(e) => setREmail(e.target.value)}
                className={inputCls}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">密码 *（至少 6 位）</label>
              <input
                type="password"
                value={rPassword}
                onChange={(e) => setRPassword(e.target.value)}
                className={inputCls}
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">确认密码 *</label>
              <input
                type="password"
                value={rConfirm}
                onChange={(e) => setRConfirm(e.target.value)}
                className={inputCls}
                placeholder="••••••••"
              />
            </div>
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading || !rUsername || !rPassword || !rConfirm}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              注册并进入
            </button>
          </form>
        )}

        {providers.length > 0 ? (
          <>
            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-slate-200" />
              <span className="text-[11px] text-slate-400">或使用第三方账号</span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>
            <div className="flex items-center justify-center gap-3">
              {providers.map((p) => (
                <button
                  key={p.code}
                  onClick={() => void handleSocial(p)}
                  title={`${p.name}快捷登录${p.mode === "mock" ? "（演示模式）" : ""}`}
                  className="group flex flex-col items-center gap-1"
                >
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full text-white shadow-sm transition group-hover:brightness-95"
                    style={{ backgroundColor: p.color }}
                  >
                    <SocialIcon code={p.icon} className="h-5 w-5" />
                  </span>
                  <span className="text-[11px] text-slate-500 group-hover:text-slate-700">{p.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          providersFailed && (
            <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
              第三方登录暂不可用：无法连接后端服务。请先在 backend 目录启动 Django（<code>python manage.py runserver</code>，默认 127.0.0.1:8000）后刷新页面。
            </p>
          )
        )}

        {tab === "login" && (
          <button
            onClick={() => {
              setUsername("demo");
              setPassword("demo123456");
            }}
            className="mt-5 w-full rounded-lg border border-dashed border-slate-200 py-2 text-xs text-slate-400 hover:border-indigo-300 hover:text-indigo-500"
          >
            一键填充演示账号（demo / demo123456）
          </button>
        )}
      </div>

      {dialog && (
        <SocialLoginDialog
          provider={dialog}
          onCancel={() => setDialog(null)}
          onConfirm={confirmSocial}
        />
      )}
    </div>
  );
}
