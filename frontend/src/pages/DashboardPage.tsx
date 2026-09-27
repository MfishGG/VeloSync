import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Gauge,
  ListChecks,
} from "lucide-react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useDashboardStats } from "../api/queries";

const PIE_COLORS = ["#6366f1", "#0ea5e9", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6"];

function StatCard({ icon: Icon, label, value, accent }: { icon: typeof Gauge; label: string; value: string | number; accent: string }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${accent}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-800">{value}</div>
        <div className="text-xs text-slate-400">{label}</div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: stats, isLoading } = useDashboardStats();

  if (isLoading || !stats) {
    return <div className="p-8 text-sm text-slate-400">加载仪表盘数据中…</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-xl font-bold text-slate-800">仪表盘</h1>
        <p className="text-sm text-slate-400">活动同步全局概览 · 近 30 天</p>
      </header>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard icon={ListChecks} label="活动总数" value={stats.total_activities} accent="bg-indigo-50 text-indigo-600" />
        <StatCard icon={CheckCircle2} label="已同步" value={stats.synced} accent="bg-emerald-50 text-emerald-600" />
        <StatCard icon={CircleDashed} label="待同步" value={stats.pending} accent="bg-amber-50 text-amber-600" />
        <StatCard icon={Gauge} label="同步率" value={`${stats.sync_rate}%`} accent="bg-sky-50 text-sky-600" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">近 30 天活动趋势</h2>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={stats.trend_30d} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} interval={4} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={false} name="活动数" />
            </LineChart>
          </ResponsiveContainer>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">平台分布（按来源）</h2>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={stats.platform_distribution}
                dataKey="count"
                nameKey="platform"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={3}
              >
                {stats.platform_distribution.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap gap-3">
            {stats.platform_distribution.map((d, i) => (
              <span key={d.platform} className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                {d.platform}（{d.count}）
              </span>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-700">最近同步</h2>
          <Clock3 className="h-4 w-4 text-slate-300" />
        </header>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-50 text-left text-xs text-slate-400">
              <th className="px-5 py-2.5 font-medium">活动</th>
              <th className="px-5 py-2.5 font-medium">平台</th>
              <th className="px-5 py-2.5 font-medium">同步时间</th>
            </tr>
          </thead>
          <tbody>
            {stats.recent_syncs.map((r, i) => (
              <tr key={i} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-2.5">
                  <span className="flex items-center gap-2">
                    <ArrowRight className="h-3.5 w-3.5 text-emerald-400" />
                    {r.activity}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-slate-500">{r.platform}</td>
                <td className="px-5 py-2.5 text-slate-400">
                  {new Date(r.synced_at).toLocaleString("zh-CN")}
                </td>
              </tr>
            ))}
            {stats.recent_syncs.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-8 text-center text-slate-400">
                  暂无同步记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {stats.failed > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          有 {stats.failed} 条同步失败记录，可在「活动矩阵」中手动重试。
        </div>
      )}
    </div>
  );
}
