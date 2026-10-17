import { Clock3, AlertTriangle, Radio, RefreshCw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import HelpTip from '../HelpTip';
import InlineSelect from '../InlineSelect';
import { Switch } from './Switch';
import type { TimeSyncSettings } from '../../utils/appSettings';
import { useTimeSyncSettings } from '../../hooks/settings/useTimeSyncSettings';

export default function TimeSyncSection({ canEditSettings }: { canEditSettings: boolean }) {
  const {
    ts,
    syncing,
    ready,
    lastSyncLabel,
    patchTs,
    syncNow,
    globalControl,
    globalBusy,
    globalError,
    syncAllClients,
    saveBroadcastOffset,
  } = useTimeSyncSettings();
  const [offsetDraft, setOffsetDraft] = useState('0');
  const globalOffsetMs = globalControl?.offsetMs;
  useEffect(() => {
    if (globalOffsetMs != null) setOffsetDraft(String(globalOffsetMs / 1000));
  }, [globalOffsetMs]);

  return (
    <section className="set-card">
      <div className="set-card__head">
        <h2 className="set-card__title">
          <Clock3 size={20} />
          <span className="with-help-tip">
            时间同步（校时）
            <HelpTip title="校时方式">
              时间接口精度最高且适合大屏；HTTP Date 无需专用接口但精度较低；浏览器不能直接使用 NTP。
            </HelpTip>
          </span>
        </h2>
        <Switch checked={ts.enabled} disabled={!canEditSettings} onChange={(v) => patchTs({ enabled: v }, true)} />
      </div>
      <p className="set-card__lead">
        开启后大屏时钟、倒计时与全屏提醒均基于校准后的网络时间触发；关闭后回退使用本机时钟。
      </p>

      <div className={`set-fieldset${ts.enabled ? '' : ' is-dim'}`}>
        <div className="set-row">
          <label className="set-label">校时方式</label>
          <InlineSelect
            className="set-input"
            disabled={!canEditSettings}
            value={ts.provider}
            onChange={(value) => patchTs({ provider: value as TimeSyncSettings['provider'] }, true)}
            options={[
              { value: 'timeApi', label: '时间接口 (timeApi · 推荐)' },
              { value: 'httpDate', label: 'HTTP 响应头 (Date)' },
              { value: 'ntp', label: 'NTP（仅服务端）' },
            ]}
          />
        </div>

        {ts.provider === 'timeApi' && (
          <div className="set-row">
            <label className="set-label">时间接口 URL</label>
            <input
              className="set-input"
              disabled={!canEditSettings}
              value={ts.timeApiUrl}
              placeholder="/api/time"
              onChange={(e) => patchTs({ timeApiUrl: e.target.value })}
            />
          </div>
        )}
        {ts.provider === 'httpDate' && (
          <div className="set-row">
            <label className="set-label">探测 URL</label>
            <input
              className="set-input"
              disabled={!canEditSettings}
              value={ts.httpDateUrl}
              placeholder="/"
              onChange={(e) => patchTs({ httpDateUrl: e.target.value })}
            />
          </div>
        )}
        {ts.provider === 'ntp' && (
          <div className="set-note set-note--warn">
            <AlertTriangle size={15} /> 浏览器环境无法直连 NTP，请改用“时间接口”或“HTTP 响应头”方式；NTP
            仅供服务端代理使用。
          </div>
        )}

        <div className="set-row">
          <label className="set-label">自动定时校时</label>
          <Switch
            checked={ts.autoSyncEnabled}
            disabled={!canEditSettings}
            onChange={(v) => patchTs({ autoSyncEnabled: v }, true)}
          />
        </div>
        <div className="set-row">
          <label className="set-label">校时间隔（秒）</label>
          <input
            className="set-input set-input--sm"
            type="number"
            min={10}
            step={10}
            inputMode="numeric"
            disabled={!canEditSettings}
            value={ts.autoSyncIntervalSec}
            onChange={(e) =>
              patchTs(
                {
                  autoSyncIntervalSec: Math.max(10, Number(e.target.value) || 10),
                },
                true,
              )
            }
          />
        </div>
        <div className="set-row">
          <label className="set-label">手动微调（毫秒）</label>
          <input
            className="set-input set-input--sm"
            type="number"
            step={100}
            disabled={!canEditSettings}
            value={ts.manualOffsetMs}
            onChange={(e) => patchTs({ manualOffsetMs: Number(e.target.value) || 0 })}
          />
        </div>
      </div>

      <div className="set-status">
        <div className="set-status__row">
          <span className={`set-dot ${ready ? 'ok' : 'wait'}`} />
          <span>{ready ? '已校时' : '尚未就绪'}</span>
        </div>
        <ul className="set-status__list">
          <li>
            <span>上次校时</span>
            <b>{lastSyncLabel}</b>
          </li>
          <li>
            <span>当前网络偏移</span>
            <b>{ts.offsetMs} ms</b>
          </li>
          <li>
            <span>往返延迟</span>
            <b>{ts.lastRttMs != null ? `${ts.lastRttMs} ms` : '—'}</b>
          </li>
          {ts.lastError ? (
            <li className="is-err">
              <span>上次错误</span>
              <b>{ts.lastError}</b>
            </li>
          ) : null}
        </ul>
        <button className="set-btn set-btn--primary" disabled={!ts.enabled || syncing} onClick={syncNow}>
          {syncing ? '正在校时…' : '立即校时'}
        </button>
        <div className="set-fieldset">
          <div className="set-row">
            <label className="set-label" htmlFor="global-time-offset">
              全校统一偏移（秒）
            </label>
            <input
              id="global-time-offset"
              className="set-input set-input--sm"
              type="number"
              min={-300}
              max={300}
              step={0.1}
              inputMode="decimal"
              disabled={!canEditSettings || globalBusy}
              value={offsetDraft}
              onChange={(event) => setOffsetDraft(event.target.value)}
            />
          </div>
          <p className="set-card__lead">正值让客户端时钟、倒计时和提醒提前，负值让它们延后；服务端考试计划不变。</p>
          <button
            className="set-btn"
            disabled={
              !canEditSettings ||
              globalBusy ||
              !Number.isFinite(Number(offsetDraft)) ||
              Math.abs(Number(offsetDraft)) > 300
            }
            onClick={() => void saveBroadcastOffset(Number(offsetDraft))}
          >
            <Save size={15} /> 保存全校偏移
          </button>
        </div>
        <div className="set-fieldset">
          {ts.enabled ? null : <p className="set-card__lead">先开启本机统一校时，再下发全局校时。</p>}
          <button
            className="set-btn set-btn--primary"
            disabled={!canEditSettings || !ts.enabled || globalBusy}
            onClick={() => void syncAllClients()}
          >
            {globalBusy ? <RefreshCw size={15} className="is-spinning" /> : <Radio size={15} />}
            {globalBusy ? '正在下发…' : '校时所有客户端'}
          </button>
          {globalControl?.sync ? (
            <p className="set-card__lead">
              校时结果：{globalControl.sync.synced} 台成功，{globalControl.sync.failed} 台失败，
              {globalControl.sync.pending} 台待响应（当前在线 {globalControl.sync.online} / {globalControl.sync.total}）
            </p>
          ) : null}
          {globalError ? <p className="set-note set-note--warn">{globalError}</p> : null}
        </div>
      </div>
    </section>
  );
}
