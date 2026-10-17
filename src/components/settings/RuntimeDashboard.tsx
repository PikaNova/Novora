import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Download, RefreshCw } from 'lucide-react';
import InlineSelect from '../InlineSelect';
import { Switch } from './Switch';
import { DateTimeField } from '../touch-datetime-picker';
import { defaultDiagnosticRange, timestampFromField } from '../../services/diagnosticLogs';
import { fetchSystemStatus, type SystemStatusPayload } from '../../services/systemStatus';
import { runtimeRequest, type RuntimeDashboard as Dashboard, type RuntimeRow } from '../../services/runtimeDashboard';
import { RUNTIME_CATEGORIES } from '../../shared/runtimeLog';
import '../../styles/runtime-dashboard.css';

const time = (at: number) => new Date(Number(at)).toLocaleString('zh-CN', { hour12: false });
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
  const [actionBusy, setActionBusy] = useState(false);
  const [selected, setSelected] = useState<RuntimeRow | null>(null),
    [timeline, setTimeline] = useState<RuntimeRow[]>([]),
    [timelineError, setTimelineError] = useState('');
  const [auto, setAuto] = useState(true);
  const [live, setLive] = useState(true);
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
  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    const a = timestampFromField(from),
      b = timestampFromField(to);
    if (a == null || b == null || b < a || b + 59999 - a > 30 * 86400000) {
      setError('请选择有效时间范围，最长 30 天');
      return;
    }
    setSelected(null);
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
  const online = data?.devices.filter((d) => !d.revoked && Date.now() - Number(d.last_seen_at) < 120000).length;
  return (
    <section className="runtime-dashboard set-card" aria-label="运行与日志仪表盘">
      <header className="runtime-header">
        <div>
          <h2>
            <Activity size={22} />
            运行与日志
          </h2>
          <p>学校本地留存 · 服务端与教室设备统一时间线</p>
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
        日志筛选使用服务端接收时间；收集任务使用设备日志时间。
      </p>
      {error && (
        <p className="set-note set-note--warn" role="alert">
          {error}
          {data ? '（下方保留上一次数据）' : ''}
        </p>
      )}
      <div className="runtime-cards">
        <div>
          <span>数据库</span>
          <strong>
            {!canSystem
              ? '未授权'
              : systemError
                ? '不可用'
                : system?.database.reachable
                  ? `${system.database.latencyMs ?? '—'} ms`
                  : system
                    ? '不可达'
                    : '—'}
          </strong>
          <small>{system?.database.schemaOk ? '结构正常' : systemError || '等待状态'}</small>
        </div>
        <div>
          <span>服务运行</span>
          <strong>
            {!canSystem
              ? '未授权'
              : systemError
                ? '不可用'
                : system
                  ? system.service.runtime === 'local'
                    ? '本地部署'
                    : 'Vercel'
                  : '—'}
          </strong>
          <small>
            {system && !systemError
              ? `进程已运行 ${Math.floor(system.server.uptimeSeconds / 60)} 分钟`
              : '系统指标仅超管可读'}
          </small>
        </div>
        <div>
          <span>在线设备（近 2 分钟）</span>
          <strong>{data ? online : '—'}</strong>
          <small>设备列表最多 2000 台</small>
        </div>
        <button
          onClick={() => {
            setLevel('error');
            setParams((p) => ({ ...p, level: 'error', cursor: '' }));
          }}
        >
          <span>错误 / 警告</span>
          <strong>{data ? `${data.summary.errors} / ${data.summary.warnings}` : '—'}</strong>
          <small>当前筛选范围 · 点击筛选错误</small>
        </button>
        <div>
          <span>教室设备</span>
          <strong>{data ? data.devices.filter((d) => !d.revoked).length : '—'}</strong>
          <small>已登记设备</small>
        </div>
      </div>
      {system && !systemError && (
        <div className="runtime-overview">
          <section>
            <h3>服务资源（当前进程 / 整机）</h3>
            <p>
              CPU：
              {system.server.cpu.usagePercent == null
                ? '当前平台不提供'
                : system.server.cpu.usagePercent.toFixed(1) + '%'}{' '}
              · 核心 {system.server.cpu.cores}
            </p>
            <p>
              服务进程内存：{(system.server.memory.rss / 1048576).toFixed(1)} MB · 整机可用：
              {(system.server.memory.free / 1048576).toFixed(1)} MB
            </p>
            <p>
              运行版本：{system.service.version} · Node {system.server.node}
            </p>
          </section>
          <section>
            <h3>数据库与后台队列</h3>
            <p>
              数据库连接：{system.database.activeConnections ?? '—'} / {system.database.maxConnections ?? '—'}
            </p>
            <p>
              邮件待发：{system.mailQueue.pending} · 失败：{system.mailQueue.failed}
            </p>
            <p>{system.mailQueue.lastError || '未记录邮件发送异常'}</p>
            <p className="set-note">Vercel 资源指标仅代表当前实例，不代表所有实例。</p>
          </section>
        </div>
      )}
      {systemError && <p className="set-note set-note--warn">系统状态：{systemError}</p>}
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
        <button className="set-btn set-btn--primary" type="submit">
          查询
        </button>
      </form>
      <div className="runtime-overview">
        <section>
          <h3>日志事件趋势（小时）</h3>
          <div className="runtime-trend">
            {data?.trend.map((point) => (
              <div key={point.at} title={`${time(point.at)}：${point.total} 条，${point.errors} 错误`}>
                <i
                  style={{
                    height: `${Math.max(3, (point.total / Math.max(1, ...data.trend.map((p) => p.total))) * 100)}%`,
                  }}
                />
                <small>{new Date(point.at).getHours()}时</small>
              </div>
            ))}
          </div>
          {data && !data.trend.length && <p className="set-note">该范围暂无事件。</p>}
          <p className="set-note">事件数量，不代表接口请求量或 CPU 历史。</p>
        </section>
        <section>
          <h3>近期异常</h3>
          {errors.map((row) => (
            <button className="runtime-issue" key={row.id} onClick={() => setSelected(row)}>
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
      <h3>
        日志中心 <small>{data ? `${data.summary.total} 条符合筛选` : ''}</small>
      </h3>
      <EventList rows={data?.entries || []} onSelect={setSelected} />
      <div className="runtime-actions">
        <button
          className="set-btn"
          disabled={!params.cursor || busy}
          onClick={() => setParams((p) => ({ ...p, cursor: '' }))}
        >
          返回最新
        </button>
        <button
          className="set-btn"
          disabled={!data?.hasMore || busy}
          onClick={() => {
            setLive(false);
            setParams((p) => ({
              ...p,
              from: String(data?.range.from ?? p.from),
              to: String(data?.range.to ?? p.to),
              cursor: data?.nextCursor || '',
            }));
          }}
        >
          下一页
        </button>
      </div>
      {selected && (
        <section className="runtime-detail">
          <header>
            <h3>事件详情与关联时间线</h3>
            <button className="set-btn" onClick={() => setSelected(null)}>
              关闭详情
            </button>
          </header>
          <p>
            {selected.event.code} · 会话 {selected.event.sessionId} · 操作 {selected.event.operationId || '—'}
          </p>
          <pre>{JSON.stringify(selected.event, null, 2)}</pre>
          {timelineError && <p className="set-note set-note--warn">{timelineError}</p>}
          <EventList
            rows={timeline
              .slice()
              .sort(
                (a, b) => a.event.sessionId.localeCompare(b.event.sessionId) || a.event.sequence - b.event.sequence,
              )}
            onSelect={setSelected}
          />
        </section>
      )}
      <h3>教室设备</h3>
      <div className="runtime-table-wrap">
        <table className="runtime-table">
          <thead>
            <tr>
              <th>设备</th>
              <th>页面 / 版本</th>
              <th>最后心跳</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {data?.devices.map((d) => (
              <tr key={d.instance_id}>
                <td>{d.instance_id}</td>
                <td>
                  {d.page}
                  <small>{d.client_version}</small>
                </td>
                <td>{Number(d.last_seen_at) > 0 ? time(d.last_seen_at) : '无心跳'}</td>
                <td>{d.revoked ? '已撤销' : Date.now() - Number(d.last_seen_at) < 120000 ? '在线' : '离线'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && (
        <p className="set-note">
          普通事件保留 7 天，警告与错误保留 30 天；每设备最多 10000 条。
          {data.storage.fileFallback
            ? `本地文件兜底：${data.storage.fileFailed ? '写入失败' : '可用'}，队列 ${data.storage.queued}，丢弃 ${data.storage.dropped}`
            : '当前部署不支持持久文件兜底'}
        </p>
      )}
    </section>
  );
}
