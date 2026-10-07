import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Keyboard, LogOut, Server, User } from "lucide-react";
import ConfirmDialog from "../components/ConfirmDialog";
import { useAuthStore } from "../stores/authStore";

function EnvItem({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3">
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`text-xs font-medium ${ok ? "text-emerald-600" : "text-amber-600"}`}>
        {detail}
      </span>
    </div>
  );
}

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [logoutOpen, setLogoutOpen] = useState(false);

  const doLogout = () => {
    setLogoutOpen(false);
    logout();
    navigate("/login", { replace: true });
  };

  useEffect(() => {
    let alive = true;
    fetch("/api/platforms/")
      .then((r) => alive && setApiOk(r.status === 401)) // 401 说明服务在线且要求认证
      .catch(() => alive && setApiOk(false));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-xl font-bold text-slate-800">设置</h1>
        <p className="text-sm text-slate-400">工作台账户与环境信息</p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <User className="h-4 w-4 text-slate-400" /> 当前用户
        </h2>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-slate-50 p-3">
            <dt className="text-xs text-slate-400">用户名</dt>
            <dd className="mt-0.5 font-medium">{user?.username ?? "—"}</dd>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <dt className="text-xs text-slate-400">昵称</dt>
            <dd className="mt-0.5 font-medium">{user?.nickname || "未设置"}</dd>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <dt className="text-xs text-slate-400">邮箱</dt>
            <dd className="mt-0.5 font-medium">{user?.email || "未设置"}</dd>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <dt className="text-xs text-slate-400">注册时间</dt>
            <dd className="mt-0.5 font-medium">
              {user?.date_joined ? new Date(user.date_joined).toLocaleDateString("zh-CN") : "—"}
            </dd>
          </div>
        </dl>
        <button
          onClick={() => setLogoutOpen(true)}
          className="mt-4 flex items-center gap-1.5 rounded-lg bg-red-50 px-3.5 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
        >
          <LogOut className="h-3.5 w-3.5" /> 退出登录
        </button>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Server className="h-4 w-4 text-slate-400" /> 服务状态
        </h2>
        <div className="space-y-2">
          <EnvItem
            label="Django API（/api → 127.0.0.1:8000）"
            ok={apiOk === true}
            detail={apiOk === null ? "检测中…" : apiOk ? "在线" : "离线（请启动后端）"}
          />
          <EnvItem label="认证方式" ok detail="JWT（2h access / 30d refresh）" />
          <EnvItem label="Token 存储" ok detail="Fernet 对称加密" />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Keyboard className="h-4 w-4 text-slate-400" /> 快捷键
        </h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between rounded-lg border border-slate-100 px-4 py-2.5">
            <span className="text-slate-600">打开命令面板</span>
            <kbd className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-500">Ctrl / Cmd + K</kbd>
          </div>
          <div className="flex justify-between rounded-lg border border-slate-100 px-4 py-2.5">
            <span className="text-slate-600">删除画布选中节点</span>
            <kbd className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-500">Backspace</kbd>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <BookOpen className="h-4 w-4 text-slate-400" /> 开发者资源
        </h2>
        <div className="space-y-2 text-sm">
          <a
            href="/api/docs/"
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg border border-slate-100 px-4 py-2.5 hover:bg-indigo-50"
          >
            <span className="text-indigo-600">OpenAPI 文档（Swagger）</span>
            <span className="mt-0.5 block text-xs text-slate-400">
              /api/docs/ · 开发环境经 Vite 代理转发到后端
            </span>
          </a>
          <a
            href="/admin/"
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg border border-slate-100 px-4 py-2.5 hover:bg-indigo-50"
          >
            <span className="text-indigo-600">Django Admin 后台</span>
            <span className="mt-0.5 block text-xs text-slate-400">
              /admin/ · 账号 admin / admin123456 · 也可直接访问 http://127.0.0.1:8000/admin/
            </span>
          </a>
        </div>
      </section>

      <ConfirmDialog
        open={logoutOpen}
        title="退出登录"
        confirmText="退出登录"
        danger
        onConfirm={doLogout}
        onCancel={() => setLogoutOpen(false)}
      >
        退出后需要重新输入账号密码才能进入工作台，本地保存的登录凭证将被清除。
      </ConfirmDialog>
    </div>
  );
}
