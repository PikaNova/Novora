import React, { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { fetchSystemStatus, type SystemStatusPayload } from '../../services/systemStatus';
import { APP_VERSION } from '../../services/telemetry';
import SettingsCollapsibleCard from './SettingsCollapsibleCard';
import RefreshButton from '../admin/RefreshButton';

function formatUptime(seconds: number): string {
  const s = Math.max(0, seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return d + ' 天 ' + h + ' 小时';
  if (h > 0) return h + ' 小时 ' + m + ' 分';
  return m + ' 分钟';
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb.toFixed(1) + ' MB';
}

function formatPercent(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(1) + '%';
}

function formatClock(epochMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return '—';
  const date = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    ' ' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes()) +
    ':' +
    pad(date.getSeconds())
  );
}

function latencyTone(ms: number | null): string {
  if (ms == null) return 'is-err';
  if (ms <= 300) return 'is-ok';
  if (ms <= 1000) return 'is-warn';
  return 'is-err';
}

function usageTone(value: number | null, warn = 80, err = 92): 'ok' | 'warn' | 'err' | 'idle' {
  if (value == null || !Number.isFinite(value)) return 'idle';
  if (value >= err) return 'err';
  if (value >= warn) return 'warn';
  return 'ok';
}

function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'err' | 'idle' }) {
  return <i className={'system-status__dot is-' + tone} aria-hidden="true" />;
}

function UsageBar({ value }: { value: number | null }) {
  const tone = usageTone(value);
  const width = value == null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(100, value));
  return (
    <span className={'system-status__usage is-' + tone}>
      <b style={{ width: width + '%' }} />
    </span>
  );
}

