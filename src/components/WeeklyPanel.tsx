import React, { useMemo, useState } from 'react';
import type { ExamItem } from '../types';
import type {
  ScheduleMode,
  WeeklyPlan,
  WeeklyExamItem,
  WeeklyExamOverride,
  WeeklyConflictPolicy,
  IsoWeekday,
  WeeklyWeekMode,
  WeeklyWeekType,
} from '../types/exam';
import { ALL_CONFLICT_SCOPES } from '../types/exam';
import {
  createEmptyWeeklyPlan,
  genWeeklyItemId,
  genWeeklyOverrideId,
  resolveWeeklyOccurrences,
  addDaysToDateKey,
  getShanghaiDateKey,
  getWeekTypeForDate,
  genWeeklyPlanId,
  isoWeekdayOfDateKey,
  normalizeWeeklyPlan,
} from '../utils/weeklySchedule';
import { resolveMajorWeeklyConflicts } from '../utils/scheduleConflict';
import { useBackdropDismiss } from '../hooks/useBackdropDismiss';
import { getOfficialHolidayName, OFFICIAL_HOLIDAYS } from '../data/officialHolidays';
import HelpTip from './HelpTip';

const WEEKDAY_LABEL: Record<IsoWeekday, string> = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };
const WEEKDAY_ORDER: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];
const SCOPE_LABEL: Record<WeeklyConflictPolicy['scope'], string> = {
  'time-overlap': '仅实际时间重叠时暂停周测',
  'whole-day': '大型考试当天暂停全部周测（推荐）',
  'whole-major-period': '大型考试整个考期暂停全部周测',
};

type ItemEdit = Omit<WeeklyExamItem, 'id' | 'order'> & { id?: string };
type PlanModal = { mode: 'add' | 'settings'; name: string; activeFrom: string; activeUntil: string; anchorDate: string; forever: boolean; repeatEveryWeeks: number; weekMode: WeeklyWeekMode; excludeOfficialHolidays: boolean } | null;
type PreviewOcc = {
  date: string; weekday: IsoWeekday; name: string; startTime: string; endTime: string;
  suppressed: boolean; forced: boolean; weeklyItemId: string; message?: string;
  conflict?: { majorName: string; majorStartTime: string; majorEndTime: string; scope: string };
};
function fmtDT(iso?: string) { return iso ? iso.slice(0, 16).replace('T', ' ') : '—'; }

