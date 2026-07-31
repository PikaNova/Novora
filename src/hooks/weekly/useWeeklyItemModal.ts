/**
 * useWeeklyItemModal
 * 周测项目（WeeklyExamItem）的增删改状态与处理函数。
 */
import { useState, useEffect } from 'react';
import type { WeeklyPlan, WeeklyExamItem } from '../../types/exam';
import {
  genWeeklyItemId,
} from '../../utils/weeklySchedule';

const HM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

function padHM(v: string) {
  const [h = '0', m = '0'] = v.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

function sortWeeklyItems(list: WeeklyExamItem[]): WeeklyExamItem[] {
  return [...list]
    .sort(
      (a, b) =>
        a.weekday - b.weekday ||
        a.startTime.localeCompare(b.startTime) ||
        a.endTime.localeCompare(b.endTime) ||
        a.name.localeCompare(b.name, 'zh-CN'),
    )
    .map((item, order) => ({ ...item, order }));
}

export type ItemEdit = Omit<WeeklyExamItem, 'id' | 'order'> & { id?: string };

interface UseItemModalArgs {
  weeklyPlans: WeeklyPlan[];
  activePlan: WeeklyPlan | null;
  selectedClassId: string;
  items: WeeklyExamItem[];
  onSavePlans: (
    plans: WeeklyPlan[],
    activeId: string | null,
    classId: string,
    immediate?: boolean,
  ) => void;
  setLastDeleted: React.Dispatch<React.SetStateAction<import('./useWeeklyPlanModal').LastDeleted>>;
}

export function useWeeklyItemModal({
  weeklyPlans,
  activePlan,
  selectedClassId,
  items,
  onSavePlans,
  setLastDeleted,
}: UseItemModalArgs) {
  const [editing, setEditing] = useState<ItemEdit | null>(null);
  const [itemWizardStep, setItemWizardStep] = useState(0);
  const [customWeeklySubjectActive, setCustomWeeklySubjectActive] = useState(false);
  const [editError, setEditError] = useState('');
  const [weeklyTimeFlowOpen, setWeeklyTimeFlowOpen] = useState(false);
  const [weeklyTimeFlowInitialStart, setWeeklyTimeFlowInitialStart] = useState('');
  const [weeklyTimeFlowInitialEnd, setWeeklyTimeFlowInitialEnd] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<WeeklyExamItem | null>(null);

  useEffect(() => {
    if (editing) setItemWizardStep(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing !== null]);

  const openWeeklyTimeFlow = () => {
    if (!editing) return;
    setWeeklyTimeFlowInitialStart(editing.startTime);
    setWeeklyTimeFlowInitialEnd(editing.endTime);
    setWeeklyTimeFlowOpen(true);
  };

  const cancelWeeklyTimeFlow = () => {
    setEditing((item) =>
      item
        ? { ...item, startTime: weeklyTimeFlowInitialStart, endTime: weeklyTimeFlowInitialEnd }
        : item,
    );
    setWeeklyTimeFlowOpen(false);
  };

  const commitItemModal = () => {
    if (!editing || !activePlan) return;
    const name = editing.name.trim();
    if (!name) { setEditError('请输入周测名称'); return; }
    if (!HM_RE.test(editing.startTime) || !HM_RE.test(editing.endTime)) {
      setEditError('请输入正确的时间（HH:mm）');
      return;
    }
    const start = padHM(editing.startTime);
    const end = padHM(editing.endTime);
    if (!editing.endNextDay && end <= start) {
      setEditError('结束时间必须晚于开始时间；跨日安排请在"时间设置"中勾选启用跨日考试。');
      return;
    }
    let nextItems: WeeklyExamItem[];
    if (editing.id) {
      nextItems = items.map((x) =>
        x.id === editing.id
          ? { ...x, ...editing, startTime: start, endTime: end, id: x.id, order: x.order }
          : x,
      );
    } else {
      nextItems = [
        ...items,
        {
          id: genWeeklyItemId(),
          order: items.length ? Math.max(...items.map((x) => x.order)) + 1 : 0,
          name,
          weekday: editing.weekday,
          startTime: start,
          endTime: end,
          endNextDay: editing.endNextDay,
          enabled: editing.enabled,
          location: editing.location,
          note: editing.note,
          weekType: editing.weekType ?? 'all',
        },
      ];
    }
    nextItems = sortWeeklyItems(nextItems);
    const plans = weeklyPlans.map((p) =>
      p.id === activePlan.id ? { ...p, items: nextItems } : p,
    );
    onSavePlans(plans, activePlan.id, selectedClassId, true);
    setEditing(null);
    setEditError('');
  };

  const removeItem = (item: WeeklyExamItem) => {
    if (!activePlan) return;
    const index = items.findIndex((x) => x.id === item.id);
    const nextItems = items.filter((x) => x.id !== item.id);
    const plans = weeklyPlans.map((p) =>
      p.id === activePlan.id ? { ...p, items: nextItems } : p,
    );
    onSavePlans(plans, activePlan.id, selectedClassId, true);
    setLastDeleted({ kind: 'item', item, index, planId: activePlan.id });
    setDeleteTarget(null);
  };

  const toggleItemEnabled = (item: WeeklyExamItem) => {
    if (!activePlan) return;
    const nextItems = items.map((x) =>
      x.id === item.id ? { ...x, enabled: !x.enabled } : x,
    );
    const plans = weeklyPlans.map((p) =>
      p.id === activePlan.id ? { ...p, items: nextItems } : p,
    );
    onSavePlans(plans, activePlan.id, selectedClassId, true);
  };

  return {
    editing,
    setEditing,
    itemWizardStep,
    setItemWizardStep,
    customWeeklySubjectActive,
    setCustomWeeklySubjectActive,
    editError,
    setEditError,
    weeklyTimeFlowOpen,
    setWeeklyTimeFlowOpen,
    deleteTarget,
    setDeleteTarget,
    openWeeklyTimeFlow,
    cancelWeeklyTimeFlow,
    commitItemModal,
    removeItem,
    toggleItemEnabled,
  };
}
