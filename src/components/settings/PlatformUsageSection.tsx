import { useEffect, useState } from 'react';
import { ExternalLink, Gauge } from 'lucide-react';
import {
  clearPlatformConfig,
  fetchPlatformUsage,
  PlatformUsageError,
  refreshPlatformUsage,
  savePlatformConfig,
  type PlatformMetric,
  type PlatformProviderView,
  type PlatformStatus,
  type PlatformUsagePayload,
} from '../../services/platformUsage';
import RefreshButton from '../admin/RefreshButton';
import SettingsCollapsibleCard from './SettingsCollapsibleCard';

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  if (abs >= 0.01) return value.toFixed(2);
  if (abs >= 0.0001) return value.toFixed(4);
  // 日均小到这种程度时，定点小数会显示成 0，反而看不出差别。
  return value.toExponential(1);
}

function formatMetric(metric: PlatformMetric): string {
  const used = `${formatNumber(metric.used)} ${metric.unit}`;
  if (metric.limit == null) return used;
  return `${formatNumber(metric.used)} / ${formatNumber(metric.limit)} ${metric.unit}`;
}

function formatClock(epochMs: number | null): string {
  if (epochMs == null || !Number.isFinite(epochMs) || epochMs <= 0) return '尚未读取';
  const date = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function tone(value: number | null): 'ok' | 'warn' | 'err' | 'idle' {
  if (value == null || !Number.isFinite(value)) return 'idle';
  if (value >= 95) return 'err';
  if (value >= 80) return 'warn';
  return 'ok';
}

function formatRate(value: number | null, unit: string): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${formatNumber(value)}${unit ? ' ' + unit : ''}/天`;
}

/** 把服务端的预测翻译成一句人话。样本不足或没上限时也要说清楚为什么没有天数。 */
function forecastText(metric: PlatformMetric): string | null {
  const forecast = metric.forecast;
  if (!forecast) return null;
  if (forecast.status === 'exceeded') return '本周期已超限';
  if (forecast.status === 'no-usage') return '本周期尚未产生消耗';
  if (forecast.status === 'insufficient') {
    return metric.limit == null ? '未设上限，无法预测还能用几天' : `样本只有 ${forecast.sampleDays} 天，暂不外推`;
  }
  const rate = formatRate(forecast.dailyRate, metric.unit);
  const basis = forecast.basis === 'window' ? '（本周期样本不足，按整个窗口估算）' : '';
  const shake = forecast.volatile ? '，近期波动较大' : '';
  if (forecast.exhaustsWithinPeriod === true) {
    return `按 ${rate}${shake}${basis}，预计 ${forecast.daysLeft} 天后用尽（${forecast.projectedExhaustDate}）`;
  }
  if (forecast.exhaustsWithinPeriod === false) {
    return `按 ${rate}${shake}${basis}，本周期不会用尽`;
  }
  // 没有周期信息时才会走到这里；天数大到没有意义就别说具体数字。
  if (forecast.daysLeft != null && forecast.daysLeft > 365) {
    return `按 ${rate}${shake}${basis}，一年内不会用尽`;
  }
  return `按 ${rate}${shake}${basis}，约还能撑 ${forecast.daysLeft} 天`;
}

function statusTone(status: PlatformStatus): 'ok' | 'warn' | 'err' | 'idle' {
  if (status === 'ok') return 'ok';
  if (status === 'warning') return 'warn';
  if (status === 'critical' || status === 'credential_error') return 'err';
  return 'idle';
}

function statusLabel(status: PlatformStatus): string {
  switch (status) {
    case 'ok':
      return '正常';
    case 'warning':
      return '接近上限';
    case 'critical':
      return '已超限';
    case 'credential_error':
      return '凭据无效';
    case 'rate_limited':
      return '接口限流';
    case 'unsupported':
      return '接口不可用';
    case 'unconfigured':
      return '未配置';
    default:
      return '读取失败';
  }
}

function UsageBar({ value }: { value: number | null }) {
  const level = tone(value);
  const width = value == null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(100, value));
  return (
    <span className={'platform-usage__bar is-' + level}>
      <b style={{ width: width + '%' }} />
    </span>
  );
}

type ProviderCardProps = {
  view: PlatformProviderView;
  onPayload: (payload: PlatformUsagePayload) => void;
};

type CustomDraft = { key: string; label: string; used: string; unit: string; limit: string };

/** 给手工指标生成一个稳定 id：多次保存保持不变，历史采样才能连成一条线。 */
function newCustomKey(): string {
  return `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function ProviderCard({ view, onPayload }: ProviderCardProps) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(view.nextRefreshInSeconds);
  const cooling = cooldown > 0;
  const [limitDraft, setLimitDraft] = useState<Record<string, string>>({});
  const [customDraft, setCustomDraft] = useState<CustomDraft[]>([]);

  // 服务端返回的剩余秒数是权威值：每次拿到新载荷都同步一次。
  useEffect(() => {
    setCooldown(view.nextRefreshInSeconds);
  }, [view.nextRefreshInSeconds]);

  // 本地每秒递减，让「N 秒后可刷新」自己走动，而不是等下一次请求才知道。
  useEffect(() => {
    if (!cooling) return;
    const timer = window.setInterval(() => setCooldown((value) => (value <= 1 ? 0 : value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooling]);

  // 服务端返回的上限与手工指标是权威值；每次拿到新载荷就同步到草稿。
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(view.limits)) next[key] = String(value);
    setLimitDraft(next);
    setCustomDraft(
      view.custom.map((item) => ({
        key: item.key,
        label: item.label,
        used: String(item.used),
        unit: item.unit,
        limit: item.limit == null ? '' : String(item.limit),
      })),
    );
  }, [view.limits, view.custom]);

  const run = async (task: () => Promise<PlatformUsagePayload>, success: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      onPayload(await task());
      setDraft({});
      setMessage(success);
    } catch (cause) {
      // 刷新冷却时把剩余秒数接住，按钮直接进入倒计时，用户不用再试探。
      if (cause instanceof PlatformUsageError && cause.retryAfterSeconds) setCooldown(cause.retryAfterSeconds);
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const values: Record<string, string> = {};
    for (const field of view.fields) {
      const value = (draft[field.key] ?? '').trim();
      if (value) values[field.key] = value;
    }
    if (!Object.keys(values).length) {
      setError('请填写凭据后再保存。');
      return;
    }
    void run(() => savePlatformConfig(view.provider, values), '凭据已保存。');
  };

  const saveSettings = () => {
    const limits: Record<string, string> = {};
    for (const [key, value] of Object.entries(limitDraft)) {
      const trimmed = value.trim();
      if (trimmed) limits[key] = trimmed; // 留空即不提交，服务端回落到免费版默认值
    }
    const custom = customDraft
      .filter((item) => item.label.trim())
      .map((item) => ({
        key: item.key,
        label: item.label.trim(),
        used: item.used.trim() || '0',
        unit: item.unit.trim(),
        limit: item.limit.trim(),
      }));
    void run(() => savePlatformConfig(view.provider, {}, { limits, custom }), '上限与自定义指标已保存。');
  };

  const updateCustom = (index: number, field: keyof CustomDraft, value: string) => {
    setCustomDraft((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  const snapshot = view.snapshot;
  const level = snapshot ? statusTone(snapshot.status) : 'idle';

  return (
    <section className="platform-usage__card">
      <div className="platform-usage__head">
        <i className={'system-status__dot is-' + level} aria-hidden="true" />
        <strong>{view.provider === 'vercel' ? 'Vercel' : 'Neon'}</strong>
        <span className="platform-usage__status">
          {snapshot ? statusLabel(snapshot.status) : statusLabel('unconfigured')}
        </span>
        {view.configured && view.hint ? <code className="platform-usage__hint">{view.hint}</code> : null}
      </div>

      {!view.configured ? (
        <div className="platform-usage__wizard">
          <p className="set-note">
            首次设置：填写下面的凭据后即可读取额度。凭据只在服务端保存，保存后不会回显，也不写入环境变量。
          </p>
          {view.fields.map((field) => (
            <label className="set-row platform-usage__field" key={field.key}>
              <span className="set-label">{field.label}</span>
              <input
                className="set-input"
                type={field.secret ? 'password' : 'text'}
                autoComplete="off"
                placeholder={field.placeholder}
                value={draft[field.key] ?? ''}
                onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
              />
              <em className="platform-usage__hint-text">{field.hint}</em>
            </label>
          ))}
          <div className="set-inline-actions">
            <button className="set-btn set-btn--primary" type="button" disabled={busy} onClick={submit}>
              {busy ? '保存中…' : '保存并启用'}
            </button>
            <a className="set-btn set-btn--ghost" href={view.consoleUrl} target="_blank" rel="noopener noreferrer">
              打开控制台
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
        </div>
      ) : (
        <>
          {snapshot && snapshot.metrics.length ? (
            <ul className="platform-usage__metrics">
              {snapshot.metrics.map((metric) => {
                const forecast = forecastText(metric);
                return (
                  <li key={metric.key}>
                    <span>
                      {metric.label}
                      {metric.note ? <em className="platform-usage__note">{metric.note}</em> : null}
                    </span>
                    <b>
                      {formatMetric(metric)}
                      {metric.percent != null ? <em className="platform-usage__percent">{metric.percent}%</em> : null}
                    </b>
                    {/* 没有上限的指标只报用量：画一条空进度条会让人误以为「用量为 0」或「没超限」。 */}
                    {metric.percent != null ? <UsageBar value={metric.percent} /> : null}
                    {forecast ? <em className="platform-usage__forecast">{forecast}</em> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="set-note">尚未读取到用量，点击「立即刷新」尝试一次。</p>
          )}
          <p className="set-note platform-usage__meta">
            最近读取：{formatClock(snapshot?.observedAt ?? null)}
            {snapshot?.periodStart && snapshot?.periodEnd
              ? ` · 周期 ${snapshot.periodStart.slice(0, 10)} → ${snapshot.periodEnd.slice(0, 10)}`
              : ''}
            {snapshot?.stale ? ' · 本次未取到新数据，显示的是上一次成功读数' : ''}
          </p>
          {snapshot?.message ? <p className="set-note">{snapshot.message}</p> : null}
          {cooling ? <p className="set-note">为避免频繁调用外部接口，请等待 {cooldown} 秒后再刷新。</p> : null}
          <div className="set-inline-actions">
            <RefreshButton
              className="set-btn"
              busy={busy}
              disabled={cooling}
              label={cooling ? `${cooldown} 秒后可刷新` : '刷新'}
              onRefresh={() => void run(() => refreshPlatformUsage(view.provider), '已读取最新用量。')}
              title={cooling ? `冷却中：${cooldown} 秒后可再次读取` : '立即读取用量'}
            />
            <button
              className="set-btn set-btn--ghost"
              type="button"
              disabled={busy}
              onClick={() => void run(() => clearPlatformConfig(view.provider), '凭据已清除。')}
            >
              清除凭据
            </button>
            <a className="set-btn set-btn--ghost" href={view.consoleUrl} target="_blank" rel="noopener noreferrer">
              打开控制台
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
          <details className="platform-usage__settings">
            <summary>上限与自定义指标</summary>
            <div className="platform-usage__wizard">
              <p className="set-note">
                上限留空表示使用免费版默认值，填了就按你填的算百分比和预测。接口拿不到的指标（例如 Functions
                Storage）可以在下面手工添加，数值从 Vercel 用量页抄。
              </p>
              {(snapshot?.metrics ?? [])
                .filter((metric) => metric.note !== '手工录入')
                .map((metric) => (
                  <label className="set-row platform-usage__field" key={metric.key}>
                    <span className="set-label">
                      {metric.label}
                      {metric.limit != null ? `（当前按 ${formatNumber(metric.limit)} ${metric.unit}）` : ''}
                    </span>
                    <input
                      className="set-input"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      placeholder="留空用免费版默认值"
                      value={limitDraft[metric.key] ?? ''}
                      onChange={(event) => setLimitDraft((prev) => ({ ...prev, [metric.key]: event.target.value }))}
                    />
                  </label>
                ))}
              {customDraft.map((item, index) => (
                <div className="platform-usage__custom-row" key={index}>
                  <input
                    className="set-input"
                    placeholder="名称"
                    value={item.label}
                    onChange={(event) => updateCustom(index, 'label', event.target.value)}
                  />
                  <input
                    className="set-input"
                    type="number"
                    inputMode="decimal"
                    placeholder="已用"
                    value={item.used}
                    onChange={(event) => updateCustom(index, 'used', event.target.value)}
                  />
                  <input
                    className="set-input"
                    placeholder="单位"
                    value={item.unit}
                    onChange={(event) => updateCustom(index, 'unit', event.target.value)}
                  />
                  <input
                    className="set-input"
                    type="number"
                    inputMode="decimal"
                    placeholder="上限"
                    value={item.limit}
                    onChange={(event) => updateCustom(index, 'limit', event.target.value)}
                  />
                  <button
                    className="set-btn set-btn--ghost"
                    type="button"
                    onClick={() => setCustomDraft((prev) => prev.filter((_, i) => i !== index))}
                  >
                    删除
                  </button>
                </div>
              ))}
              <div className="set-inline-actions">
                <button
                  className="set-btn"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setCustomDraft((prev) => [
                      ...prev,
                      { key: newCustomKey(), label: '', used: '', unit: '', limit: '' },
                    ])
                  }
                >
                  添加自定义指标
                </button>
                <button className="set-btn set-btn--primary" type="button" disabled={busy} onClick={saveSettings}>
                  保存上限
                </button>
              </div>
            </div>
          </details>
          <details className="platform-usage__reconfigure">
            <summary>重新填写凭据</summary>
            <div className="platform-usage__wizard">
              {view.fields.map((field) => (
                <label className="set-row platform-usage__field" key={field.key}>
                  <span className="set-label">{field.label}</span>
                  <input
                    className="set-input"
                    type={field.secret ? 'password' : 'text'}
                    autoComplete="off"
                    placeholder={field.secret && view.hint ? `已保存 ${view.hint}，留空保持不变` : field.placeholder}
                    value={draft[field.key] ?? ''}
                    onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                  />
                </label>
              ))}
              <div className="set-inline-actions">
                <button className="set-btn" type="button" disabled={busy} onClick={submit}>
                  保存新凭据
                </button>
              </div>
            </div>
          </details>
        </>
      )}

      {message ? <p className="set-note">{message}</p> : null}
      {error ? <p className="set-note set-note--warn">{error}</p> : null}
    </section>
  );
}

function PlatformUsageBody({
  payload,
  error,
  loading,
  onPayload,
}: {
  payload: PlatformUsagePayload | null;
  error: string;
  loading: boolean;
  onPayload: (payload: PlatformUsagePayload) => void;
}) {
  if (loading && !payload) {
    return (
      <div className="platform-usage">
        <p className="set-card__lead">正在读取平台配置…</p>
      </div>
    );
  }
  if (!payload) {
    return (
      <div className="platform-usage">
        <p className="set-note set-note--warn">{error || '平台额度不可用'}</p>
      </div>
    );
  }

  return (
    <div className="platform-usage">
      <p className="set-card__lead">
        仅超管可见 · 面板只在 Vercel 运行时启用，凭据保存在服务端数据库，不写入环境变量。
      </p>
      <div className="platform-usage__grid">
        {payload.providers.map((view) => (
          <ProviderCard key={view.provider} view={view} onPayload={onPayload} />
        ))}
      </div>
      {error ? <p className="set-note set-note--warn">{error}</p> : null}
    </div>
  );
}

export default function PlatformUsageSection() {
  const [payload, setPayload] = useState<PlatformUsagePayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchPlatformUsage();
        if (!cancelled) setPayload(next);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '平台额度读取失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 本地 / 内网部署没有任何启用的平台，整块不显示。
  if (payload && payload.providers.length === 0) return null;

  // 首次进入时若还有平台没配好，自动展开一次，把设置向导直接摆在管理员面前。
  const needsSetup = Boolean(payload?.providers.some((view) => !view.configured));

  return (
    <SettingsCollapsibleCard
      storageKey="novora_set_collapse_platform_usage"
      title="平台额度"
      icon={<Gauge size={18} />}
      defaultOpen={needsSetup}
    >
      <PlatformUsageBody payload={payload} error={error} loading={loading} onPayload={setPayload} />
    </SettingsCollapsibleCard>
  );
}
