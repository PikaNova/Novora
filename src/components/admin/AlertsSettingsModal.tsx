// 提醒设置弹窗（内置状态提醒 + 自定义提醒）。状态与写入逻辑由 AdminPage/useAlertsSettings 持有。
import type { HTMLAttributes } from 'react';
import { Bell } from 'lucide-react';
import Mascot from '../Mascot';
import AdminModalPortal from '../AdminModalPortal';
import InlineSelect from '../InlineSelect';
import type { AlertsSettings, AlertState, CustomReminder } from '../../types';

export type BackdropProps2 = (
  onDismiss: () => void,
) => Pick<HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onClick'>;

// 内置提醒状态的展示顺序与触发时机说明
const ALERT_STATE_ORDER: AlertState[] = ['15min', '5min', 'start', 'end15', 'ended', 'next'];
const ALERT_STATE_META: Record<AlertState, { name: string; timing: string }> = {
  '15min': { name: '开考前 15 分钟', timing: '自动于开考前 15 分钟触发' },
  '5min': { name: '开考前 5 分钟', timing: '自动于开考前 5 分钟触发' },
  start: { name: '开考时刻', timing: '自动于开考时刻触发' },
  end15: { name: '结束前 15 分钟', timing: '自动于结束前 15 分钟触发' },
  ended: { name: '本场结束', timing: '自动于本场结束时触发' },
  next: { name: '下一科提示', timing: '本场结束且存在下一场时触发' },
};
const TONE_OPTIONS: Array<{ value: AlertState; label: string }> = [
  { value: '15min', label: '黄橙·准备' },
  { value: '5min', label: '红色·紧急' },
  { value: 'start', label: '绿蓝·开始' },
  { value: 'end15', label: '黄橙·注意' },
  { value: 'ended', label: '冷调·结束' },
  { value: 'next', label: '紫蓝·下一科' },
];
const ANCHOR_OPTIONS: Array<{ value: CustomReminder['anchor']; label: string }> = [
  { value: 'beforeStart', label: '开考前' },
  { value: 'afterStart', label: '开考后' },
  { value: 'beforeEnd', label: '结束前' },
];

export type AlertsSettingsModalProps = {
  alerts: AlertsSettings;
  setAlertsOpen: (open: boolean) => void;
  alertsSection: 'builtin' | 'custom';
  setAlertsSection: (section: 'builtin' | 'custom') => void;
  setAlertsEnabled: (enabled: boolean) => void;
  setAlertsDuration: (durationSec: number) => void;
  updateStateCfg: (state: AlertState, patch: Partial<AlertsSettings['states'][AlertState]>) => void;
  addCustomReminder: () => void;
  updateCustomReminder: (id: string, patch: Partial<CustomReminder>) => void;
  removeCustomReminder: (id: string) => void;
  resetAlerts: () => void;
  can: (permission: string) => boolean;
  backdropProps: BackdropProps2;
};