function SystemStatusBody() {
  const [data, setData] = useState<SystemStatusPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const next = await fetchSystemStatus();
      setData(next);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '系统状态读取失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  if (loading && !data) {
    return (
      <div className="system-status">
        <p className="set-card__lead">正在读取系统状态…</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="system-status">
        <p className="set-note set-note--warn">{error || '系统状态不可用'}</p>
      </div>
    );
  }

  const queueWarn = data.mailQueue.failed > 0 || data.mailQueue.pending > 20;
  const dbTone: 'ok' | 'err' | 'warn' = !data.database.reachable ? 'err' : !data.database.schemaOk ? 'warn' : 'ok';
  const events = data.events.slice(0, 5);
  const memUsage = data.server.memory.total > 0 ? (1 - data.server.memory.free / data.server.memory.total) * 100 : null;
  const loadText =
    data.server.cpu.load1.toFixed(2) +
    ' / ' +
    data.server.cpu.load5.toFixed(2) +
    ' / ' +
    data.server.cpu.load15.toFixed(2);

  return (
    <div className="system-status">
      <div className="set-card__head">
        <p className="set-card__lead">仅超管可见 · 每 10 秒自动刷新，折叠时暂停。</p>
        <RefreshButton className="set-btn" busy={loading} onRefresh={() => void load()} title="刷新系统状态" />
      </div>

      <div className="system-status__summary">
        <div className="system-status__summary-item">
          <StatusDot tone={dbTone} />
          <span>数据库</span>
          <b>
            {data.database.reachable
              ? data.database.latencyMs != null
                ? data.database.latencyMs + ' ms'
                : '正常'
              : '不可达'}
          </b>
        </div>
        <div className="system-status__summary-item">
          <StatusDot tone={queueWarn ? 'warn' : 'ok'} />
          <span>邮件队列</span>
          <b>待发 {data.mailQueue.pending}</b>
        </div>
        <div className="system-status__summary-item">
          <StatusDot tone="ok" />
          <span>服务器</span>
          <b>{data.service.runtime === 'vercel' ? 'Vercel' : '本地部署'}</b>
        </div>
        <div className="system-status__summary-item">
          <StatusDot tone={usageTone(memUsage)} />
          <span>内存</span>
          <b>{formatPercent(memUsage)}</b>
        </div>
      </div>

      <div className="system-status__grid">
        <section className="system-status__section">
          <h3>服务</h3>
          <ul className="set-status__list">
            <li>
              <span>应用版本</span>
              <b>v{data.service.version === 'unknown' ? APP_VERSION : data.service.version}</b>
            </li>
            <li>
              <span>平台 / 架构</span>
              <b>
                {data.server.platform} / {data.server.arch}
              </b>
            </li>
            <li>
              <span>运行时长</span>
              <b>{formatUptime(data.server.uptimeSeconds)}</b>
            </li>
            <li>
              <span>CPU 使用率</span>
              <b>{formatPercent(data.server.cpu.usagePercent)}</b>
            </li>
            <li>
              <span>负载（1/5/15 分钟）</span>
              <b>{loadText}</b>
            </li>
            <li>
              <span>内存使用率</span>
              <b>{formatPercent(memUsage)}</b>
            </li>
            <li>
              <span>内存（已用 / 总量）</span>
              <b>
                {formatBytes(data.server.memory.total > 0 ? data.server.memory.total - data.server.memory.free : 0)} /{' '}
                {formatBytes(data.server.memory.total)}
              </b>
            </li>
            <li>
              <span>内存占用</span>
              <b className="system-status__usage-cell">
                <UsageBar value={memUsage} />
              </b>
            </li>
          </ul>
        </section>

        <section className="system-status__section">
          <h3>数据库</h3>
          <ul className="set-status__list">
            <li>
              <span>连通性</span>
              <b>{data.database.reachable ? '正常' : '异常'}</b>
            </li>
            <li>
              <span>Schema 版本</span>
              <b>
                {data.database.schemaVersion != null
                  ? `v${data.database.schemaVersion}（auth ${data.database.schemaVersions?.auth ?? '—'} / exams ${
                      data.database.schemaVersions?.exams ?? '—'
                    }）`
                  : '—'}
              </b>
            </li>
            <li>
              <span>往返延迟</span>
              <b className={'system-status__latency ' + latencyTone(data.database.latencyMs)}>
                {data.database.latencyMs != null ? data.database.latencyMs + ' ms' : '—'}
              </b>
            </li>
            <li>
              <span>数据库大小</span>
              <b>{formatBytes(data.database.sizeBytes ?? -1)}</b>
            </li>
            <li>
              <span>连接（活跃 / 上限）</span>
              <b>
                {data.database.activeConnections != null
                  ? data.database.activeConnections + ' / ' + (data.database.maxConnections ?? '—')
                  : '—'}
              </b>
            </li>
          </ul>
        </section>

        <section className="system-status__section">
          <h3>邮件队列</h3>
          <ul className="set-status__list">
            <li>
              <span>待发</span>
              <b>{data.mailQueue.pending}</b>
            </li>
            <li>
              <span>失败</span>
              <b className={data.mailQueue.failed > 0 ? 'is-err-text' : ''}>{data.mailQueue.failed}</b>
            </li>
          </ul>
        </section>

        <section className="system-status__section system-status__section--wide">
          <h3>最近系统事件</h3>
          {events.length ? (
            <ul className="system-status__events">
              {events.map((event, index) => (
                <li key={index}>
                  <span className="system-status__event-time">{formatClock(event.createdAt)}</span>
                  <code>{event.action}</code>
                  <span className="system-status__event-user">{event.username || '系统'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="set-note">暂无系统事件</p>
          )}
        </section>
      </div>

      {error && <p className="set-note set-note--warn">{error}</p>}
    </div>
  );
}

export default function SystemStatusSection() {
  return (
    <SettingsCollapsibleCard
      storageKey="novora_set_collapse_system_status"
      title="系统状态"
      icon={<Activity size={18} />}
    >
      <SystemStatusBody />
    </SettingsCollapsibleCard>
  );
}
