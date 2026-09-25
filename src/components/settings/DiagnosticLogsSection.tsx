import { useEffect, useMemo, useState } from 'react';
import { Clock, Send, ShieldCheck } from 'lucide-react';
import { DateTimeField } from '../touch-datetime-picker';
import InlineSelect from '../InlineSelect';
import { Switch } from './Switch';
import {
  allRetainedEntries,
  defaultDiagnosticRange,
  entriesInRange,
  localDiagnosticSnapshot,
  saveDiagnosticSettings,
  sendDiagnosticLogs,
  loadDiagnosticSettings,
  timestampFromField,
  type DiagnosticCaptureConfig,
} from '../../services/diagnosticLogs';

export default function DiagnosticLogsSection({
  canRead,
  canUpload,
  canEdit,
}: {
  canRead: boolean;
  canUpload: boolean;
  canEdit: boolean;
}) {
  const [config, setConfig] = useState<DiagnosticCaptureConfig>(() => localDiagnosticSnapshot().config);
  const [range, setRange] = useState(() => defaultDiagnosticRange());
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'error' | ''>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canRead) return;
    void loadDiagnosticSettings()
      .then(setConfig)
      .catch(() => undefined);
  }, [canRead]);
  // 本地日志在应用运行期间会持续写入，所以条数在每次渲染时现算，不做缓存。
  const rangeStart = timestampFromField(range.from);
  const rangeEnd = timestampFromField(range.to);
  const rangeEntries =
    rangeStart != null && rangeEnd != null && rangeEnd >= rangeStart ? entriesInRange(rangeStart, rangeEnd) : null;
  // 保留天数与后端 1-30 天限制一致；当前值不在预设里时补进去，避免选择器显示空白。
  const retentionOptions = useMemo(() => {
    const presets = [1, 3, 7, 14, 30];
    const days = presets.includes(config.retentionDays)
      ? presets
      : [...presets, config.retentionDays].sort((a, b) => a - b);
    return days.map((day) => ({ value: String(day), label: `${day} 天` }));
  }, [config.retentionDays]);

  async function save() {
    setBusy(true);
    setMessage('');
    try {
      setConfig(await saveDiagnosticSettings(config));
      setMessageTone('success');
      setMessage('诊断日志保留策略已保存');
    } catch (error) {
      setMessageTone('error');
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  function fail(text: string) {
    setMessageTone('error');
    setMessage(text);
  }
  function report(label: string, result: Awaited<ReturnType<typeof sendDiagnosticLogs>>) {
    const extra = [
      result.parts > 1 ? `共 ${result.parts} 个分片` : '',
      result.truncatedCount > 0 ? `超出分片上限，被截断 ${result.truncatedCount} 条` : '',
    ]
      .filter(Boolean)
      .join('，');
    setMessageTone(result.status === 'sent' ? 'success' : 'error');
    setMessage(
      `${label}已${result.status === 'sent' ? '发送' : '加入失败记录'}，诊断包 ID：${result.bundleId}${extra ? `（${extra}）` : ''}`,
    );
  }
  async function sendRange() {
    const start = timestampFromField(range.from);
    const end = timestampFromField(range.to);
    if (start == null || end == null) {
      fail('请先选择开始时间与结束时间');
      return;
    }
    if (end < start) {
      fail('结束时间必须晚于开始时间');
      return;
    }
    const entries = entriesInRange(start, end);
    if (!entries.length) {
      fail('所选时间段没有可发送的本地日志');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const result = await sendDiagnosticLogs({ mode: 'date', fromTs: start, toTs: end, entries });
      report('所选时间段的日志', result);
    } catch (error) {
      fail(error instanceof Error ? error.message : '发送失败');
    } finally {
      setBusy(false);
    }
  }
  async function sendErrorBundle() {
    // 出错时管理员不该先想区间：一次点击把本机当前保留的全部日志打成诊断包。
    const entries = allRetainedEntries();
    if (!entries.length) {
      fail('本机当前没有可发送的日志');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const result = await sendDiagnosticLogs({
        mode: 'error',
        fromTs: entries[0].at,
        toTs: Date.now(),
        entries,
      });
      report('全部日志诊断包', result);
    } catch (error) {
      fail(error instanceof Error ? error.message : '发送失败');
    } finally {
      setBusy(false);
    }
  }
  if (!canRead) return null;
  return (
    <section className="set-card">
      <div className="set-card__head">
        <h2 className="set-card__title">
          <ShieldCheck size={18} />
          诊断日志
        </h2>
      </div>
      <p className="set-card__lead">
        静默错误摘要仍会独立上报。这里的完整日志只在本机保留，只有在管理员主动发送时才会交给作者端。
      </p>
      <div className={`set-fieldset${canEdit ? '' : ' is-dim'}`}>
        <div className="set-row">
          <label className="set-label">错误发生时保留前后日志</label>
          <Switch
            checked={config.captureOnError}
            disabled={!canEdit}
            onChange={(value) => setConfig({ ...config, captureOnError: value })}
          />
        </div>
        <div className="set-row">
          <label className="set-label">错误前（秒）</label>
          <input
            className="set-input set-input--sm"
            type="number"
            min={0}
            max={300}
            inputMode="numeric"
            value={config.beforeSeconds}
            disabled={!canEdit}
            onChange={(event) => setConfig({ ...config, beforeSeconds: Number(event.target.value) })}
          />
        </div>
        <div className="set-row">
          <label className="set-label">错误后（秒）</label>
          <input
            className="set-input set-input--sm"
            type="number"
            min={0}
            max={300}
            inputMode="numeric"
            value={config.afterSeconds}
            disabled={!canEdit}
            onChange={(event) => setConfig({ ...config, afterSeconds: Number(event.target.value) })}
          />
        </div>
        <div className="set-row">
          <label className="set-label">日志保留天数</label>
          <InlineSelect
            className="set-input"
            disabled={!canEdit}
            value={String(config.retentionDays)}
            onChange={(value) => setConfig({ ...config, retentionDays: Number(value) })}
            options={retentionOptions}
          />
        </div>
      </div>
      {canEdit ? (
        <button className="set-btn set-btn--primary" disabled={busy} onClick={() => void save()}>
          保存保留策略
        </button>
      ) : null}
      {canUpload ? (
        <>
          <hr />
          <h3 className="set-card__subtitle">
            <Clock size={16} />
            按时间发送日志
          </h3>
          <div className="set-row">
            <label className="set-label">开始时间</label>
            <DateTimeField
              className="set-date-time-field"
              mode="datetime"
              value={range.from}
              onChange={(value) => setRange((current) => ({ ...current, from: value }))}
              title="选择开始时间"
              showFieldPreview={false}
            />
          </div>
          <div className="set-row">
            <label className="set-label">结束时间</label>
            <DateTimeField
              className="set-date-time-field"
              mode="datetime"
              value={range.to}
              onChange={(value) => setRange((current) => ({ ...current, to: value }))}
              title="选择结束时间"
              showFieldPreview={false}
            />
          </div>
          <p className="set-note">
            {rangeEntries
              ? `所选时间共 ${rangeEntries.length} 条本地日志，点下面的按钮才会发送；单次超过 5000 条或 8 MB 时会自动拆成多个分片。`
              : '请选择有效的开始与结束时间。'}
          </p>
          <div className="set-row">
            <label className="set-label">发送所选时间段的日志</label>
            <div className="set-inline-actions">
              <button className="set-btn" disabled={busy} onClick={() => void sendRange()}>
                <Send size={15} />
                发送所选时间日志
              </button>
            </div>
          </div>
          <h3 className="set-card__subtitle">
            <Send size={16} />
            错误日志
          </h3>
          <p className="set-note">出问题时点一下即可，会把本机当前保留的全部日志打成诊断包发给作者端。</p>
          <div className="set-row">
            <label className="set-label">发送全部日志诊断包</label>
            <div className="set-inline-actions">
              <button className="set-btn" disabled={busy} onClick={() => void sendErrorBundle()}>
                <Send size={15} />
                发送错误日志
              </button>
            </div>
          </div>
        </>
      ) : null}
      {message ? <p className={`set-note${messageTone ? ` set-note--${messageTone}` : ''}`}>{message}</p> : null}
    </section>
  );
}
