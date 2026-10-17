import InlineSelect from '../InlineSelect';
import HelpTip from '../HelpTip';
import {
  ALL_CONFLICT_SCOPES,
  ALL_SCHEDULE_MODES,
  type ScheduleMode,
  type WeeklyConflictPolicy,
} from '../../types/exam';
import { SCOPE_LABEL } from '../weekly/weeklyShared';
import { Switch } from './Switch';
import { useScheduleRulesSettings } from '../../hooks/settings/useScheduleRulesSettings';

export default function ScheduleRulesSection({
  canEditScheduleMode,
  canEditConflictPolicy,
}: {
  canEditScheduleMode: boolean;
  canEditConflictPolicy: boolean;
}) {
  const { scheduleMode, weeklyConflictPolicy, saveStatus, changeScheduleMode, changeConflictPolicy } =
    useScheduleRulesSettings(canEditScheduleMode, canEditConflictPolicy);
  const canEdit = canEditScheduleMode || canEditConflictPolicy;

  return (
    <section className="set-card">
      <div className="set-card__head">
        <h2 className="set-card__title">考试调度规则</h2>
      </div>
      <p className="set-card__lead">
        这里统一维护全局运行模式和大型考试与周测的冲突策略。考试安排页面只展示应用后的具体结果，并支持单次调整。
      </p>
      <div className="set-fieldset">
        <div className="set-row">
          <label className="set-label">
            <span className="with-help-tip">
              运行模式
              <HelpTip title="运行模式">自动模式会同时调度大型考试和周测，并按冲突策略暂停周测。</HelpTip>
            </span>
          </label>
          <InlineSelect
            className="set-input"
            disabled={!canEditScheduleMode}
            value={scheduleMode}
            onChange={(value) => changeScheduleMode(value as ScheduleMode)}
            options={ALL_SCHEDULE_MODES.map((mode) => ({
              value: mode,
              label: mode === 'major-only' ? '仅大型考试' : mode === 'weekly-only' ? '仅周测' : '自动调度',
            }))}
          />
        </div>
        <div className="set-row">
          <label className="set-label">启用大型考试冲突自动处理</label>
          <Switch
            checked={weeklyConflictPolicy.enabled}
            disabled={!canEditConflictPolicy}
            onChange={(enabled) => changeConflictPolicy({ ...weeklyConflictPolicy, enabled })}
          />
        </div>
        <div className={`set-fieldset${weeklyConflictPolicy.enabled ? '' : ' is-dim'}`}>
          <div className="set-row">
            <label className="set-label">
              <span className="with-help-tip">
                暂停范围
                <HelpTip title="冲突暂停范围">时间重叠、当天或整个大型考试期间暂停周测。</HelpTip>
              </span>
            </label>
            <InlineSelect
              className="set-input"
              disabled={!canEditConflictPolicy || !weeklyConflictPolicy.enabled}
              value={weeklyConflictPolicy.scope}
              onChange={(value) =>
                changeConflictPolicy({
                  ...weeklyConflictPolicy,
                  scope: value as WeeklyConflictPolicy['scope'],
                })
              }
              options={ALL_CONFLICT_SCOPES.map((scope) => ({ value: scope, label: SCOPE_LABEL[scope] }))}
            />
          </div>
          {weeklyConflictPolicy.enabled && weeklyConflictPolicy.scope === 'time-overlap' && (
            <>
              <div className="set-row">
                <label className="set-label">开考前缓冲（分钟）</label>
                <input
                  className="set-input set-input--sm"
                  type="number"
                  min={0}
                  max={180}
                  inputMode="numeric"
                  disabled={!canEditConflictPolicy}
                  value={weeklyConflictPolicy.bufferBeforeMinutes}
                  onChange={(event) =>
                    changeConflictPolicy({
                      ...weeklyConflictPolicy,
                      bufferBeforeMinutes: Math.min(180, Math.max(0, Number(event.target.value) || 0)),
                    })
                  }
                />
              </div>
              <div className="set-row">
                <label className="set-label">结束后缓冲（分钟）</label>
                <input
                  className="set-input set-input--sm"
                  type="number"
                  min={0}
                  max={180}
                  inputMode="numeric"
                  disabled={!canEditConflictPolicy}
                  value={weeklyConflictPolicy.bufferAfterMinutes}
                  onChange={(event) =>
                    changeConflictPolicy({
                      ...weeklyConflictPolicy,
                      bufferAfterMinutes: Math.min(180, Math.max(0, Number(event.target.value) || 0)),
                    })
                  }
                />
              </div>
            </>
          )}
        </div>
        {!canEdit && <p className="set-note">当前账号只能查看调度规则。</p>}
        {saveStatus && (
          <p className="set-note" aria-live="polite">
            {saveStatus}
          </p>
        )}
      </div>
    </section>
  );
}