export function AlertsSettingsModal({
  alerts,
  setAlertsOpen,
  alertsSection,
  setAlertsSection,
  setAlertsEnabled,
  setAlertsDuration,
  updateStateCfg,
  addCustomReminder,
  updateCustomReminder,
  removeCustomReminder,
  resetAlerts,
  can,
  backdropProps,
}: AlertsSettingsModalProps) {
  return (
    <AdminModalPortal className="admin-modal-overlay" {...backdropProps(() => setAlertsOpen(false))}>
      <div className="admin-modal admin-modal--wide admin-alerts" onClick={(e) => e.stopPropagation()}>
        <div className="admin-alerts__head">
          <h2 className="admin-modal__title" style={{ margin: 0 }}>
            <Bell size={19} />
            统一提醒管理
          </h2>
          <button className="admin-btn admin-btn--ghost" onClick={() => setAlertsOpen(false)}>
            关闭
          </button>
        </div>
        {!can('alerts.edit') && <div className="admin-info-banner">当前账号只有查看权限，提醒设置不可修改。</div>}
        <p className="admin-alerts__lead">
          开考各阶段自动弹出<strong>全屏提醒浮层</strong>；浮层风格
          <strong>自动跟随大屏当前设计</strong>（共 5 套：深色指挥舱 / 清爽聚焦 / 校园黑板 / 高对比应急 /
          编辑排版），无需单独配置。文案支持占位符 <code>{'{subject}'}</code>、<code>{'{start}'}</code>、
          <code>{'{end}'}</code>、<code>{'{next}'}</code>、<code>{'{nextTime}'}</code>。
        </p>
        <fieldset className="admin-permission-modal" disabled={!can('alerts.edit')}>
          <div className="admin-alerts__bar">
            <label className="admin-toggle-label">
              <input type="checkbox" checked={alerts.enabled} onChange={(e) => setAlertsEnabled(e.target.checked)} />
              启用全屏提醒浮层
            </label>
            <label className="admin-alerts__dur">
              默认停留时长
              <input
                className="admin-input"
                type="number"
                min={4}
                max={15}
                value={alerts.durationSec}
                onChange={(e) => setAlertsDuration(Math.min(15, Math.max(4, Number(e.target.value) || 8)))}
              />
              <span>秒</span>
            </label>
            <button className="admin-btn admin-btn--ghost" onClick={resetAlerts}>
              恢复默认文案
            </button>
          </div>
          <div className="admin-alerts__tabs">
            <button
              type="button"
              className={alertsSection === 'builtin' ? 'is-active' : ''}
              onClick={() => setAlertsSection('builtin')}
            >
              内置阶段提醒
            </button>
            <button
              type="button"
              className={alertsSection === 'custom' ? 'is-active' : ''}
              onClick={() => setAlertsSection('custom')}
            >
              自定义提醒（{alerts.custom.length}）
            </button>
          </div>

          {alertsSection === 'builtin' && (
            <div className={`admin-alerts__section${alerts.enabled ? '' : ' is-dim'}`}>
              <h3 className="admin-alerts__subtitle">内置阶段提醒（6 项）</h3>
              <div className="admin-alerts__grid">
                {ALERT_STATE_ORDER.map((st) => {
                  const cfg = alerts.states[st];
                  const meta = ALERT_STATE_META[st];
                  return (
                    <div className={`admin-alert-card${cfg.enabled ? '' : ' is-off'}`} key={st}>
                      <div className="admin-alert-card__head">
                        <div>
                          <span className="admin-alert-card__name">{meta.name}</span>
                          <span className="admin-alert-card__timing">{meta.timing}</span>
                        </div>
                        <label className="admin-switch">
                          <input
                            type="checkbox"
                            checked={cfg.enabled}
                            onChange={(e) =>
                              updateStateCfg(st, {
                                enabled: e.target.checked,
                              })
                            }
                          />
                        </label>
                      </div>
                      <div className="admin-alert-card__fields">
                        <label>
                          状态标签
                          <input
                            className="admin-input"
                            value={cfg.label}
                            onChange={(e) => updateStateCfg(st, { label: e.target.value })}
                          />
                        </label>
                        <label>
                          主文案
                          <input
                            className="admin-input"
                            value={cfg.title}
                            onChange={(e) => updateStateCfg(st, { title: e.target.value })}
                          />
                        </label>
                        <label>
                          副提示
                          <input
                            className="admin-input"
                            value={cfg.subtext}
                            onChange={(e) =>
                              updateStateCfg(st, {
                                subtext: e.target.value,
                              })
                            }
                          />
                        </label>
                        {(st === 'start' || st === 'ended') && (
                          <label>
                            主视觉文字
                            <input
                              className="admin-input"
                              value={cfg.hero ?? ''}
                              onChange={(e) => updateStateCfg(st, { hero: e.target.value })}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {alertsSection === 'custom' && (
            <div className={`admin-alerts__section${alerts.enabled ? '' : ' is-dim'}`}>
              <div className="admin-alerts__section-head">
                <h3 className="admin-alerts__subtitle">自定义提醒（{alerts.custom.length}）</h3>
                <button className="admin-btn admin-btn--primary" onClick={addCustomReminder}>
                  + 添加提醒
                </button>
              </div>
              {alerts.custom.length === 0 ? (
                <p className="admin-alerts__empty">
                  <Mascot className="mascot-inline" size={28} alt="" />
                  暂无自定义提醒。可添加如「开考前 30 分钟入场」「结束前 5 分钟」等提示。
                </p>
              ) : (
                <div className="admin-alerts__custom">
                  {alerts.custom.map((c) => (
                    <div className={`admin-alert-card${c.enabled ? '' : ' is-off'}`} key={c.id}>
                      <div className="admin-alert-card__head">
                        <input
                          className="admin-input admin-alert-card__title-input"
                          value={c.name}
                          onChange={(e) =>
                            updateCustomReminder(c.id, {
                              name: e.target.value,
                            })
                          }
                          placeholder="提醒名称"
                        />
                        <div className="admin-alert-card__head-actions">
                          <label className="admin-switch">
                            <input
                              type="checkbox"
                              checked={c.enabled}
                              onChange={(e) =>
                                updateCustomReminder(c.id, {
                                  enabled: e.target.checked,
                                })
                              }
                            />
                          </label>
                          <button
                            className="admin-item-btn admin-item-btn--delete"
                            onClick={() => removeCustomReminder(c.id)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      <div className="admin-alert-card__row">
                        <label>
                          触发
                          <InlineSelect
                            className="admin-input"
                            value={c.anchor}
                            onChange={(value) =>
                              updateCustomReminder(c.id, {
                                anchor: value as CustomReminder['anchor'],
                              })
                            }
                            options={ANCHOR_OPTIONS.map((o) => ({
                              value: o.value,
                              label: o.label,
                            }))}
                          />
                        </label>
                        <label>
                          分钟
                          <input
                            className="admin-input"
                            type="number"
                            min={0}
                            max={600}
                            value={c.offsetMin}
                            onChange={(e) =>
                              updateCustomReminder(c.id, {
                                offsetMin: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                          />
                        </label>
                        <label>
                          配色
                          <InlineSelect
                            className="admin-input"
                            value={c.tone}
                            onChange={(value) =>
                              updateCustomReminder(c.id, {
                                tone: value as AlertState,
                              })
                            }
                            options={TONE_OPTIONS.map((o) => ({
                              value: o.value,
                              label: o.label,
                            }))}
                          />
                        </label>
                      </div>
                      <div className="admin-alert-card__fields">
                        <label>
                          状态标签
                          <input
                            className="admin-input"
                            value={c.label}
                            onChange={(e) =>
                              updateCustomReminder(c.id, {
                                label: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          主文案
                          <input
                            className="admin-input"
                            value={c.title}
                            onChange={(e) =>
                              updateCustomReminder(c.id, {
                                title: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          副提示
                          <input
                            className="admin-input"
                            value={c.subtext}
                            onChange={(e) =>
                              updateCustomReminder(c.id, {
                                subtext: e.target.value,
                              })
                            }
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </fieldset>
      </div>
    </AdminModalPortal>
  );
}
