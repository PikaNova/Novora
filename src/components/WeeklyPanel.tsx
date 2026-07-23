import React, { useMemo, useState } from 'react';
import type { ExamItem } from '../types';
import type {
  ScheduleMode,
  WeeklyPlan,
  WeeklyExamItem,
  WeeklyConflictPolicy,
  IsoWeekday,
} from '../types/exam';
import { ALL_CONFLICT_SCOPES } from '../types/exam';
import {
  createEmptyWeeklyPlan,
  genWeeklyItemId,
  resolveWeeklyOccurrences,
} from '../utils/weeklySchedule';
import { resolveMajorWeeklyConflicts } from '../utils/scheduleConflict';

const WEEKDAY_LABEL: Record<IsoWeekday, string> = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };
const WEEKDAY_ORDER: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];
const SCOPE_LABEL: Record<WeeklyConflictPolicy['scope'], string> = {
  'time-overlap': '仅实际时间重叠时暂停周测',
  'whole-day': '大型考试当天暂停全部周测（推荐）',
  'whole-major-period': '大型考试整个考期暂停全部周测',
};

type ItemEdit = Omit<WeeklyExamItem, 'id' | 'order'> & { id?: string };
type PlanModal = { mode: 'add' | 'settings'; name: string; activeFrom: string; activeUntil: string; forever: boolean; repeatEveryWeeks: number } | null;

