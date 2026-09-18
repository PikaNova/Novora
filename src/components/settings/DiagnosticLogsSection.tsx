import { useEffect, useMemo, useState } from 'react';
import { Download, Send, ShieldCheck } from 'lucide-react';
import InlineSelect from '../InlineSelect';
import { Switch } from './Switch';
import {
  entriesSinceLastUpload,
  getLastUploadAt,
  localDiagnosticSnapshot,
  saveDiagnosticSettings,
  sendDiagnosticLogs,
  loadDiagnosticSettings,
  type DiagnosticCaptureConfig,
  type LocalDiagnosticBundle,
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
  const [bundles, setBundles] = useState<LocalDiagnosticBundle[]>(() => localDiagnosticSnapshot().bundles);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(() => entriesSinceLastUpload('date').length);
  const [lastUploadAt, setLastUploadAt] = useState(() => getLastUploadAt('date'));

  useEffect(() => {
    if (!canRead) return;
    // Local bundles are captured while the app runs, so re-read them whenever the section mounts
    // instead of rendering the snapshot taken at first render.
    setBundles(localDiagnosticSnapshot().bundles);
    setPending(entriesSinceLastUpload('date').length);
    setLastUploadAt(getLastUploadAt('date'));
    void loadDiagnosticSettings()
      .then(setConfig)
      .catch(() => undefined);
  }, [canRead]);
  const lastUploadLabel = lastUploadAt > 0 ? new Date(lastUploadAt).toLocaleString() : '尚未上传过';
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
      setBundles(localDiagnosticSnapshot().bundles);
      setMessage('诊断日志保留策略已保存');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  async function sendDate() {
    setBusy(true);
    setMessage('');
    try {
      // 手动上传=全量：默认区间是「上次上传以来的全部日志」，没有日志就如实报错，
      // 不回退成当前快照，否则「全量」名不副实。
      const from = getLastUploadAt('date');
      const entries = entriesSinceLastUpload('date');
      if (!entries.length) throw new Error('自上次上传以来没有新的本地日志');
      const result = await sendDiagnosticLogs({
        mode: 'date',
        fromTs: from > 0 ? from + 1 : 0,
        toTs: Date.now(),
        entries,
      });
      setPending(entriesSinceLastUpload('date').length);
      setLastUploadAt(getLastUploadAt('date'));
      const extra = [
        result.parts > 1 ? `分 ${result.parts} 片` : '',
        result.truncatedCount > 0 ? `超出分片上限，被截断 ${result.truncatedCount} 条` : '',
      ]
        .filter(Boolean)
        .join('，');
      setMessage(
        `全量日志已${result.status === 'sent' ? '发送' : '加入失败记录'}：${result.bundleId}${extra ? `（${extra}）` : ''}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发送失败');
    } finally {
      setBusy(false);
    }
  }
  async function sendBundle(bundle: LocalDiagnosticBundle) {
    setBusy(true);
    setMessage('');
    try {
      const result = await sendDiagnosticLogs({ mode: 'error', ...bundle });
      setMessage(`错误日志已${result.status === 'sent' ? '发送' : '加入失败记录'}：${result.bundleId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发送失败');
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
        静默错误摘要仍会独立上报。这里的日志只在本机保留，需管理员主动选择后才发送给作者端。
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
            <Download size={16} />
            发送全部日志
          </h3>
          <p className="set-note">
            区间：上次上传（{lastUploadLabel}）至今，共 {pending} 条待发送。超过 5000 条或 8 MB 时自动分片上传。
          </p>
          <div className="set-row">
            <label className="set-label">发送上次上传以来的全部日志</label>
            <div className="set-inline-actions">
              <button className="set-btn" disabled={busy} onClick={() => void sendDate()}>
                <Send size={15} />
                发送全量日志
              </button>
            </div>
          </div>
          <h3 className="set-card__subtitle">按错误发送日志</h3>
          {bundles.length ? (
            bundles.map((bundle) => (
              <div className="set-row" key={bundle.bundleId}>
                <span className="set-label">
                  {bundle.errorCode || '错误日志'} · {new Date(bundle.createdAt).toLocaleString()} ·{' '}
                  {bundle.entries.length} 条
                </span>
                <div className="set-inline-actions">
                  <button className="set-btn" disabled={busy} onClick={() => void sendBundle(bundle)}>
                    <Send size={15} />
                    发送
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="set-note">当前没有自动保留的错误日志包。</p>
          )}
        </>
      ) : null}
      {message ? <p className="set-note">{message}</p> : null}
    </section>
  );
}
