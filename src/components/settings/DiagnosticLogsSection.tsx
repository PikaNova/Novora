import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, Eye, Send, ShieldCheck, X } from 'lucide-react';
import { DateTimeField } from '../touch-datetime-picker';
import InlineSelect from '../InlineSelect';
import { Switch } from './Switch';
import {
  defaultDiagnosticRange,
  diagnosticEntriesInRange,
  localDiagnosticSnapshot,
  saveDiagnosticSettings,
  sendDiagnosticLogs,
  loadDiagnosticSettings,
  timestampFromField,
  type DiagnosticCaptureConfig,
} from '../../services/diagnosticLogs';
import type { DiagnosticLogEntry } from '../../shared/diagnosticLogContracts';
import '../../styles/diagnostic-logs.css';

type UploadPreview = { from: number; to: number; entries: DiagnosticLogEntry[] };

function displayTime(at: number) {
  return new Date(at).toLocaleString('zh-CN', { hour12: false });
}

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
  const [previewBusy, setPreviewBusy] = useState(false);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [previewClosing, setPreviewClosing] = useState(false);
  const previewCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!canRead) return;
    void loadDiagnosticSettings()
      .then(setConfig)
      .catch(() => undefined);
  }, [canRead]);
  // 保留天数与后端 1-30 天限制一致；当前值不在预设里时补进去，避免选择器显示空白。
  const retentionOptions = useMemo(() => {
    const presets = [1, 3, 7, 14, 30];
    const days = presets.includes(config.retentionDays)
      ? presets
      : [...presets, config.retentionDays].sort((a, b) => a - b);
    return days.map((day) => ({ value: String(day), label: `${day} 天` }));
  }, [config.retentionDays]);

  const closePreview = useCallback(() => {
    if (!preview || busy || previewClosing) return;
    setPreviewClosing(true);
    previewCloseTimer.current = setTimeout(() => {
      setPreview(null);
      setPreviewClosing(false);
      previewCloseTimer.current = null;
    }, 180);
  }, [preview, busy, previewClosing]);

  useEffect(() => {
    if (!preview) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) closePreview();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [preview, busy, closePreview]);

  useEffect(
    () => () => {
      if (previewCloseTimer.current) clearTimeout(previewCloseTimer.current);
    },
    [],
  );

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
  async function prepareUpload() {
    const start = timestampFromField(range.from);
    const endMinute = timestampFromField(range.to);
    const end = endMinute == null ? null : endMinute + 59999;
    if (start == null || end == null) {
      fail('请先选择开始时间与结束时间');
      return;
    }
    if (end < start) {
      fail('结束时间必须晚于开始时间');
      return;
    }
    if (end - start > 7 * 86400000) {
      fail('详细日志本机最多保留 7 天，请缩短时间范围');
      return;
    }
    setPreviewBusy(true);
    setMessage('');
    try {
      const entries = await diagnosticEntriesInRange(start, end);
      if (!entries.length) {
        fail('所选时间段没有可发送的详细日志');
        return;
      }
      setPreviewClosing(false);
      setPreview({ from: start, to: end, entries });
    } catch (error) {
      fail(error instanceof Error ? error.message : '读取本机详细日志失败');
    } finally {
      setPreviewBusy(false);
    }
  }
  async function confirmUpload() {
    if (!preview) return;
    const { entries, from, to } = preview;
    if (!entries.length) {
      fail('没有可发送的详细日志');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const result = await sendDiagnosticLogs({ mode: 'date', fromTs: from, toTs: to, entries });
      report('详细诊断日志', result);
      setPreview(null);
      setPreviewClosing(false);
    } catch (error) {
      fail(error instanceof Error ? error.message : '发送失败');
    } finally {
      setBusy(false);
    }
  }
  if (!canRead) return null;
  return (
    <>
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
              详细日志上报
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
            <div className="set-row">
              <label className="set-label">检查内容后再发送</label>
              <div className="set-inline-actions">
                <button
                  className="set-btn set-btn--primary"
                  disabled={busy || previewBusy}
                  onClick={() => void prepareUpload()}
                >
                  <Eye size={15} />
                  {previewBusy ? '正在整理日志…' : '预览并上报详细日志'}
                </button>
              </div>
            </div>
          </>
        ) : null}
        {message ? <p className={`set-note${messageTone ? ` set-note--${messageTone}` : ''}`}>{message}</p> : null}
      </section>
      {preview &&
        createPortal(
          <div
            className={`diagnostic-preview-backdrop${previewClosing ? ' is-closing' : ''}`}
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !busy) closePreview();
            }}
          >
            <section
              className="diagnostic-preview"
              role="dialog"
              aria-modal="true"
              aria-labelledby="diagnostic-preview-title"
            >
              <header className="diagnostic-preview__header">
                <div>
                  <h2 id="diagnostic-preview-title">上报诊断日志</h2>
                </div>
                <button
                  type="button"
                  className="diagnostic-preview__close"
                  aria-label="关闭预览"
                  title="关闭预览"
                  disabled={busy}
                  onClick={closePreview}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="diagnostic-preview__body">
                <p className="diagnostic-preview__range">
                  {displayTime(preview.from)} 至 {displayTime(preview.to)}
                </p>
                <p className="diagnostic-preview__count">将上报 {preview.entries.length} 条运行诊断日志</p>
                <p className="diagnostic-preview__privacy">
                  日志仅用于排查程序运行问题，发送前会自动过滤敏感信息。
                </p>
              </div>
              <footer className="diagnostic-preview__footer">
                <button type="button" className="set-btn" disabled={busy} onClick={closePreview}>
                  取消
                </button>
                <button
                  type="button"
                  className="set-btn set-btn--primary"
                  disabled={busy}
                  onClick={() => void confirmUpload()}
                >
                  <Send size={15} />
                  {busy ? '正在发送…' : '确认并上报'}
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
