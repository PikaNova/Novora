import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, ChevronLeft, ChevronRight, Download, RefreshCw, Search, X } from 'lucide-react';
import InlineSelect from '../InlineSelect';
import { Switch } from './Switch';
import { DateTimeField } from '../touch-datetime-picker';
import { defaultDiagnosticRange, timestampFromField } from '../../services/diagnosticLogs';
import { fetchSystemStatus, type SystemStatusPayload } from '../../services/systemStatus';
import { runtimeRequest, type RuntimeDashboard as Dashboard, type RuntimeRow } from '../../services/runtimeDashboard';
import { RUNTIME_CATEGORIES } from '../../shared/runtimeLog';
import '../../styles/runtime-dashboard.css';

const time = (at: number) => new Date(Number(at)).toLocaleString('zh-CN', { hour12: false });
function trendLabel(at: number, hours: number, index: number, count: number) {
  const stride = count >= 18 ? 4 : count >= 10 ? 2 : 1;
  if (index % stride !== 0 && index !== count - 1) return '';
  const date = new Date(at);
  if (hours >= 24) return `${date.getMonth() + 1}/${date.getDate()}`;
  return `${date.getHours()}时`;
}
const labels: Record<string, string> = {
  display: '前端显示',
  time: '校时',
  sync: '数据同步',
  device: '设备指令',
  notice: '公告提醒',
  network: '网络',
  page: '页面运行',
  storage: '本地存储',
  pwa: '资源更新',
  server: '服务端',
};
const levels: Record<string, string> = { info: '信息', debug: '调试', warn: '警告', error: '错误' };
const PAGE_SIZE = 10;
type DetailView = 'summary' | 'context' | 'timeline';
type DashboardTab = 'events' | 'devices';
type DeviceRow = Dashboard['devices'][number];
function EventList({ rows, onSelect }: { rows: RuntimeRow[]; onSelect: (row: RuntimeRow) => void }) {
  return (
    <div className="runtime-table-wrap">
      <table className="runtime-table">
        <thead>
          <tr>
            <th>接收时间 / 设备时间</th>
            <th>设备 / 会话序号</th>
            <th>级别 / 类别</th>
            <th>事件</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.instance_id}:${row.event.eventId}`}>
              <td>
                {time(row.received_at)}
                <small>{time(row.event.at)}</small>
              </td>
              <td>
                {row.instance_id}
                <small>
                  #{row.event.sequence} · {row.event.version}
                </small>
              </td>
              <td>
                <span className={`runtime-level is-${row.event.level}`}>{levels[row.event.level]}</span>
                <small>{labels[row.event.category]}</small>
              </td>
              <td>
                <button className="runtime-event-link" onClick={() => onSelect(row)}>
                  {row.event.code}
                </button>
              </td>
              <td>{row.event.message}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={5}>当前筛选范围没有日志。</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export default function RuntimeDashboard({ canExport, canSystem }: { canExport: boolean; canSystem: boolean }) {
  const initial = useRef(defaultDiagnosticRange());
  const [from, setFrom] = useState(initial.current.from),
    [to, setTo] = useState(initial.current.to);
  const [device, setDevice] = useState(''),
    [level, setLevel] = useState(''),
    [category, setCategory] = useState(''),
    [keyword, setKeyword] = useState('');
  const [params, setParams] = useState<Record<string, string>>({
    from: String(timestampFromField(initial.current.from)),
    to: String(Date.now()),
  });
  const [data, setData] = useState<Dashboard | null>(null),
    [system, setSystem] = useState<SystemStatusPayload | null>(null);
  const [systemError, setSystemError] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [selected, setSelected] = useState<RuntimeRow | null>(null),
    [timeline, setTimeline] = useState<RuntimeRow[]>([]),
    [timelineError, setTimelineError] = useState('');
  const [detailView, setDetailView] = useState<DetailView>('summary');
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('events');
  const [deviceQuery, setDeviceQuery] = useState('');
  const [deviceStatus, setDeviceStatus] = useState<'all' | 'online' | 'offline' | 'revoked'>('all');
  const [devicePage, setDevicePage] = useState(0);
  const [selectedDevice, setSelectedDevice] = useState<DeviceRow | null>(null);
  const [auto, setAuto] = useState(true);
  const [live, setLive] = useState(true);
  const [page, setPage] = useState(0);
  const generation = useRef(0);
  const active = useRef(false);
  const detailGeneration = useRef(0);
  const load = useCallback(async () => {
    if (active.current) return;
    active.current = true;
    const g = ++generation.current;
    setBusy(true);
    try {
      const next = await runtimeRequest<Dashboard>(
        'runtime-dashboard',
        live && !params.cursor ? { ...params, from: String(Date.now() - 86400000), to: String(Date.now()) } : params,
      );
      if (g === generation.current) {
        setData(next);
        setError('');
      }
    } catch (e) {
      if (g === generation.current) setError(e instanceof Error ? e.message : '日志读取失败');
    } finally {
      if (g === generation.current) {
        active.current = false;
        setBusy(false);
      }
    }
    if (canSystem) {
      try {
        const next = await fetchSystemStatus();
        if (g === generation.current) {
          setSystem(next);
          setSystemError('');
        }
      } catch (e) {
        if (g === generation.current) setSystemError(e instanceof Error ? e.message : '系统状态不可用');
      }
    }
  }, [params, canSystem, live]);
  useEffect(() => {
    active.current = false;
    void load();
    const timer = setInterval(() => {
      if (auto && document.visibilityState === 'visible' && !params.cursor) void load();
    }, 15000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [load, auto, params.cursor]);
  useEffect(() => {
    const g = ++detailGeneration.current;
    setTimeline([]);
    setTimelineError('');
    setDetailView('summary');
    if (!selected) return;
    const query: Record<string, string> = {
      from: String(data?.range.from ?? params.from),
      to: String(data?.range.to ?? params.to),
      instanceId: selected.instance_id,
    };
    if (selected.event.operationId) query.operationId = selected.event.operationId;
    else query.sessionId = selected.event.sessionId;
    void runtimeRequest<Dashboard>('runtime-dashboard', query)
      .then((result) => {
        if (g === detailGeneration.current) {
          setTimeline(result.entries);
          if (result.hasMore) setTimelineError('这里只展示前 100 条关联事件，请按会话或操作缩小范围后导出。');
        }
      })
      .catch((e) => {
        if (g === detailGeneration.current) setTimelineError(e.message);
      });
    return () => {
      detailGeneration.current++;
    };
  }, [selected, params.from, params.to]);
  useEffect(() => {
    if (!selected && !selectedDevice) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelected(null);
        setSelectedDevice(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [selected, selectedDevice]);
  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    const a = timestampFromField(from),
      b = timestampFromField(to);
    if (a == null || b == null || b < a || b + 59999 - a > 30 * 86400000) {
      setError('请选择有效时间范围，最长 30 天');
      return;
    }
    setSelected(null);
    setPage(0);
    setLive(false);
    setParams({ from: String(a), to: String(b + 59999), instanceId: device, level, category, q: keyword });
  }
  async function exportLogs() {
    setActionBusy(true);
    try {
      const filters: Record<string, string> = {
        ...params,
        from: String(data?.range.from ?? params.from),
        to: String(data?.range.to ?? params.to),
      };
      delete filters.cursor;
      const result = await runtimeRequest<{ entries: RuntimeRow[]; truncated: boolean; limit: number }>(
        'runtime-export',
        filters,
      );
      const blob = new Blob([JSON.stringify({ exportedAt: Date.now(), filters, ...result }, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `novora-runtime-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        result.truncated
          ? '已导出前 5000 条；范围超限，请缩小时间范围继续导出。'
          : `已导出 ${result.entries.length} 条日志。`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '导出失败');
    } finally {
      setActionBusy(false);
    }
  }
  const errors = data?.entries.filter((r) => r.event.level === 'error' || r.event.level === 'warn').slice(0, 5) || [];
  const deviceCounts = data?.devices.reduce(
    (counts, device) => {
      if (device.revoked) counts.revoked++;
      else if (Date.now() - Number(device.last_seen_at) < 120000) counts.online++;
      else counts.offline++;
      return counts;
    },
    { online: 0, offline: 0, revoked: 0 },
  ) ?? { online: 0, offline: 0, revoked: 0 };
  const filteredDevices = (data?.devices || [])
    .filter(
      (d) =>
        !deviceQuery.trim() ||
        `${d.instance_id} ${d.page} ${d.client_version}`.toLowerCase().includes(deviceQuery.trim().toLowerCase()),
    )
    .filter((d) => {
      if (deviceStatus === 'revoked') return d.revoked;
      if (deviceStatus === 'online') return !d.revoked && Date.now() - Number(d.last_seen_at) < 120000;
      if (deviceStatus === 'offline') return !d.revoked && Date.now() - Number(d.last_seen_at) >= 120000;
      return true;
    })
    .slice()
    .sort((a, b) => Number(b.last_seen_at) - Number(a.last_seen_at));
  const visibleDevices = filteredDevices.slice(devicePage * PAGE_SIZE, (devicePage + 1) * PAGE_SIZE);
  const trendSpan = data ? Math.max(1, data.range.to - data.range.from) : 0;
  const trendBucketHours = Math.max(1, Math.ceil(trendSpan / (24 * 60 * 60 * 1000)));
  const trendBucketMs = trendBucketHours * 60 * 60 * 1000;
  const trendBuckets = data
    ? Array.from({ length: Math.min(24, Math.ceil(trendSpan / trendBucketMs)) }, (_, index) => ({
        at: data.range.from + index * trendBucketMs,
        total: 0,
        errors: 0,
      })).map((bucket, index, buckets) => {
        for (const point of data.trend) {
          const pointIndex = Math.max(
            0,
            Math.min(buckets.length - 1, Math.floor((point.at - data.range.from) / trendBucketMs)),
          );
          if (pointIndex === index) {
            bucket.total += point.total;
            bucket.errors += point.errors;
          }
        }
        return { ...bucket, label: trendLabel(bucket.at, trendBucketHours, index, buckets.length) };
      })
    : [];
  const trendMax = Math.max(1, ...trendBuckets.map((bucket) => bucket.total));
  return (
    <>
      <section className="runtime-dashboard" aria-label="运行日志仪表盘">
        <header className="runtime-header">
          <div>
            <h2>
              <Activity size={22} />
              运行日志
            </h2>
            <p>教室设备与服务端事件 · 自动汇总</p>
          </div>
          <div className="runtime-actions">
            <span>
              <Switch
                checked={live}
                onChange={(value) => {
                  setLive(value);
                  setParams((p) => ({ ...p, cursor: '' }));
                }}
              />
              最近 24 小时
            </span>
            <span>
              <Switch checked={auto} onChange={setAuto} />
              自动刷新
            </span>
            <button className="set-btn" onClick={() => void load()} disabled={busy}>
              <RefreshCw size={16} />
              刷新
            </button>
            {canExport && (
              <button className="set-btn" disabled={actionBusy || !data || !!error} onClick={() => void exportLogs()}>
                <Download size={16} />
                导出日志
              </button>
            )}
          </div>
        </header>
        <p className="set-note">
          {data ? `最后采集：${time(data.fetchedAt)}${params.cursor ? ' · 翻页时自动刷新暂停' : ''}` : '尚未获取数据'} ·
          时间范围按服务端接收时间筛选。
        </p>
        {error && (
          <p className="set-note set-note--warn" role="alert">
            {error}
            {data ? '（下方保留上一次数据）' : ''}
          </p>
        )}
        {message && (
          <p className="set-note" role="status">
            {message}
          </p>
        )}
        <div className="runtime-cards">
          <button type="button" className="runtime-metric" onClick={() => setDashboardTab('events')}>
            <span>符合条件的事件</span>
            <strong>{data ? data.summary.total : '—'}</strong>
            <small>接收时间范围内</small>
          </button>
          <button
            type="button"
            className="runtime-metric is-alert"
            onClick={() => {
              setDashboardTab('events');
              setLevel('error');
              setParams((p) => ({ ...p, level: 'error', cursor: '' }));
              setPage(0);
            }}
          >
            <span>错误事件</span>
            <strong>{data ? data.summary.errors : '—'}</strong>
            <small>{data ? `另有 ${data.summary.warnings} 条警告 · 查看错误` : '查看错误事件'}</small>
          </button>
          <button
            type="button"
            className="runtime-metric is-online"
            onClick={() => {
              setDashboardTab('devices');
              setDeviceStatus('online');
              setDevicePage(0);
            }}
          >
            <span>在线设备</span>
            <strong>{data ? deviceCounts.online : '—'}</strong>
            <small>近 2 分钟有心跳</small>
          </button>
          <button
            type="button"
            className="runtime-metric is-offline"
            onClick={() => {
              setDashboardTab('devices');
              setDeviceStatus('offline');
              setDevicePage(0);
            }}
          >
            <span>离线设备</span>
            <strong>{data ? deviceCounts.offline : '—'}</strong>
            <small>检查设备状态</small>
          </button>
        </div>
        {canSystem && (
          <details className="runtime-system-status">
            <summary>
              <span>后台系统状态</span>
              <span className={systemError || (system && !system.database.reachable) ? 'is-warning' : 'is-ok'}>
                {systemError
                  ? '状态不可用'
                  : system?.database.reachable
                    ? '数据库正常'
                    : system
                      ? '数据库异常'
                      : '读取中'}
              </span>
            </summary>
            {system && !systemError && (
              <div className="runtime-system-grid">
                <div>
                  <span>服务部署</span>
                  <strong>{system.service.runtime === 'local' ? '本地部署' : 'Vercel'}</strong>
                </div>
                <div>
                  <span>数据库延迟</span>
                  <strong>{system.database.latencyMs ?? '—'} ms</strong>
                </div>
                <div>
                  <span>CPU / 核心</span>
                  <strong>
                    {system.server.cpu.usagePercent == null
                      ? '不可用'
                      : `${system.server.cpu.usagePercent.toFixed(1)}%`}{' '}
                    · {system.server.cpu.cores}
                  </strong>
                </div>
                <div>
                  <span>进程内存</span>
                  <strong>{(system.server.memory.rss / 1048576).toFixed(1)} MB</strong>
                </div>
                <div>
                  <span>数据库连接</span>
                  <strong>
                    {system.database.activeConnections ?? '—'} / {system.database.maxConnections ?? '—'}
                  </strong>
                </div>
                <div>
                  <span>邮件队列</span>
                  <strong>
                    {system.mailQueue.pending} 待发 · {system.mailQueue.failed} 失败
                  </strong>
                </div>
                {system.mailQueue.lastError && (
                  <p className="set-note set-note--warn">最近邮件错误：{system.mailQueue.lastError}</p>
                )}
              </div>
            )}
            {systemError && <p className="set-note set-note--warn">{systemError}</p>}
            {system && (
              <small className="runtime-system-footnote">
                运行版本 {system.service.version} · Node {system.server.node} · Vercel 指标仅代表当前实例
              </small>
            )}
          </details>
        )}
        <form className="runtime-filters" onSubmit={applyFilters}>
          <label>
            接收开始
            <DateTimeField
              mode="datetime"
              className="set-date-time-field"
              showFieldPreview={false}
              value={from}
              onChange={setFrom}
            />
          </label>
          <label>
            接收结束
            <DateTimeField
              mode="datetime"
              className="set-date-time-field"
              showFieldPreview={false}
              value={to}
              onChange={setTo}
            />
          </label>
          {dashboardTab === 'events' && (
            <>
              <label>
                设备标识
                <input
                  className="set-input"
                  value={device}
                  onChange={(e) => setDevice(e.target.value)}
                  placeholder="全部设备 / server"
                />
              </label>
              <label>
                级别
                <InlineSelect
                  className="set-input"
                  value={level}
                  onChange={setLevel}
                  options={[
                    { value: '', label: '全部级别' },
                    ...Object.entries(levels).map(([value, label]) => ({ value, label })),
                  ]}
                />
              </label>
              <label>
                类别
                <InlineSelect
                  className="set-input"
                  value={category}
                  onChange={setCategory}
                  options={[
                    { value: '', label: '全部类别' },
                    ...RUNTIME_CATEGORIES.map((value) => ({ value, label: labels[value] })),
                  ]}
                />
              </label>
              <label>
                关键词
                <input
                  className="set-input"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索日志说明"
                />
              </label>
            </>
          )}
          <button className="set-btn set-btn--primary" type="submit">
            查询
          </button>
        </form>
        <nav className="runtime-workspace-tabs" role="tablist" aria-label="运行数据类型">
          <button
            type="button"
            id="runtime-events-tab"
            role="tab"
            aria-controls="runtime-events-panel"
            aria-selected={dashboardTab === 'events'}
            className={dashboardTab === 'events' ? 'is-active' : ''}
            onClick={() => setDashboardTab('events')}
          >
            日志事件 <span>{data?.summary.total ?? '—'}</span>
          </button>
          <button
            type="button"
            id="runtime-devices-tab"
            role="tab"
            aria-controls="runtime-devices-panel"
            aria-selected={dashboardTab === 'devices'}
            className={dashboardTab === 'devices' ? 'is-active' : ''}
            onClick={() => setDashboardTab('devices')}
          >
            教室设备 <span>{data?.devices.length ?? '—'}</span>
          </button>
        </nav>
        {dashboardTab === 'events' && (
          <div id="runtime-events-panel" role="tabpanel" aria-labelledby="runtime-events-tab">
            <div className="runtime-overview">
              <section>
                <div className="runtime-trend-heading">
                  <h3>事件量分布</h3>
                  <span>每格 {trendBucketHours} 小时</span>
                </div>
                <div className="runtime-trend-chart" aria-label={`事件量分布，每格 ${trendBucketHours} 小时`}>
                  <div className="runtime-trend-axis" aria-hidden="true">
                    <span>{trendMax}</span>
                    <span>{Math.ceil(trendMax / 2)}</span>
                    <span>0</span>
                  </div>
                  <div className="runtime-trend-plot">
                    {trendBuckets.map((bucket, index) => {
                      const height = bucket.total ? Math.max(5, (bucket.total / trendMax) * 100) : 0;
                      const errorShare = bucket.total ? (bucket.errors / bucket.total) * 100 : 0;
                      return (
                        <div
                          className="runtime-trend-column"
                          key={bucket.at}
                          title={`${time(bucket.at)}：${bucket.total} 条事件，${bucket.errors} 条错误`}
                        >
                          <div className="runtime-trend-track">
                            <i
                              className="runtime-trend-bar"
                              style={{
                                height: `${height}%`,
                                background: `linear-gradient(to top, #e87979 ${errorShare}%, #55a9cb ${errorShare}%)`,
                                animationDelay: `${Math.min(index * 18, 360)}ms`,
                              }}
                            />
                          </div>
                          <small>{bucket.label}</small>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="runtime-trend-legend">
                  <span>
                    <i className="is-total" />
                    普通事件
                  </span>
                  <span>
                    <i className="is-error" />
                    错误
                  </span>
                  <span>{data?.summary.total ?? 0} 条</span>
                </div>
                {data && !data.summary.total && <p className="set-note">所选时间范围内暂无事件。</p>}
              </section>
              <section>
                <h3>近期异常</h3>
                {errors.map((row) => (
                  <button
                    className="runtime-issue"
                    key={row.id}
                    onClick={() => {
                      setDetailView('summary');
                      setSelected(row);
                    }}
                  >
                    <b>{row.event.code}</b>
                    <span>{row.event.message}</span>
                    <small>
                      {row.instance_id} · {time(row.received_at)}
                    </small>
                  </button>
                ))}
                {!errors.length && <p className="set-note">当前页没有警告或错误，可选择级别查询。</p>}
              </section>
            </div>
            <div className="runtime-list-heading">
              <div>
                <h3>日志事件</h3>
                <small>{data ? `${data.summary.total} 条符合筛选` : ''}</small>
              </div>
            </div>
            <EventList
              rows={(data?.entries || []).slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)}
              onSelect={(row) => {
                setDetailView('summary');
                setSelected(row);
              }}
            />
            <div className="runtime-actions runtime-pagination">
              <span>
                {data
                  ? data.entries.length
                    ? `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, data.entries.length)} / ${data.entries.length} 条（共 ${data.summary.total} 条）`
                    : '0 条'
                  : ''}
              </span>
              <button
                className="set-btn"
                disabled={(page === 0 && !params.cursor) || busy}
                onClick={() => {
                  if (page > 0) setPage((value) => value - 1);
                  else setParams((p) => ({ ...p, cursor: '' }));
                }}
              >
                {page === 0 && params.cursor ? '返回最新' : '上一页'}
              </button>
              <button
                className="set-btn"
                disabled={busy || (!!data && (page + 1) * PAGE_SIZE < data.entries.length ? false : !data?.hasMore)}
                onClick={() => {
                  if (data && (page + 1) * PAGE_SIZE < data.entries.length) setPage((value) => value + 1);
                  else {
                    setLive(false);
                    setPage(0);
                    setParams((p) => ({
                      ...p,
                      from: String(data?.range.from ?? p.from),
                      to: String(data?.range.to ?? p.to),
                      cursor: data?.nextCursor || '',
                    }));
                  }
                }}
              >
                下一页
              </button>
            </div>
          </div>
        )}
        {dashboardTab === 'devices' && (
          <section
            id="runtime-devices-panel"
            className="runtime-device-workspace"
            role="tabpanel"
            aria-labelledby="runtime-devices-tab"
          >
            <div className="runtime-device-toolbar">
              <label className="runtime-device-search">
                <Search size={16} aria-hidden="true" />
                <input
                  value={deviceQuery}
                  onChange={(event) => {
                    setDeviceQuery(event.target.value);
                    setDevicePage(0);
                  }}
                  placeholder="搜索设备、页面或版本"
                  aria-label="搜索教室设备"
                />
              </label>
              <div className="runtime-device-filters" role="group" aria-label="设备状态筛选">
                {(
                  [
                    ['all', '全部'],
                    ['online', '在线'],
                    ['offline', '离线'],
                    ['revoked', '已撤销'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={deviceStatus === value ? 'is-active' : ''}
                    aria-pressed={deviceStatus === value}
                    onClick={() => {
                      setDeviceStatus(value);
                      setDevicePage(0);
                    }}
                  >
                    {label}
                    <span>{value === 'all' ? (data?.devices.length ?? 0) : deviceCounts[value]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="runtime-list-heading">
              <div>
                <h3>教室设备</h3>
                <small>按最近心跳时间排序 · 当前已登记 {data?.devices.length ?? 0} 台</small>
              </div>
            </div>
            <div className="runtime-table-wrap">
              <table className="runtime-table runtime-device-table">
                <thead>
                  <tr>
                    <th>设备标识</th>
                    <th>页面 / 版本</th>
                    <th>最后心跳</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDevices.map((d) => (
                    <tr key={d.instance_id}>
                      <td data-label="设备标识">
                        <button type="button" className="runtime-event-link" onClick={() => setSelectedDevice(d)}>
                          {d.instance_id}
                        </button>
                      </td>
                      <td data-label="页面 / 版本">
                        {d.page}
                        <small>{d.client_version}</small>
                      </td>
                      <td data-label="最后心跳">{Number(d.last_seen_at) > 0 ? time(d.last_seen_at) : '无心跳'}</td>
                      <td data-label="状态">
                        <span
                          className={`runtime-device-status ${d.revoked ? 'is-revoked' : Date.now() - Number(d.last_seen_at) < 120000 ? 'is-online' : 'is-offline'}`}
                        >
                          {d.revoked ? '已撤销' : Date.now() - Number(d.last_seen_at) < 120000 ? '在线' : '离线'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!visibleDevices.length && (
                    <tr>
                      <td colSpan={4} className="runtime-empty">
                        {deviceQuery || deviceStatus !== 'all' ? '没有符合条件的设备。' : '暂无登记设备。'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="runtime-actions runtime-pagination">
              <span>
                {filteredDevices.length
                  ? `${devicePage * PAGE_SIZE + 1}-${Math.min((devicePage + 1) * PAGE_SIZE, filteredDevices.length)} / ${filteredDevices.length} 台设备`
                  : '0 台设备'}
              </span>
              <button
                className="set-btn runtime-page-button"
                aria-label="设备上一页"
                title="上一页"
                disabled={devicePage === 0}
                onClick={() => setDevicePage((page) => Math.max(0, page - 1))}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="runtime-page-index">
                {filteredDevices.length ? `${devicePage + 1} / ${Math.ceil(filteredDevices.length / PAGE_SIZE)}` : '—'}
              </span>
              <button
                className="set-btn runtime-page-button"
                aria-label="设备下一页"
                title="下一页"
                disabled={(devicePage + 1) * PAGE_SIZE >= filteredDevices.length}
                onClick={() => setDevicePage((page) => page + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </section>
        )}
        {dashboardTab === 'events' && data && (
          <p className="set-note">
            普通事件保留 7 天，警告与错误保留 30 天；每设备最多 10000 条。
            {data.storage.fileFallback
              ? `本地文件兜底：${data.storage.fileFailed ? '写入失败' : '可用'}，队列 ${data.storage.queued}，丢弃 ${data.storage.dropped}`
              : '当前部署不支持持久文件兜底'}
          </p>
        )}
      </section>
      {selected &&
        createPortal(
          <div
            className="runtime-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSelected(null);
            }}
          >
            <section className="runtime-modal" role="dialog" aria-modal="true" aria-labelledby="runtime-modal-title">
              <header className="runtime-modal__header">
                <div>
                  <h2 id="runtime-modal-title">事件详情</h2>
                  <p>
                    {selected.event.code} · {selected.instance_id} · {time(selected.received_at)}
                  </p>
                </div>
                <button
                  className="runtime-icon-button"
                  aria-label="关闭详情"
                  title="关闭详情"
                  onClick={() => setSelected(null)}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="runtime-modal__body">
                <nav className="runtime-detail-tabs" aria-label="事件详情分类">
                  {(
                    [
                      ['summary', '事件摘要'],
                      ['context', '运行上下文'],
                      ['timeline', `关联时间线${timeline.length ? ` ${timeline.length}` : ''}`],
                    ] as [DetailView, string][]
                  ).map(([view, label]) => (
                    <button
                      key={view}
                      type="button"
                      className={detailView === view ? 'is-active' : ''}
                      aria-current={detailView === view ? 'page' : undefined}
                      onClick={() => setDetailView(view)}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                {detailView === 'summary' && (
                  <div className="runtime-detail-summary">
                    <p className="runtime-detail-message">{selected.event.message}</p>
                    <dl>
                      <div>
                        <dt>级别</dt>
                        <dd>{levels[selected.event.level]}</dd>
                      </div>
                      <div>
                        <dt>类别</dt>
                        <dd>{labels[selected.event.category]}</dd>
                      </div>
                      <div>
                        <dt>设备时间</dt>
                        <dd>{time(selected.event.at)}</dd>
                      </div>
                      <div>
                        <dt>会话序号</dt>
                        <dd>#{selected.event.sequence}</dd>
                      </div>
                      <div>
                        <dt>客户端版本</dt>
                        <dd>{selected.event.version}</dd>
                      </div>
                      <div>
                        <dt>操作编号</dt>
                        <dd>{selected.event.operationId || '—'}</dd>
                      </div>
                    </dl>
                  </div>
                )}
                {detailView === 'context' && (
                  <dl className="runtime-context-list">
                    {Object.entries(selected.event.context)
                      .slice(0, 12)
                      .map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{String(value)}</dd>
                        </div>
                      ))}
                    {!Object.keys(selected.event.context).length && <p>该事件没有附加运行上下文。</p>}
                    {Object.keys(selected.event.context).length > 12 && <p>仅展示前 12 项上下文。</p>}
                  </dl>
                )}
                {detailView === 'timeline' && (
                  <>
                    {timelineError && <p className="set-note set-note--warn">{timelineError}</p>}
                    <EventList
                      rows={timeline.slice(0, 10)}
                      onSelect={(row) => {
                        setSelected(row);
                        setDetailView('summary');
                      }}
                    />
                    {timeline.length > 10 && <p className="set-note">显示前 10 条关联事件。</p>}
                  </>
                )}
              </div>
            </section>
          </div>,
          document.body,
        )}
      {selectedDevice &&
        createPortal(
          <div
            className="runtime-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSelectedDevice(null);
            }}
          >
            <section
              className="runtime-modal runtime-device-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="runtime-device-modal-title"
            >
              <header className="runtime-modal__header">
                <div>
                  <h2 id="runtime-device-modal-title">设备详情</h2>
                  <p>{selectedDevice.instance_id}</p>
                </div>
                <button
                  className="runtime-icon-button"
                  aria-label="关闭设备详情"
                  title="关闭详情"
                  onClick={() => setSelectedDevice(null)}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="runtime-modal__body">
                <dl className="runtime-context-list">
                  <div>
                    <dt>当前状态</dt>
                    <dd>
                      <span
                        className={`runtime-device-status ${selectedDevice.revoked ? 'is-revoked' : Date.now() - Number(selectedDevice.last_seen_at) < 120000 ? 'is-online' : 'is-offline'}`}
                      >
                        {selectedDevice.revoked
                          ? '已撤销'
                          : Date.now() - Number(selectedDevice.last_seen_at) < 120000
                            ? '在线'
                            : '离线'}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>当前页面</dt>
                    <dd>{selectedDevice.page || '未知'}</dd>
                  </div>
                  <div>
                    <dt>客户端版本</dt>
                    <dd>{selectedDevice.client_version || '未知'}</dd>
                  </div>
                  <div>
                    <dt>最后心跳</dt>
                    <dd>
                      {Number(selectedDevice.last_seen_at) > 0 ? time(selectedDevice.last_seen_at) : '未收到心跳'}
                    </dd>
                  </div>
                </dl>
              </div>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