function makeItemId() { return genWeeklyItemId(); }
function padHM(v: string) { const [h = '0', m = '0'] = v.split(':'); return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`; }
const HM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface WeeklyPanelProps {
  weeklyPlans: WeeklyPlan[];
  activeWeeklyPlanId: string | null;
  scheduleMode: ScheduleMode;
  weeklyConflictPolicy: WeeklyConflictPolicy;
  majorItems: ExamItem[];
  majorName: string;
  onSavePlans: (plans: WeeklyPlan[], activeId: string | null, immediate?: boolean) => void;
  onConflictPolicyChange: (policy: WeeklyConflictPolicy, immediate?: boolean) => void;
}

export default function WeeklyPanel({
  weeklyPlans,
  activeWeeklyPlanId,
  scheduleMode,
  weeklyConflictPolicy,
  majorItems,
  majorName,
  onSavePlans,
  onConflictPolicyChange,
}: WeeklyPanelProps) {
  const activePlan = weeklyPlans.find(p => p.id === activeWeeklyPlanId) ?? weeklyPlans[0] ?? null;
  const items = activePlan?.items ?? [];

  const [planModal, setPlanModal] = useState<PlanModal>(null);
  const [planError, setPlanError] = useState('');
  const [deletePlanOpen, setDeletePlanOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [editing, setEditing] = useState<ItemEdit | null>(null);
  const [editError, setEditError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<WeeklyExamItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');

  const preview = useMemo(() => {
    if (!activePlan) return [] as Array<{ date: string; weekday: IsoWeekday; name: string; startTime: string; endTime: string; suppressed: boolean; message?: string }>;
    const occ = resolveWeeklyOccurrences(activePlan, Date.now(), { daysBack: 0, daysForward: 13 });
    if (scheduleMode === 'automatic' && majorItems.length) {
      const { suppressedWeekly, conflicts } = resolveMajorWeeklyConflicts(
        [{ id: 'major', name: majorName, items: majorItems, policy: weeklyConflictPolicy }],
        occ,
      );
      const suppressedIds = new Set(suppressedWeekly.map(o => o.occurrenceId));
      const msgById = new Map(conflicts.map(c => [c.weeklyOccurrenceId, c.message]));
      return occ.map(o => ({
        date: o.date, weekday: WEEKDAY_ORDER.find(() => true)!, name: o.name,
        startTime: o.startTime.slice(11, 16), endTime: o.endTime.slice(11, 16),
        suppressed: suppressedIds.has(o.occurrenceId), message: msgById.get(o.occurrenceId),
      }));
    }
    return occ.map(o => ({ date: o.date, weekday: WEEKDAY_ORDER.find(() => true)!, name: o.name, startTime: o.startTime.slice(11, 16), endTime: o.endTime.slice(11, 16), suppressed: false }));
  }, [activePlan, scheduleMode, majorItems, majorName, weeklyConflictPolicy]);

  if (!activePlan) {
    return (
      <>
        <aside className="admin-sidebar">
          <div className="admin-tips">
            <p className="admin-tips__title">📅 周测</p>
            <ul>
              <li>周测是每周固定重复的小测（如每周一/三/五晚自习测验）。</li>
              <li>先创建一个周测计划，再往里添加具体的周测项。</li>
              <li>大型考试期间可自动暂停周测（运行模式选“自动”）。</li>
            </ul>
          </div>
        </aside>
        <main className="admin-main">
          <div className="admin-empty">
            <div className="admin-empty__icon">📅</div>
            <p>还没有周测计划</p>
            <button className="admin-btn admin-btn--primary" style={{ marginTop: 12 }} onClick={() => { setPlanModal({ mode: 'add', name: '周测计划', activeFrom: new Date().toISOString().slice(0, 10), activeUntil: '', forever: true, repeatEveryWeeks: 1 }); setPlanError(''); }}>+ 新建周测计划</button>
          </div>
        </main>
        {planModal && renderPlanModal()}
      </>
    );
  }

  function commitPlanModal() {
    if (!planModal) return;
    const name = planModal.name.trim();
    if (!name) { setPlanError('请输入计划名称'); return; }
    if (!DATE_RE.test(planModal.activeFrom)) { setPlanError('请填写生效日期'); return; }
    if (!planModal.forever && planModal.activeUntil && planModal.activeUntil < planModal.activeFrom) { setPlanError('结束日期不得早于生效日期'); return; }
    const repeat = Math.min(8, Math.max(1, Math.round(planModal.repeatEveryWeeks) || 1));
    if (planModal.mode === 'add') {
      const plan = { ...createEmptyWeeklyPlan(Date.now(), name), activeFrom: planModal.activeFrom, activeUntil: planModal.forever ? null : (planModal.activeUntil || null), anchorDate: planModal.activeFrom, repeatEveryWeeks: repeat, order: weeklyPlans.length };
      onSavePlans([...weeklyPlans, plan], plan.id, true);
    } else {
      const plans = weeklyPlans.map(p => p.id === activePlan.id ? { ...p, name, activeFrom: planModal.activeFrom, activeUntil: planModal.forever ? null : (planModal.activeUntil || null), repeatEveryWeeks: repeat } : p);
      onSavePlans(plans, activePlan.id, true);
    }
    setPlanModal(null); setPlanError('');
  }

  function removePlan() {
    const rest = weeklyPlans.filter(p => p.id !== activePlan.id).map((p, i) => ({ ...p, order: i }));
    onSavePlans(rest, rest[0]?.id ?? null, true);
    setDeletePlanOpen(false);
  }

  function togglePlanEnabled() {
    const plans = weeklyPlans.map(p => p.id === activePlan.id ? { ...p, enabled: !p.enabled } : p);
    onSavePlans(plans, activePlan.id, true);
  }

  function switchPlan(id: string) {
    if (id === activePlan.id) return;
    onSavePlans(weeklyPlans, id, true);
  }

  function commitItemModal() {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) { setEditError('请输入周测名称'); return; }
    if (!HM_RE.test(editing.startTime) || !HM_RE.test(editing.endTime)) { setEditError('请输入正确的时间（HH:mm）'); return; }
    const start = padHM(editing.startTime); const end = padHM(editing.endTime);
    if (!editing.endNextDay && end <= start) { setEditError('结束时间必须晚于开始时间（跨日请勾选“跨日结束”）'); return; }
    let nextItems: WeeklyExamItem[];
    if (editing.id) {
      nextItems = items.map(x => x.id === editing.id ? { ...x, ...editing, startTime: start, endTime: end, id: x.id, order: x.order } : x);
    } else {
      nextItems = [...items, { id: makeItemId(), order: items.length ? Math.max(...items.map(x => x.order)) + 1 : 0, name, weekday: editing.weekday, startTime: start, endTime: end, endNextDay: editing.endNextDay, enabled: editing.enabled, location: editing.location, note: editing.note }];
    }
    const plans = weeklyPlans.map(p => p.id === activePlan.id ? { ...p, items: nextItems } : p);
    onSavePlans(plans, activePlan.id, true);
    setEditing(null); setEditError('');
  }

  function removeItem(item: WeeklyExamItem) {
    const nextItems = items.filter(x => x.id !== item.id);
    const plans = weeklyPlans.map(p => p.id === activePlan.id ? { ...p, items: nextItems } : p);
    onSavePlans(plans, activePlan.id, true);
    setDeleteTarget(null);
  }

  function toggleItemEnabled(item: WeeklyExamItem) {
    const nextItems = items.map(x => x.id === item.id ? { ...x, enabled: !x.enabled } : x);
    const plans = weeklyPlans.map(p => p.id === activePlan.id ? { ...p, items: nextItems } : p);
    onSavePlans(plans, activePlan.id, true);
  }

  function importJson() {
    setImportError('');
    try {
      const source = JSON.parse(importText);
      const list = Array.isArray(source) ? source : source.items;
      if (!Array.isArray(list)) throw new Error('JSON 必须是周测数组，或包含 items 数组');
      const nextItems: WeeklyExamItem[] = list.map((raw: unknown, index: number) => {
        const row = raw as Record<string, unknown>;
        const weekday = ([1, 2, 3, 4, 5, 6, 7] as number[]).includes(row.weekday as number) ? (row.weekday as IsoWeekday) : 1;
        if (!row.name || !row.startTime || !row.endTime) throw new Error(`第 ${index + 1} 项缺少 name、startTime 或 endTime`);
        return {
          id: String(row.id ?? makeItemId()), name: String(row.name), weekday,
          startTime: padHM(String(row.startTime)), endTime: padHM(String(row.endTime)),
          endNextDay: !!row.endNextDay, enabled: row.enabled !== false,
          order: typeof row.order === 'number' ? row.order : index,
          location: typeof row.location === 'string' ? row.location : undefined,
          note: typeof row.note === 'string' ? row.note : undefined,
        };
      });
      const plans = weeklyPlans.map(p => p.id === activePlan.id ? { ...p, items: nextItems } : p);
      onSavePlans(plans, activePlan.id, true);
      setImportText(''); setImportOpen(false);
    } catch (error) { setImportError(error instanceof Error ? error.message : 'JSON 格式错误'); }
  }

  function exportJson() {
    const file = new Blob([JSON.stringify({ plan: activePlan.name, items, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(file); const link = document.createElement('a');
    link.href = url; link.download = `${activePlan.name || 'weekly'}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  const grouped = WEEKDAY_ORDER.map(wd => ({ wd, list: items.filter(i => i.weekday === wd).sort((a, b) => a.order - b.order) }));

  function renderPlanModal() {
    if (!planModal) return null;
    return (
      <div className="admin-modal-overlay" onClick={() => setPlanModal(null)}>
        <div className="admin-modal" onClick={e => e.stopPropagation()}>
          <h2 className="admin-modal__title">{planModal.mode === 'add' ? '新建周测计划' : '周测计划设置'}</h2>
          {planError && <div className="admin-error">{planError}</div>}
          <div className="admin-form">
            <label className="admin-label">计划名称<input className="admin-input" autoFocus value={planModal.name} onChange={e => setPlanModal(p => p && { ...p, name: e.target.value })} placeholder="如：高三周测 / 晚自习周测" /></label>
            <label className="admin-label">生效日期<input className="admin-input" type="date" value={planModal.activeFrom} onChange={e => setPlanModal(p => p && { ...p, activeFrom: e.target.value })} /></label>
            <label className="admin-toggle-label"><input type="checkbox" checked={planModal.forever} onChange={e => setPlanModal(p => p && { ...p, forever: e.target.checked })} />长期有效（不设结束日期）</label>
            {!planModal.forever && <label className="admin-label">结束日期<input className="admin-input" type="date" value={planModal.activeUntil} onChange={e => setPlanModal(p => p && { ...p, activeUntil: e.target.value })} /></label>}
            <label className="admin-label">重复周期<select className="admin-input" value={planModal.repeatEveryWeeks} onChange={e => setPlanModal(p => p && { ...p, repeatEveryWeeks: Number(e.target.value) })}>
              {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n === 1 ? '每周' : `每 ${n} 周（隔 ${n - 1} 周）`}</option>)}
            </select></label>
            <div className="admin-form-actions"><button className="admin-btn admin-btn--primary" onClick={commitPlanModal}>确认并保存</button><button className="admin-btn admin-btn--ghost" onClick={() => { setPlanModal(null); setPlanError(''); }}>取消</button></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <aside className="admin-sidebar">
        <div className="admin-major-card">
          <div className="admin-major-card__head"><label className="admin-label" style={{ opacity: .9 }}>周测计划</label><span className="admin-major-card__count">共 {weeklyPlans.length} 个</span></div>
          <div className="admin-major-card__active">
            <span className="admin-major-card__active-name" title={activePlan.name}>{activePlan.name}{!activePlan.enabled ? '（已停用）' : ''}</span>
            <span className="admin-major-card__active-meta">{items.length} 条周测 · {items.filter(i => i.enabled).length} 条启用 · {activePlan.repeatEveryWeeks === 1 ? '每周' : `每 ${activePlan.repeatEveryWeeks} 周`}</span>
          </div>
          {weeklyPlans.length > 1 && (
            <label className="admin-major-card__switch">
              <span className="admin-major-card__switch-k">切换计划</span>
              <select className="admin-input admin-major-select" value={activePlan.id} onChange={e => switchPlan(e.target.value)}>
                {weeklyPlans.map(p => <option key={p.id} value={p.id}>{p.name}（{p.items.length} 条）</option>)}
              </select>
            </label>
          )}
          <div className="admin-major-card__btns">
            <button className="admin-btn admin-btn--primary" onClick={() => { setPlanModal({ mode: 'add', name: '周测计划', activeFrom: new Date().toISOString().slice(0, 10), activeUntil: '', forever: true, repeatEveryWeeks: 1 }); setPlanError(''); }}>+ 新建</button>
            <button className="admin-btn" onClick={() => { setPlanModal({ mode: 'settings', name: activePlan.name, activeFrom: activePlan.activeFrom, activeUntil: activePlan.activeUntil ?? '', forever: !activePlan.activeUntil, repeatEveryWeeks: activePlan.repeatEveryWeeks }); setPlanError(''); }}>计划设置</button>
            <button className="admin-btn admin-btn--danger" onClick={() => setDeletePlanOpen(true)}>删除</button>
          </div>
          <div className="admin-major-card__btns">
            <button className="admin-btn" style={{ flex: 1 }} onClick={togglePlanEnabled}>{activePlan.enabled ? '停用此计划' : '启用此计划'}</button>
          </div>
          <p className="admin-major-card__hint">生效期：{activePlan.activeFrom}{' ~ '}{activePlan.activeUntil || '长期'}</p>
        </div>

        <div className="admin-form-card">
          <h2 className="admin-form-card__title">大型考试冲突处理</h2>
          <p className="admin-major-card__hint" style={{ margin: '0 0 10px' }}>仅在运行模式为“自动”时生效：{SCOPE_LABEL[weeklyConflictPolicy.scope]}</p>
          <button className="admin-btn" style={{ width: '100%' }} onClick={() => setPolicyOpen(true)}>冲突处理设置</button>
        </div>

        <div className="admin-tips">
          <p className="admin-tips__title">💡 使用说明</p>
          <ul>
            <li>周测按星期固定重复，与具体日期无关</li>
            <li>运行模式为“自动”时，大型考试期间会按策略自动暂停周测</li>
            <li>删除计划或周测项无法撤销</li>
          </ul>
        </div>
      </aside>
      <main className="admin-main">
        <div className="admin-list-header">
          <h2 className="admin-list-title">{activePlan.name} · 周测</h2>
          <span className="admin-list-count">{items.length} 项</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="admin-btn" onClick={() => setImportOpen(true)}>导入 JSON</button>
            <button className="admin-btn" onClick={exportJson}>导出 JSON</button>
            <button className="admin-btn admin-btn--primary" onClick={() => { setEditing({ name: '', weekday: 1, startTime: '19:00', endTime: '20:00', endNextDay: false, enabled: true }); setEditError(''); }}>+ 添加周测</button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="admin-empty"><div className="admin-empty__icon">📅</div><p>当前计划暂无周测，点击“添加周测”开始</p></div>
        ) : (
          <div className="weekly-groups">
            {grouped.filter(g => g.list.length > 0).map(g => (
              <div className="weekly-group" key={g.wd}>
                <h3 className="weekly-group__title">{WEEKDAY_LABEL[g.wd]}</h3>
                <ul className="admin-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {g.list.map(item => (
                    <li className={`admin-item${!item.enabled ? ' admin-item--disabled' : ''}`} key={item.id}>
                      <div className="admin-item__order"><span className="admin-item__order-num">{WEEKDAY_LABEL[item.weekday]}</span></div>
                      <div className="admin-item__info">
                        <div className="admin-item__name-row"><span className="admin-item__name">{item.name}</span>{!item.enabled && <span className="admin-item__status" style={{ color: '#6c757d', background: 'rgba(108,117,125,.1)' }}>已停用</span>}</div>
                        <div className="admin-item__times"><span>{item.startTime}</span><span className="admin-item__times-sep">–</span><span>{item.endTime}{item.endNextDay ? '（次日）' : ''}</span>{item.location && <span className="admin-item__duration">{item.location}</span>}</div>
                      </div>
                      <div className="admin-item__actions">
                        <button type="button" className={`admin-item-btn admin-item-btn--toggle ${item.enabled ? 'admin-item-btn--disable' : 'admin-item-btn--enable'}`} onClick={() => toggleItemEnabled(item)}>{item.enabled ? '停用' : '启用'}</button>
                        <button className="admin-item-btn" onClick={() => { setEditing({ ...item }); setEditError(''); }}>编辑</button>
                        <button className="admin-item-btn admin-item-btn--delete" onClick={() => setDeleteTarget(item)}>删除</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="admin-list-header" style={{ marginTop: 22 }}>
          <h2 className="admin-list-title">未来两周预览</h2>
          <span className="admin-list-count">{preview.length} 场</span>
        </div>
        {preview.length === 0 ? (
          <div className="admin-collapsed-hint">未来两周内暂无周测实例（可能计划已停用、不在生效期或没有启用的周测项）</div>
        ) : (
          <ul className="admin-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {preview.map((o, i) => (
              <li className={`admin-item${o.suppressed ? ' admin-item--disabled' : ''}`} key={`${o.date}-${i}`}>
                <div className="admin-item__order"><span className="admin-item__order-num">{o.date.slice(5)}</span></div>
                <div className="admin-item__info">
                  <div className="admin-item__name-row"><span className="admin-item__name">{o.name}</span>{o.suppressed && <span className="admin-item__status" style={{ color: '#e6a23c', background: 'rgba(230,162,60,.12)' }}>已暂停</span>}</div>
                  <div className="admin-item__times"><span>{o.date}</span><span className="admin-item__times-sep">·</span><span>{o.startTime}–{o.endTime}</span></div>
                  {o.message && <div className="admin-item__times" style={{ opacity: .7 }}>{o.message}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      {planModal && renderPlanModal()}
      {deletePlanOpen && (
        <div className="admin-modal-overlay" onClick={() => setDeletePlanOpen(false)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h2 className="admin-modal__title">删除周测计划</h2>
            <p className="admin-modal__body">确定删除「{activePlan.name}」及其全部 {items.length} 条周测？此操作无法撤销。</p>
            <div className="admin-modal__actions"><button className="admin-btn admin-btn--danger" onClick={removePlan}>删除</button><button className="admin-btn" onClick={() => setDeletePlanOpen(false)}>取消</button></div>
          </div>
        </div>
      )}
      {editing && (
        <div className="admin-modal-overlay" onClick={() => setEditing(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h2 className="admin-modal__title">{editing.id ? '编辑周测' : '添加周测'}</h2>
            {editError && <div className="admin-error">{editError}</div>}
            <div className="admin-form">
              <label className="admin-label">名称<input className="admin-input" autoFocus value={editing.name} onChange={e => setEditing(p => p && { ...p, name: e.target.value })} placeholder="如：周测 / 晚自习测验" /></label>
              <label className="admin-label">星期<select className="admin-input" value={editing.weekday} onChange={e => setEditing(p => p && { ...p, weekday: Number(e.target.value) as IsoWeekday })}>
                {WEEKDAY_ORDER.map(wd => <option key={wd} value={wd}>{WEEKDAY_LABEL[wd]}</option>)}
              </select></label>
              <label className="admin-label">开始时间<input className="admin-input" type="time" value={editing.startTime} onChange={e => setEditing(p => p && { ...p, startTime: e.target.value })} /></label>
              <label className="admin-label">结束时间<input className="admin-input" type="time" value={editing.endTime} onChange={e => setEditing(p => p && { ...p, endTime: e.target.value })} /></label>
              <label className="admin-toggle-label"><input type="checkbox" checked={!!editing.endNextDay} onChange={e => setEditing(p => p && { ...p, endNextDay: e.target.checked })} />跨日结束（结束时间落在次日）</label>
              <label className="admin-label">地点 / 备注（可选）<input className="admin-input" value={editing.location ?? ''} onChange={e => setEditing(p => p && { ...p, location: e.target.value })} placeholder="如：本班教室" /></label>
              <label className="admin-toggle-label"><input type="checkbox" checked={editing.enabled} onChange={e => setEditing(p => p && { ...p, enabled: e.target.checked })} />启用此周测</label>
              <div className="admin-form-actions"><button className="admin-btn admin-btn--primary" onClick={commitItemModal}>确认并保存</button><button className="admin-btn admin-btn--ghost" onClick={() => { setEditing(null); setEditError(''); }}>取消</button></div>
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <div className="admin-modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h2 className="admin-modal__title">确认删除</h2>
            <p className="admin-modal__body">确定删除「{deleteTarget.name}」？此操作无法撤销。</p>
            <div className="admin-modal__actions"><button className="admin-btn admin-btn--danger" onClick={() => removeItem(deleteTarget)}>删除</button><button className="admin-btn" onClick={() => setDeleteTarget(null)}>取消</button></div>
          </div>
        </div>
      )}
      {importOpen && (
        <div className="admin-modal-overlay" onClick={() => setImportOpen(false)}>
          <div className="admin-modal admin-modal--wide" onClick={e => e.stopPropagation()}>
            <h2 className="admin-modal__title">导入周测 JSON</h2>
            <p className="admin-modal__body">导入到当前计划「{activePlan.name}」，会覆盖该计划现有的周测列表。支持纯数组，或含 <code>items</code> 数组的备份文件。</p>
            {importError && <div className="admin-error">{importError}</div>}
            <textarea className="admin-textarea" rows={11} value={importText} onChange={e => setImportText(e.target.value)} placeholder='{"items":[{"name":"周测","weekday":1,"startTime":"19:00","endTime":"20:00","enabled":true}]}' />
            <div className="admin-modal__actions"><button className="admin-btn admin-btn--primary" onClick={importJson}>导入并自动保存</button><button className="admin-btn" onClick={() => { setImportOpen(false); setImportError(''); }}>取消</button></div>
          </div>
        </div>
      )}
      {policyOpen && (
        <div className="admin-modal-overlay" onClick={() => setPolicyOpen(false)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h2 className="admin-modal__title">大型考试冲突处理</h2>
            <div className="admin-form">
              <label className="admin-toggle-label"><input type="checkbox" checked={weeklyConflictPolicy.enabled} onChange={e => onConflictPolicyChange({ ...weeklyConflictPolicy, enabled: e.target.checked }, true)} />启用冲突自动处理（仅自动模式下生效）</label>
              <label className="admin-label">暂停范围<select className="admin-input" value={weeklyConflictPolicy.scope} onChange={e => onConflictPolicyChange({ ...weeklyConflictPolicy, scope: e.target.value as WeeklyConflictPolicy['scope'] }, true)}>
                {ALL_CONFLICT_SCOPES.map(s => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
              </select></label>
              {weeklyConflictPolicy.scope === 'time-overlap' && (
                <>
                  <label className="admin-label">开考前缓冲（分钟）<input className="admin-input" type="number" min={0} max={180} value={weeklyConflictPolicy.bufferBeforeMinutes} onChange={e => onConflictPolicyChange({ ...weeklyConflictPolicy, bufferBeforeMinutes: Math.max(0, Number(e.target.value) || 0) }, true)} /></label>
                  <label className="admin-label">结束后缓冲（分钟）<input className="admin-input" type="number" min={0} max={180} value={weeklyConflictPolicy.bufferAfterMinutes} onChange={e => onConflictPolicyChange({ ...weeklyConflictPolicy, bufferAfterMinutes: Math.max(0, Number(e.target.value) || 0) }, true)} /></label>
                </>
              )}
              <div className="admin-form-actions"><button className="admin-btn admin-btn--primary" onClick={() => setPolicyOpen(false)}>完成</button></div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
