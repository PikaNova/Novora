import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatClockInZone, getZonedParts } from "../utils/zonedTime";
import { logoutAdmin } from "../services/examService";
import Mascot from "./Mascot";
import { Activity, CalendarDays, CalendarRange, CheckCircle2, Clock3, Monitor, PlayCircle, Sun, Timer } from "lucide-react";
import "../styles/dashboard.css";

type DashboardEntry = {
  id: string;
  subject: string;
  majorName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  scopeLabel: string;
};

type DistributionRow = { label: string; count: number; percent: number };

type OnlineDeviceRow = {
  instanceId: string;
  scopeLabel: string;
  statusLabel: string;
  inExam: boolean;
  lastSeenAt: number;
};

type DashboardPayload = {
  ok: true;
  scopeLabel: string;
  isAllScope: boolean;
  stats: {
    total: number;
    ongoing: number;
    upcoming: number;
    ended: number;
    today: number;
    thisWeek: number;
    onlineDevices: number;
    inExamDevices: number;
  };
  ongoing: DashboardEntry[];
  upcoming: DashboardEntry[];
  recentEnded: DashboardEntry[];
  subjectDistribution: DistributionRow[];
  gradeDistribution: DistributionRow[];
  onlineDevices: OnlineDeviceRow[];
  updatedAt: number;
};

const TOKEN_KEY = "admin_auth_token";
const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];


function useCountUp(value: number, duration = 700): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    fromRef.current = value;
    const start = performance.now();
    let raf = 0;
    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return display;
}
function countdownLabel(startTime: string, now: number): string {
  const diff = new Date(startTime).getTime() - now;
  if (diff <= 0) return "即将开始";
  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) return minutes + " 分钟后";
  const hours = Math.ceil(diff / 3_600_000);
  if (hours < 24) return hours + " 小时后";
  return Math.floor(hours / 24) + " 天后";
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return minutes + " 分钟";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? hours + " 小时 " + rest + " 分钟" : hours + " 小时";
}

function timeRangeLabel(startTime: string, endTime: string): string {
  const date = startTime.slice(0, 10).replace(/-/g, "/");
  return date + " " + startTime.slice(11, 16) + " - " + endTime.slice(11, 16);
}

function Kpi({ icon, value, label }: { icon: React.ReactNode; value: number | string; label: string }) {
  return (
    <div className="dashboard-kpi">
      <span className="dashboard-kpi__icon">{icon}</span>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="dashboard-empty">
      <Mascot className="mascot-empty" size={64} alt="" />
      {text}
    </div>
  );
}

function EntryRow({ entry, now, showCountdown }: { entry: DashboardEntry; now: number; showCountdown: boolean }) {
  return (
    <div className="dashboard-entry">
      <div className="dashboard-entry__main">
        <strong>{entry.subject}</strong>
        <span>{entry.majorName} · {timeRangeLabel(entry.startTime, entry.endTime)} · {durationLabel(entry.durationMinutes)}</span>
        <small>{entry.scopeLabel}</small>
      </div>
      {showCountdown && <em>{countdownLabel(entry.startTime, now)}</em>}
    </div>
  );
}

