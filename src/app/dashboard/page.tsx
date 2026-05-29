import { cookies } from "next/headers";
import { kv } from "@/lib/kv";
import LoginForm from "@/components/LoginForm";

function getLast7Days(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

async function getStats() {
  const days = getLast7Days();

  const pvKeys = days.map((d) => `pv:${d}`);
  const uvKeys = days.map((d) => `uv:${d}`);

  const [pvCounts, uvCounts] = await Promise.all([
    kv.mget<number[]>(...pvKeys),
    Promise.all(uvKeys.map((k) => kv.pfcount(k))),
  ]);

  const daily = days.map((date, i) => ({
    date: date.slice(5),
    pv: pvCounts[i] ?? 0,
    uv: uvCounts[i] ?? 0,
  }));

  const today = daily[daily.length - 1];
  const totalPV = daily.reduce((s, d) => s + d.pv, 0);
  const totalUV = daily.reduce((s, d) => s + d.uv, 0);
  const maxPV = Math.max(...daily.map((d) => d.pv), 1);

  return { daily, today, totalPV, totalUV, maxPV };
}

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("dashboard_token")?.value;
  const password = process.env.DASHBOARD_PASSWORD;

  // 未设置密码或 token 不匹配 → 显示登录表单
  if (!password || token !== password) {
    return <LoginForm />;
  }

  const { daily, today, totalPV, totalUV, maxPV } = await getStats();

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <h1>访问统计</h1>
        <span className="dashboard-sub">近 7 天数据</span>
      </div>

      <div className="stats-cards">
        <div className="stat-card">
          <div className="stat-label">今日浏览量</div>
          <div className="stat-value">{today.pv}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">今日访客</div>
          <div className="stat-value">{today.uv}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">7 天浏览</div>
          <div className="stat-value">{totalPV}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">7 天访客</div>
          <div className="stat-value">{totalUV}</div>
        </div>
      </div>

      <div className="chart-section">
        <h2>趋势</h2>
        <div className="bar-chart">
          {daily.map((d) => (
            <div key={d.date} className="bar-col">
              <div className="bar-label">{d.pv}</div>
              <div
                className="bar-fill"
                style={{ height: `${(d.pv / maxPV) * 100}%` }}
              />
              <div className="bar-uv">{d.uv} 访客</div>
              <div className="bar-date">{d.date}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