function makeItemId() { return genWeeklyItemId(); }
function padHM(v: string) { const [h = '0', m = '0'] = v.split(':'); return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`; }
function sortWeeklyItems(list: WeeklyExamItem[]): WeeklyExamItem[] { return [...list].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime) || a.name.localeCompare(b.name, 'zh-CN')).map((item, order) => ({ ...item, order })); }
const HM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_TYPE_LABEL: Record<WeeklyWeekType, string> = { all: '每周', a: 'A 周', b: 'B 周' };
export interface WeeklyPanelProps {
  weeklyPlans: WeeklyPlan[];
  activeWeeklyPlanId: string | null;
  activeWeeklyPlanIdByClassId: Record<string, string | null>;
  selectedGradeId: string;
  selectedClassId: string;
  selectedClassName: string;
  classOptions: Array<{ id: string; gradeId: string; label: string }>;
  scheduleMode: ScheduleMode;
  weeklyConflictPolicy: WeeklyConflictPolicy;
  majorItems: ExamItem[];
  majorName: string;
  onSavePlans: (plans: WeeklyPlan[], activeId: string | null, classId: string, immediate?: boolean) => void;
  onConflictPolicyChange: (policy: WeeklyConflictPolicy, immediate?: boolean) => void;
}

export default function WeeklyPanel({
  weeklyPlans,
  activeWeeklyPlanId,
  activeWeeklyPlanIdByClassId,
  selectedGradeId,
  selectedClassId,
  selectedClassName,
  classOptions,
  scheduleMode,
  weeklyConflictPolicy,
  majorItems,
  majorName,
  onSavePlans,
  onConflictPolicyChange,
}: WeeklyPanelProps) {
  const backdropProps = useBackdropDismiss();
  const scopedPlans = weeklyPlans.filter(p => p.classId === selectedClassId);
  const classActiveId = selectedClassId ? activeWeeklyPlanIdByClassId[selectedClassId] : activeWeeklyPlanId;
  const activePlan = scopedPlans.find(p => p.id === classActiveId) ?? scopedPlans[0] ?? null;
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
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  const [newExcludeDate, setNewExcludeDate] = useState('');
  const [conflictTarget, setConflictTarget] = useState<PreviewOcc | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<{ occ: PreviewOcc; name: string; date: string; startTime: string; endTime: string } | null>(null);
  const [rescheduleError, setRescheduleError] = useState('');
  const [copyModal, setCopyModal] = useState<{ sourcePlanId: string; targetClassIds: string[] } | null>(null);
  const [lastDeleted, setLastDeleted] = useState<
    | { kind: 'plan'; plan: WeeklyPlan; index: number }
    | { kind: 'item'; item: WeeklyExamItem; index: number; planId: string }
    | { kind: 'occurrence'; overrideId: string; name: string }
    | null
  >(null);

  const preview = useMemo((): PreviewOcc[] => {
    if (!activePlan) return [];
    const occ = resolveWeeklyOccurrences(activePlan, Date.now(), { daysBack: 0, daysForward: 13 });
    if (scheduleMode === 'automatic' && majorItems.length) {
      const { suppressedWeekly, conflicts } = resolveMajorWeeklyConflicts(
        [{ id: 'major', name: majorName, items: majorItems, policy: weeklyConflictPolicy }],
        occ,
      );
      const suppressedIds = new Set(suppressedWeekly.map(o => o.occurrenceId));
      const conflictById = new Map(conflicts.map(c => [c.weeklyOccurrenceId, c]));
      return occ.map(o => {
        const c = conflictById.get(o.occurrenceId);
        return {
          date: o.date, weekday: isoWeekdayOfDateKey(o.date), name: o.name,
          startTime: o.startTime.slice(11, 16), endTime: o.endTime.slice(11, 16),
          suppressed: suppressedIds.has(o.occurrenceId), forced: o.forced, weeklyItemId: o.weeklyItemId,
          message: c?.message,
          conflict: c ? { majorName: c.majorName, majorStartTime: c.majorStartTime, majorEndTime: c.majorEndTime, scope: c.type } : undefined,
        };
      });
    }
    return occ.map(o => ({ date: o.date, weekday: isoWeekdayOfDateKey(o.date), name: o.name, startTime: o.startTime.slice(11, 16), endTime: o.endTime.slice(11, 16), suppressed: false, forced: o.forced, weeklyItemId: o.weeklyItemId }));
  }, [activePlan, scheduleMode, majorItems, majorName, weeklyConflictPolicy]);

  const calendarDays = useMemo(() => {
    const first = getShanghaiDateKey(Date.now());
    return Array.from({ length: 14 }, (_, index) => {
      const date = addDaysToDateKey(first, index);
      const officialHoliday = activePlan?.excludeOfficialHolidays ? getOfficialHolidayName(date) : null;
      const manuallyExcluded = !!activePlan?.excludedDates.includes(date);
      return { date, weekday: isoWeekdayOfDateKey(date), entries: preview.filter(item => item.date === date), officialHoliday, manuallyExcluded, weekType: activePlan?.weekMode === 'ab' ? getWeekTypeForDate(activePlan, date) : null };
    });
  }, [preview, activePlan]);

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
            <button className="admin-btn admin-btn--primary" style={{ marginTop: 12 }} disabled={!selectedClassId} onClick={() => { const today = getShanghaiDateKey(Date.now()); setPlanModal({ mode: 'add', name: `${selectedClassName}周测计划`, activeFrom: today, activeUntil: '', anchorDate: today, forever: true, repeatEveryWeeks: 1, weekMode: 'single', excludeOfficialHolidays: false }); setPlanError(''); }}>+ 新建周测计划</button>
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
    if (!DATE_RE.test(planModal.anchorDate)) { setPlanError('请填写学期开始日期'); return; }
    if (!planModal.forever && planModal.activeUntil && planModal.activeUntil < planModal.activeFrom) { setPlanError('结束日期不得早于生效日期'); return; }
    const repeat = Math.min(8, Math.max(1, Math.round(planModal.repeatEveryWeeks) || 1));
    if (planModal.mode === 'add') {
      const plan = { ...createEmptyWeeklyPlan(Date.now(), name), gradeId: selectedGradeId, classId: selectedClassId, activeFrom: planModal.activeFrom, activeUntil: planModal.forever ? null : (planModal.activeUntil || null), anchorDate: planModal.anchorDate, repeatEveryWeeks: repeat, weekMode: planModal.weekMode, excludeOfficialHolidays: planModal.excludeOfficialHolidays, order: weeklyPlans.length };
      onSavePlans([...weeklyPlans, plan], plan.id, plan.classId, true);
    } else {
      const plans = weeklyPlans.map(p => p.id === activePlan.id ? { ...p, name, activeFrom: planModal.activeFrom, activeUntil: planModal.forever ? null : (planModal.activeUntil || null), anchorDate: planModal.anchorDate, repeatEveryWeeks: repeat, weekMode: planModal.weekMode, excludeOfficialHolidays: planModal.excludeOfficialHolidays } : p);
      onSavePlans(plans, activePlan.id, selectedClassId, true);
    }
    setPlanModal(null); setPlanError('');
  }

  function removePlan() {
    const index = weeklyPlans.findIndex(p => p.id === activePlan.id);
    const rest = weeklyPlans.filter(p => p.id !== activePlan.id).map((p, i) => ({ ...p, order: i }));
    const nextId = rest.find(p => p.classId === selectedClassId)?.id ?? null;
    setLastDeleted({ kind: 'plan', plan: activePlan, index });
    onSavePlans(rest, nextId, selectedClassId, true);
    setDeletePlanOpen(false);
  }

  function togglePlanEnabled() {
    const plans = weeklyPlans.map(p => p.id === activePlan.id ? { ...p, enabled: !p.enabled } : p);
    onSavePlans(plans, activePlan.id, selectedClassId, true);
  }

  function switchPlan(id: string) {
    if (id === activePlan.id) return;
    onSavePlans(weeklyPlans, id, selectedClassId, true);
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
      nextItems = [...items, { id: makeItemId(), order: items.length ? Math.max(...items.map(x => x.order)) + 1 : 0, name, weekday: editing.weekday, startTime: start, endTime: end, endNextDay: editing.endNextDay, enabled: editing.enabled, location: editing.location, note: editing.note, weekType: editing.weekType ?? 'all' }];
    }
    nextItems = sortWeeklyItems(nextItems);
    const plans = weeklyPlans.map(p => p.id === activePlan.id ? { ...p, items: nextItems } : p);
    onSavePlans(plans, activePlan.id, selectedClassId, true);
    setEditing(null); setEditError('');
  }

  function removeItem(item: WeeklyExamItem) {
    const index = items.findIndex(x => x.id === item.id);
    const nextItems = items.filter(x => x.id !== item.id);
    const plans = weeklyPlans.map(p => p.id === activePlan.id ? { ...p, items: nextItems } : p);
    onSavePlans(plans, activePlan.id, selectedClassId, true);
    setLastDeleted({ kind: 'item', item, index, planId: activePlan.id });
    setDeleteTarget(null);
  }

  function upsertOverride(next: WeeklyExamOverride) {
    const exists = activePlan.overrides.some(o => o.id === next.id);
    const overrides = exists ? activePlan.overrides.map(o => o.id === next.id ? next : o) : [...activePlan.overrides, next];
    const plans = weeklyPlans.map(p => p.id === activePlan.id ? { ...p, overrides } : p);
    onSavePlans(plans, activePlan.id, selectedClassId, true);
  }

  function removeOverride(id: string) {
    const plans = weeklyPlans.map(p => p.id === activePlan.id ? { ...p, overrides: p.overrides.filter(o => o.id !== id) } : p);
    onSavePlans(plans, activePlan.id, selectedClassId, true);
  }

  function addExcludedDate() {
    if (!DATE_RE.test(newExcludeDate) || activePlan.excludedDates.includes(newExcludeDate)) return;
    const plans = weeklyPlans.map(p => p.id === activePlan.id ? { ...p, excludedDates: [...p.excludedDates, newExcludeDate].sort() } : p);
    onSavePlans(plans, activePlan.id, selectedClassId, true);
    setNewExcludeDate('');
  }

  function removeExcludedDate(date: string) {
    const plans = weeklyPlans.map(p => p.id === activePlan.id ? { ...p, excludedDates: p.excludedDates.filter(d => d !== date) } : p);
    onSavePlans(plans, activePlan.id, selectedClassId, true);
  }

  function cancelOccurrence(o: PreviewOcc) {
    if (!window.confirm(`确定取消「${o.name}」${o.date} 这一次吗？此操作仅影响这一次，不影响周期规则。`)) return;
    const overrideId = genWeeklyOverrideId(o.weeklyItemId, o.date);
    upsertOverride({ id: overrideId, sourceItemId: o.weeklyItemId, date: o.date, action: 'cancel', reason: '管理员单次取消' });
    setLastDeleted({ kind: 'occurrence', overrideId, name: `${o.date} ${o.name}` });
  }

  function restoreLastDeleted() {
    if (!lastDeleted) return;
    if (lastDeleted.kind === 'plan') {
      const plans = [...weeklyPlans];
      plans.splice(Math.max(0, lastDeleted.index), 0, lastDeleted.plan);
      onSavePlans(plans.map((p, i) => ({ ...p, order: i })), lastDeleted.plan.id, lastDeleted.plan.classId, true);
    } else if (lastDeleted.kind === 'item') {
      const plans = weeklyPlans.map(plan => {
        if (plan.id !== lastDeleted.planId) return plan;
        const nextItems = [...plan.items];
        nextItems.splice(Math.max(0, lastDeleted.index), 0, lastDeleted.item);
        return { ...plan, items: nextItems.map((item, index) => ({ ...item, order: index })) };
      });
      onSavePlans(plans, lastDeleted.planId, selectedClassId, true);
    } else {
      removeOverride(lastDeleted.overrideId);
    }
    setLastDeleted(null);
  }

  function openReschedule(o: PreviewOcc) {
    setRescheduleTarget({ occ: o, name: o.name, date: o.date, startTime: o.startTime, endTime: o.endTime });
    setRescheduleError('');
  }

  function commitReschedule() {
    if (!rescheduleTarget) return;
    const { occ, name, date, startTime, endTime } = rescheduleTarget;
    if (!name.trim()) { setRescheduleError('请输入名称'); return; }
    if (!DATE_RE.test(date)) { setRescheduleError('请填写正确日期'); return; }
    if (!HM_RE.test(startTime) || !HM_RE.test(endTime)) { setRescheduleError('请输入正确的时间（HH:mm）'); return; }
    upsertOverride({ id: genWeeklyOverrideId(occ.weeklyItemId, occ.date), sourceItemId: occ.weeklyItemId, date: occ.date, action: 'replace', name: name.trim(), startTime: padHM(startTime), endTime: padHM(endTime), reason: '管理员临时调课' });
    setRescheduleTarget(null);
  }

  function keepSuppressed() { setConflictTarget(null); }

  function forceRunOccurrence() {
    if (!conflictTarget) return;
    upsertOverride({ id: genWeeklyOverrideId(conflictTarget.weeklyItemId, conflictTarget.date), sourceItemId: conflictTarget.weeklyItemId, date: conflictTarget.date, action: 'replace', forceRunDuringMajorExam: true, reason: '管理员确认仍然进行' });
    setConflictTarget(null);
  }

  function unforceOccurrence(o: PreviewOcc) {
    removeOverride(genWeeklyOverrideId(o.weeklyItemId, o.date));
  }

  function toggleItemEnabled(item: WeeklyExamItem) {
    const nextItems = items.map(x => x.id === item.id ? { ...x, enabled: !x.enabled } : x);
    const plans = weeklyPlans.map(p => p.id === activePlan.id ? { ...p, items: nextItems } : p);
    onSavePlans(plans, activePlan.id, selectedClassId, true);
  }

  function importJson() {
    setImportError('');
    try {
      const source = JSON.parse(importText);
      if (source?.plan && typeof source.plan === 'object') {
        const imported = normalizeWeeklyPlan(source.plan, weeklyPlans.length);
        const newPlanId = genWeeklyPlanId();
        const idMap = new Map(imported.items.map(item => [item.id, makeItemId()]));
        const importedPlan: WeeklyPlan = {
          ...imported,
          id: newPlanId,
          name: `${imported.name}（导入）`,
          gradeId: selectedGradeId,
          classId: selectedClassId,
          order: weeklyPlans.length,
          items: imported.items.map((item, index) => ({ ...item, id: idMap.get(item.id)!, order: index })),
          overrides: imported.overrides
            .filter(item => idMap.has(item.sourceItemId))
            .map(item => ({ ...item, id: genWeeklyOverrideId(idMap.get(item.sourceItemId)!, item.date), sourceItemId: idMap.get(item.sourceItemId)! })),
        };
        onSavePlans([...weeklyPlans, importedPlan], importedPlan.id, selectedClassId, true);
        setImportText(''); setImportOpen(false);
        return;
      }
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
           weekType: (['all', 'a', 'b'] as WeeklyWeekType[]).includes(row.weekType as WeeklyWeekType) ? row.weekType as WeeklyWeekType : 'all',
        };
      });
      const plans = weeklyPlans.map(p => p.id === activePlan.id ? { ...p, items: sortWeeklyItems(nextItems) } : p);
      onSavePlans(plans, activePlan.id, selectedClassId, true);
      setImportText(''); setImportOpen(false);
    } catch (error) { setImportError(error instanceof Error ? error.message : 'JSON 格式错误'); }
  }

  function exportJson() {
    const file = new Blob([JSON.stringify({ schemaVersion: 1, plan: activePlan, items, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(file); const link = document.createElement('a');
    link.href = url; link.download = `${activePlan.name || 'weekly'}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  function commitCopyPlan() {
    if (!copyModal?.targetClassIds.length) return;
    const source = weeklyPlans.find(plan => plan.id === copyModal.sourcePlanId);
    if (!source) return;
    const copies = copyModal.targetClassIds.map((classId, offset) => {
      const target = classOptions.find(item => item.id === classId)!;
      const idMap = new Map(source.items.map(item => [item.id, makeItemId()]));
      return { ...source, id: genWeeklyPlanId(), gradeId: target.gradeId, classId, name: `${source.name}（复制）`, enabled: true, order: weeklyPlans.length + offset, items: source.items.map((item, index) => ({ ...item, id: idMap.get(item.id)!, order: index })), overrides: source.overrides.filter(item => idMap.has(item.sourceItemId)).map(item => ({ ...item, sourceItemId: idMap.get(item.sourceItemId)!, id: genWeeklyOverrideId(idMap.get(item.sourceItemId)!, item.date) })) };
    });
    onSavePlans([...weeklyPlans, ...copies], activePlan.id, selectedClassId, true);
    setCopyModal(null);
  }

  const grouped = WEEKDAY_ORDER.map(wd => ({ wd, list: items.filter(i => i.weekday === wd).sort((a, b) => a.order - b.order) }));

  function renderPlanModal() {
    if (!planModal) return null;
    return (
      <div className="admin-modal-overlay" {...backdropProps(() => setPlanModal(null))}>
        <div className="admin-modal" onClick={e => e.stopPropagation()}>
          <h2 className="admin-modal__title">{planModal.mode === 'add' ? '新建周测计划' : '周测计划设置'}</h2>
          {planError && <div className="admin-error">{planError}</div>}
          <div className="admin-form">
            <label className="admin-label">计划名称<input className="admin-input" autoFocus value={planModal.name} onChange={e => setPlanModal(p => p && { ...p, name: e.target.value })} placeholder="如：高三周测 / 晚自习周测" /></label>
            <label className="admin-label">生效日期<input className="admin-input" type="date" value={planModal.activeFrom} onChange={e => setPlanModal(p => p && { ...p, activeFrom: e.target.value })} /></label>
            <label className="admin-label">学期开始日期（A 周锚点）<input className="admin-input" type="date" value={planModal.anchorDate} onChange={e => setPlanModal(p => p && { ...p, anchorDate: e.target.value })} /></label>
            <label className="admin-label">周次模式<select className="admin-input" value={planModal.weekMode} onChange={e => setPlanModal(p => p && { ...p, weekMode: e.target.value as WeeklyWeekMode })}><option value="single">统一周表</option><option value="ab">A/B 周交替</option></select></label>
            <label className="admin-toggle-label"><input type="checkbox" checked={planModal.forever} onChange={e => setPlanModal(p => p && { ...p, forever: e.target.checked })} />长期有效（不设结束日期）</label>
            {!planModal.forever && <label className="admin-label">结束日期<input className="admin-input" type="date" value={planModal.activeUntil} onChange={e => setPlanModal(p => p && { ...p, activeUntil: e.target.value })} /></label>}
            {planModal.weekMode === 'single' && <label className="admin-label">重复周期<select className="admin-input" value={planModal.repeatEveryWeeks} onChange={e => setPlanModal(p => p && { ...p, repeatEveryWeeks: Number(e.target.value) })}>
              {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n === 1 ? '每周' : `每 ${n} 周（隔 ${n - 1} 周）`}</option>)}
            </select></label>}
            <label className="admin-toggle-label"><input type="checkbox" checked={planModal.excludeOfficialHolidays} onChange={e => setPlanModal(p => p && { ...p, excludeOfficialHolidays: e.target.checked })} />自动排除 2026 年法定节假日</label>
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
          <div className="admin-major-card__head"><label className="admin-label" style={{ opacity: .9 }}>{selectedClassName} · 周测计划</label><span className="admin-major-card__count">共 {scopedPlans.length} 个</span></div>
          <div className="admin-major-card__active">
            <span className="admin-major-card__active-name" title={activePlan.name}>{activePlan.name}{!activePlan.enabled ? '（已停用）' : ''}</span>
            <span className="admin-major-card__active-meta">{items.length} 条周测 · {items.filter(i => i.enabled).length} 条启用 · {activePlan.weekMode === 'ab' ? 'A/B 周' : activePlan.repeatEveryWeeks === 1 ? '每周' : `每 ${activePlan.repeatEveryWeeks} 周`}</span>
          </div>
          {scopedPlans.length > 1 && (
            <label className="admin-major-card__switch">
              <span className="admin-major-card__switch-k">切换计划</span>
              <select className="admin-input admin-major-select" value={activePlan.id} onChange={e => switchPlan(e.target.value)}>
                {scopedPlans.map(p => <option key={p.id} value={p.id}>{p.name}（{p.items.length} 条）</option>)}
              </select>
            </label>
          )}
          <div className="admin-major-card__btns">
            <button className="admin-btn admin-btn--primary" onClick={() => { const today = getShanghaiDateKey(Date.now()); setPlanModal({ mode: 'add', name: `${selectedClassName}周测计划`, activeFrom: today, activeUntil: '', anchorDate: today, forever: true, repeatEveryWeeks: 1, weekMode: 'single', excludeOfficialHolidays: false }); setPlanError(''); }}>+ 新建</button>
            <button className="admin-btn" onClick={() => { setPlanModal({ mode: 'settings', name: activePlan.name, activeFrom: activePlan.activeFrom, activeUntil: activePlan.activeUntil ?? '', anchorDate: activePlan.anchorDate, forever: !activePlan.activeUntil, repeatEveryWeeks: activePlan.repeatEveryWeeks, weekMode: activePlan.weekMode ?? 'single', excludeOfficialHolidays: activePlan.excludeOfficialHolidays === true }); setPlanError(''); }}>计划设置</button>
            <button className="admin-btn admin-btn--danger" onClick={() => setDeletePlanOpen(true)}>删除</button>
          </div>
          <div className="admin-major-card__btns">
            <button className="admin-btn" style={{ flex: 1 }} onClick={togglePlanEnabled}>{activePlan.enabled ? '停用此计划' : '启用此计划'}</button>
            <button className="admin-btn" style={{ flex: 1 }} onClick={() => setCopyModal({ sourcePlanId: activePlan.id, targetClassIds: [] })}>批量应用</button><HelpTip title="批量应用">复制后每个目标班级都会得到独立计划，之后修改某个班级不会影响其他班级。</HelpTip>
          </div>
          <p className="admin-major-card__hint">生效期：{activePlan.activeFrom}{' ~ '}{activePlan.activeUntil || '长期'}</p>
        </div>

        <div className="admin-form-card">
          <h2 className="admin-form-card__title">大型考试冲突处理</h2>
          <p className="admin-major-card__hint" style={{ margin: '0 0 10px' }}>仅在运行模式为“自动”时生效：{SCOPE_LABEL[weeklyConflictPolicy.scope]}</p>
          <button className="admin-btn" style={{ width: '100%' }} onClick={() => setPolicyOpen(true)}>冲突处理设置</button>
        </div>

        <div className="admin-form-card">
          <h2 className="admin-form-card__title">例外日期</h2>
          <p className="admin-major-card__hint" style={{ margin: '0 0 10px' }}>整日排除 {activePlan.excludedDates.length} 天 · 单次调整 {activePlan.overrides.length} 条</p>
          <button className="admin-btn" style={{ width: '100%' }} onClick={() => setExceptionsOpen(true)}>例外日期管理</button>
        </div>

        <div className="admin-tips">
          <p className="admin-tips__title">💡 使用说明</p>
          <ul>
            <li>周测按星期固定重复，与具体日期无关</li>
            <li>运行模式为“自动”时，大型考试期间会按策略自动暂停周测</li>
            <li>删除计划、周测项或单次实例后可立即撤销</li>
          </ul>
        </div>
      </aside>
      <main className="admin-main">
        <div className="admin-list-header">
          <h2 className="admin-list-title">{activePlan.name} · 周测</h2>
          <span className="admin-list-count">{items.length} 项</span>
          <div className="weekly-list-actions">
            <button className="admin-btn" onClick={() => setImportOpen(true)}>导入周测 JSON</button>
            <button className="admin-btn" onClick={exportJson}>导出周测 JSON</button>
            <button className="admin-btn admin-btn--primary" onClick={() => { setEditing({ name: '', weekday: 1, startTime: '19:00', endTime: '20:00', endNextDay: false, enabled: true, weekType: 'all' }); setEditError(''); }}>+ 添加周测</button>
          </div>
        </div>

        {lastDeleted && <div className="admin-undo"><span>已删除「{lastDeleted.kind === 'plan' ? lastDeleted.plan.name : lastDeleted.kind === 'item' ? lastDeleted.item.name : lastDeleted.name}」</span><button className="admin-btn admin-btn--ghost" onClick={restoreLastDeleted}>撤销删除</button></div>}

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
                        <div className="admin-item__name-row"><span className="admin-item__name">{item.name}</span>{activePlan.weekMode === 'ab' && <span className="admin-item__status weekly-week-badge">{WEEK_TYPE_LABEL[item.weekType ?? 'all']}</span>}{!item.enabled && <span className="admin-item__status" style={{ color: '#6c757d', background: 'rgba(108,117,125,.1)' }}>已停用</span>}</div>
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
        <div className="weekly-calendar-scroll" tabIndex={0} aria-label="横向滚动查看未来两周">
          <div className="weekly-calendar" role="grid" aria-label="未来两周周测日历">
            {calendarDays.map(day => <section className={`weekly-calendar__day${day.entries.length ? ' has-events' : ''}${day.officialHoliday || day.manuallyExcluded ? ' is-holiday' : ''}`} key={day.date} role="gridcell">
              <header><strong>{WEEKDAY_LABEL[day.weekday]}{day.weekType ? ` · ${day.weekType.toUpperCase()}周` : ''}</strong><span>{day.date.slice(5)}</span></header>
              <div className="weekly-calendar__events">
                {(day.officialHoliday || day.manuallyExcluded) && <span className="weekly-calendar__holiday">{day.officialHoliday || '已排除'}</span>}
                {day.entries.length === 0 ? <span className="weekly-calendar__empty">{day.officialHoliday || day.manuallyExcluded ? '周测已暂停' : '无安排'}</span> : day.entries.map(entry => <article className={`weekly-calendar__event${entry.suppressed ? ' is-suppressed' : ''}${entry.forced ? ' is-forced' : ''}`} key={`${entry.date}-${entry.weeklyItemId}`}>
                  <button className="weekly-calendar__event-main" onClick={() => entry.suppressed ? setConflictTarget(entry) : openReschedule(entry)} title={entry.message || '点击临时调整'}>
                    <b>{entry.name}</b><span>{entry.startTime}–{entry.endTime}</span>
                  </button>
                  <button className="weekly-calendar__remove" aria-label={`取消 ${entry.name}`} title="取消本次" onClick={() => cancelOccurrence(entry)}>×</button>
                </article>)}
              </div>
            </section>)}
          </div>
        </div>
        {preview.length === 0 && <div className="admin-collapsed-hint">未来两周内暂无周测实例（可能计划已停用、不在生效期或没有启用的周测项）</div>}
      </main>

      {planModal && renderPlanModal()}
      {deletePlanOpen && (
        <div className="admin-modal-overlay" {...backdropProps(() => setDeletePlanOpen(false))}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h2 className="admin-modal__title">删除周测计划</h2>
            <p className="admin-modal__body">确定删除「{activePlan.name}」及其全部 {items.length} 条周测？删除后可在页面顶部立即撤销。</p>
            <div className="admin-modal__actions"><button className="admin-btn admin-btn--danger" onClick={removePlan}>删除</button><button className="admin-btn" onClick={() => setDeletePlanOpen(false)}>取消</button></div>
          </div>
        </div>
      )}
      {editing && (
        <div className="admin-modal-overlay" {...backdropProps(() => setEditing(null))}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h2 className="admin-modal__title">{editing.id ? '编辑周测' : '添加周测'}</h2>
            {editError && <div className="admin-error">{editError}</div>}
            <div className="admin-form">
              <label className="admin-label">名称<input className="admin-input" autoFocus value={editing.name} onChange={e => setEditing(p => p && { ...p, name: e.target.value })} placeholder="如：周测 / 晚自习测验" /></label>
              <label className="admin-label">星期<select className="admin-input" value={editing.weekday} onChange={e => setEditing(p => p && { ...p, weekday: Number(e.target.value) as IsoWeekday })}>
                {WEEKDAY_ORDER.map(wd => <option key={wd} value={wd}>{WEEKDAY_LABEL[wd]}</option>)}
              </select></label>
              {activePlan.weekMode === 'ab' && <label className="admin-label">适用周次<select className="admin-input" value={editing.weekType ?? 'all'} onChange={e => setEditing(p => p && { ...p, weekType: e.target.value as WeeklyWeekType })}><option value="all">A/B 周都进行</option><option value="a">仅 A 周</option><option value="b">仅 B 周</option></select></label>}
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
        <div className="admin-modal-overlay" {...backdropProps(() => setDeleteTarget(null))}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h2 className="admin-modal__title">确认删除</h2>
            <p className="admin-modal__body">确定删除「{deleteTarget.name}」？删除后可立即撤销。</p>
            <div className="admin-modal__actions"><button className="admin-btn admin-btn--danger" onClick={() => removeItem(deleteTarget)}>删除</button><button className="admin-btn" onClick={() => setDeleteTarget(null)}>取消</button></div>
          </div>
        </div>
      )}
      {importOpen && (
        <div className="admin-modal-overlay" {...backdropProps(() => setImportOpen(false))}>
          <div className="admin-modal admin-modal--wide" onClick={e => e.stopPropagation()}>
            <h2 className="admin-modal__title">导入周测 JSON</h2>
            <p className="admin-modal__body">旧版 items 数据会覆盖当前周测列表；新版整份计划备份会创建一个独立的新计划，并保留 A/B 周、例外和节假日设置。</p>
            {importError && <div className="admin-error">{importError}</div>}
            <textarea className="admin-textarea" rows={11} value={importText} onChange={e => setImportText(e.target.value)} placeholder='{"items":[{"name":"周测","weekday":1,"startTime":"19:00","endTime":"20:00","enabled":true}]}' />
            <div className="admin-modal__actions"><button className="admin-btn admin-btn--primary" onClick={importJson}>导入并自动保存</button><button className="admin-btn" onClick={() => { setImportOpen(false); setImportError(''); }}>取消</button></div>
          </div>
        </div>
      )}
      {policyOpen && (
        <div className="admin-modal-overlay" {...backdropProps(() => setPolicyOpen(false))}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h2 className="admin-modal__title">大型考试冲突处理</h2>
            <div className="admin-form">
              <label className="admin-toggle-label"><input type="checkbox" checked={weeklyConflictPolicy.enabled} onChange={e => onConflictPolicyChange({ ...weeklyConflictPolicy, enabled: e.target.checked }, true)} />启用冲突自动处理（仅自动模式下生效）</label>
              <label className="admin-label">暂停范围 <HelpTip title="冲突暂停范围">“时间重叠”最精细；“当天”会暂停大型考试日期内的全部周测；“整个考期”会暂停从第一科开始到最后一科结束期间的周测。</HelpTip><select className="admin-input" value={weeklyConflictPolicy.scope} onChange={e => onConflictPolicyChange({ ...weeklyConflictPolicy, scope: e.target.value as WeeklyConflictPolicy['scope'] }, true)}>
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
      {exceptionsOpen && (
        <div className="admin-modal-overlay" {...backdropProps(() => setExceptionsOpen(false))}>
          <div className="admin-modal admin-modal--wide" onClick={e => e.stopPropagation()}>
            <h2 className="admin-modal__title">例外日期管理</h2>
            <p className="admin-modal__body">整日排除的日期当天完全不生成周测；下方“单次调整”是“取消本次 / 临时调课 / 本周仍然进行”产生的记录，可在此撤销。</p>
            <label className="admin-toggle-label"><input type="checkbox" checked={activePlan.excludeOfficialHolidays === true} onChange={e => onSavePlans(weeklyPlans.map(p => p.id === activePlan.id ? { ...p, excludeOfficialHolidays: e.target.checked } : p), activePlan.id, selectedClassId, true)} />自动排除 2026 年法定节假日 <HelpTip title="法定节假日">启用后，日历预览和实际大屏都会跳过内置节假日。后续年度可通过更新节假日数据表扩展，无需修改计划。</HelpTip></label>
            {activePlan.excludeOfficialHolidays && <p className="admin-major-card__hint weekly-holiday-summary">{OFFICIAL_HOLIDAYS.map(item => `${item.name} ${item.start.slice(5)}~${item.end.slice(5)}`).join(' · ')}</p>}
            <div className="admin-form">
              <label className="admin-label">添加整日排除<input className="admin-input" type="date" value={newExcludeDate} onChange={e => setNewExcludeDate(e.target.value)} /></label>
              <button className="admin-btn admin-btn--primary" onClick={addExcludedDate}>添加排除日</button>
            </div>
            {activePlan.excludedDates.length > 0 ? (
              <ul className="admin-list" style={{ listStyle: 'none', padding: 0, margin: '10px 0' }}>
                {activePlan.excludedDates.map(date => (
                  <li className="admin-item" key={date}>
                    <div className="admin-item__info"><span className="admin-item__name">{date}</span></div>
                    <div className="admin-item__actions"><button className="admin-item-btn admin-item-btn--delete" onClick={() => removeExcludedDate(date)}>移除</button></div>
                  </li>
                ))}
              </ul>
            ) : <p className="admin-collapsed-hint">暂无整日排除</p>}
            <h2 className="admin-modal__title" style={{ marginTop: 18 }}>单次调整记录</h2>
            {activePlan.overrides.length > 0 ? (
              <ul className="admin-list" style={{ listStyle: 'none', padding: 0, margin: '10px 0' }}>
                {activePlan.overrides.map(ov => (
                  <li className="admin-item" key={ov.id}>
                    <div className="admin-item__info">
                      <span className="admin-item__name">{ov.date} · {ov.action === 'cancel' ? '取消本次' : ov.forceRunDuringMajorExam ? '强制仍然进行' : '临时调课'}{ov.name ? `（${ov.name}）` : ''}</span>
                      {ov.reason && <div className="admin-item__times" style={{ opacity: .7 }}>{ov.reason}</div>}
                    </div>
                    <div className="admin-item__actions"><button className="admin-item-btn admin-item-btn--delete" onClick={() => removeOverride(ov.id)}>撤销</button></div>
                  </li>
                ))}
              </ul>
            ) : <p className="admin-collapsed-hint">暂无单次调整</p>}
            <div className="admin-form-actions"><button className="admin-btn admin-btn--primary" onClick={() => setExceptionsOpen(false)}>完成</button></div>
          </div>
        </div>
      )}
      {copyModal && (
        <div className="admin-modal-overlay" {...backdropProps(() => setCopyModal(null))}>
          <div className="admin-modal" onClick={event => event.stopPropagation()}>
            <h2 className="admin-modal__title">批量应用周测计划</h2>
            <label className="admin-label">源计划<select className="admin-input" value={copyModal.sourcePlanId} onChange={event => setCopyModal(current => current && { ...current, sourcePlanId: event.target.value })}>{weeklyPlans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
            <div className="admin-label">应用到班级<div className="admin-major-targets">{classOptions.filter(item => item.id !== weeklyPlans.find(plan => plan.id === copyModal.sourcePlanId)?.classId).map(item => <label key={item.id}><input type="checkbox" checked={copyModal.targetClassIds.includes(item.id)} onChange={event => setCopyModal(current => current && ({ ...current, targetClassIds: event.target.checked ? [...current.targetClassIds, item.id] : current.targetClassIds.filter(id => id !== item.id) }))} />{item.label}</label>)}</div></div>
            <p className="admin-major-card__hint">每个目标班级会创建一份已启用的独立计划，之后可分别编辑。</p>
            <div className="admin-modal__actions"><button className="admin-btn admin-btn--primary" onClick={commitCopyPlan} disabled={!copyModal.targetClassIds.length}>应用到 {copyModal.targetClassIds.length} 个班级</button><button className="admin-btn" onClick={() => setCopyModal(null)}>取消</button></div>
          </div>
        </div>
      )}
      {conflictTarget && (
        <div className="admin-modal-overlay" {...backdropProps(() => setConflictTarget(null))}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h2 className="admin-modal__title">处理冲突</h2>
            <p className="admin-modal__body">「{conflictTarget.name}」与大型考试「{conflictTarget.conflict?.majorName ?? majorName}」冲突，已按策略暂停本次（{conflictTarget.date}）。</p>
            <p className="admin-major-card__hint">大型考试：{conflictTarget.conflict ? `${fmtDT(conflictTarget.conflict.majorStartTime)} – ${fmtDT(conflictTarget.conflict.majorEndTime)}` : '—'}</p>
            <p className="admin-major-card__hint">本次周测：{conflictTarget.date} {conflictTarget.startTime}–{conflictTarget.endTime}</p>
            <p className="admin-major-card__hint">暂停范围：{SCOPE_LABEL[weeklyConflictPolicy.scope]}</p>
            <div className="admin-modal__actions">
              <button className="admin-btn admin-btn--primary" onClick={forceRunOccurrence}>本周仍然进行</button>
              <button className="admin-btn" onClick={keepSuppressed}>保持暂停</button>
            </div>
          </div>
        </div>
      )}
      {rescheduleTarget && (
        <div className="admin-modal-overlay" {...backdropProps(() => setRescheduleTarget(null))}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h2 className="admin-modal__title">临时调课（仅此一次）</h2>
            {rescheduleError && <div className="admin-error">{rescheduleError}</div>}
            <div className="admin-form">
              <label className="admin-label">名称<input className="admin-input" value={rescheduleTarget.name} onChange={e => setRescheduleTarget(p => p && { ...p, name: e.target.value })} /></label>
              <label className="admin-label">日期<input className="admin-input" type="date" value={rescheduleTarget.date} readOnly aria-readonly="true" /></label>
              <label className="admin-label">开始时间<input className="admin-input" type="time" value={rescheduleTarget.startTime} onChange={e => setRescheduleTarget(p => p && { ...p, startTime: e.target.value })} /></label>
              <label className="admin-label">结束时间<input className="admin-input" type="time" value={rescheduleTarget.endTime} onChange={e => setRescheduleTarget(p => p && { ...p, endTime: e.target.value })} /></label>
              <p className="admin-major-card__hint">仅调整这一次实例，不影响周期规则本身。</p>
              <div className="admin-form-actions"><button className="admin-btn admin-btn--primary" onClick={commitReschedule}>确认并保存</button><button className="admin-btn admin-btn--ghost" onClick={() => { setRescheduleTarget(null); setRescheduleError(''); }}>取消</button></div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