function BarRows({ rows, emptyText }: { rows: DistributionRow[]; emptyText: string }) {
  if (!rows.length) return <EmptyState text={emptyText} />;
  return (
    <div className="dashboard-bars">
      {rows.map(row => (
        <div className="dashboard-bar" key={row.label}>
          <span className="dashboard-bar__label">{row.label}</span>
          <span className="dashboard-bar__track"><i style={{ width: row.percent + "%" }} /></span>
          <span className="dashboard-bar__meta">{row.count} 场 · {row.percent}%</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPanel() {
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now());
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const token = localStorage.getItem(TOKEN_KEY) || "";
    const res = await fetch("/api/exams?action=dashboard", {
      headers: token ? { Authorization: "Bearer " + token } : {},
      signal,
    });
    if (res.status === 401) {
      logoutAdmin();
      navigate("/login?next=/settings", { replace: true });
      return;
    }
    if (res.status === 403) {
      setError("当前账号没有查看数据大屏的权限");
      return;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      setError(body?.error || "数据读取失败");
      return;
    }
    setData(body as DashboardPayload);
    setError("");
  }, [navigate]);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    const timer = window.setInterval(() => refresh(), 30_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, [refresh]);

  const parts = getZonedParts(now);
  const dateLabel = parts.year + "年" + parts.month + "月" + parts.day + "日 星期" + WEEKDAY_NAMES[parts.weekday];
  const stats = data?.stats;
  const displayTotal = useCountUp(stats?.total ?? 0);
  const displayOngoing = useCountUp(stats?.ongoing ?? 0);
  const displayUpcoming = useCountUp(stats?.upcoming ?? 0);
  const displayToday = useCountUp(stats?.today ?? 0);
  const displayOnline = useCountUp(stats?.onlineDevices ?? 0);
  const displayWeek = useCountUp(stats?.thisWeek ?? 0);

  return (
    <main className="dashboard">
        <div className="dashboard__head">
          <div>
            <h1>{data?.scopeLabel ?? "数据大屏"}</h1>
            <p>实时监控考试状态与设备情况</p>
          </div>
          <div className="dashboard__clock">
            <strong>{formatClockInZone(now)}</strong>
            <span>{dateLabel}</span>
          </div>
        </div>
        {error && <div className="dashboard__error">{error}</div>}
        {!data && !error ? (
          <div className="dashboard-loading">正在载入数据…</div>
        ) : (
          <>
            <section className="dashboard-kpis">
              <Kpi icon={<CalendarDays size={20} />} value={displayTotal} label="考试总数" />
              <Kpi icon={<Activity size={20} />} value={displayOngoing} label="进行中" />
              <Kpi icon={<Clock3 size={20} />} value={displayUpcoming} label="即将开始" />
              <Kpi icon={<Sun size={20} />} value={displayToday} label="今日考试" />
              <Kpi icon={<Monitor size={20} />} value={displayOnline} label={"在线设备 · 考试中" + (stats?.inExamDevices ?? 0)} />
              <Kpi icon={<CalendarRange size={20} />} value={displayWeek} label="本周考试" />
            </section>
            <section className="dashboard-cols">
              <section className="dashboard-panel">
                <header><h2><PlayCircle size={16} /> 进行中的考试</h2><span>最近 {data?.ongoing.length ?? 0} 场</span></header>
                {data?.ongoing.length ? data.ongoing.map(entry => <EntryRow key={entry.id} entry={entry} now={now} showCountdown={false} />) : <EmptyState text="暂无进行中的考试" />}
              </section>
              <section className="dashboard-panel">
                <header><h2><Timer size={16} /> 即将开始</h2><span>最近 {data?.upcoming.length ?? 0} 场</span></header>
                {data?.upcoming.length ? data.upcoming.map(entry => <EntryRow key={entry.id} entry={entry} now={now} showCountdown />) : <EmptyState text="暂无即将开始的考试" />}
              </section>
            </section>
            <section className="dashboard-cols">
              <section className="dashboard-panel">
                <header><h2><Monitor size={16} /> 当前在线设备</h2><span>{stats?.onlineDevices ?? 0} 台在线</span></header>
                {data?.onlineDevices?.length ? (
                  <div className="dashboard-devices">
                    {data.onlineDevices.map(device => (
                      <div className="dashboard-device" key={device.instanceId}>
                        <span className={`dashboard-device__dot${device.inExam ? " is-exam" : ""}`} aria-hidden="true" />
                        <div className="dashboard-device__main">
                          <strong>{device.scopeLabel}</strong>
                          <span>{device.instanceId} · {device.statusLabel}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="暂无在线设备" />
                )}
              </section>
              <section className="dashboard-panel">
                <header><h2><CheckCircle2 size={16} /> 最近结束</h2><span>最近 {data?.recentEnded.length ?? 0} 场</span></header>
                {data?.recentEnded.length ? data.recentEnded.map(entry => <EntryRow key={entry.id} entry={entry} now={now} showCountdown={false} />) : <EmptyState text="暂无已结束的考试" />}
              </section>
            </section>
            <div className="dashboard__foot">
              最后同步 {data?.updatedAt ? new Date(data.updatedAt).toLocaleString("zh-CN") : "—"} · 每 30 秒自动刷新
            </div>
          </>
        )}
    </main>
  );
}
