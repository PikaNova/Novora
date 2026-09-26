import { useEffect, useState } from 'react';
import type { ExamItem, MajorExam } from '../../types';
import { normalizeSubjectName } from '../../data/subjects';
import { normalizeExamItems } from '../../utils/examSchedule';
import { confirmDialog } from '../../services/appDialog';
import { notify } from '../../services/notify';
import { nowMs } from '../../utils/timeSource';
import { makeId, toISO, toLocalInput } from './adminPageUtils';

export type EditItem = {
  id?: string;
  name: string;
  startTime: string;
  endTime: string;
  enabled: boolean;
};

// Owns the single-exam-item editor (add/edit form, overlap + long-duration
// confirmation, start-time-flow wizard) plus item deletion/undo/multi-select,
// all scoped to whichever major exam is currently active.
export function useExamItemActions(params: {
  items: ExamItem[];
  activeMajor: MajorExam;
  commitItems: (nextItems: ExamItem[], syncLabel?: string) => void;
  editingMajorId: string;
  autoTrackClassIdsForMajorItem: (major: MajorExam, subject: string) => string[] | undefined;
}) {
  const { items, activeMajor, commitItems, editingMajorId, autoTrackClassIdsForMajorItem } = params;

  const [editing, setEditing] = useState<EditItem | null>(null);
  const [customSubjectActive, setCustomSubjectActive] = useState(false);
  const [majorTimeFlowOpen, setMajorTimeFlowOpen] = useState(false);
  const [majorTimeFlowInitialStart, setMajorTimeFlowInitialStart] = useState('');
  const [majorTimeFlowInitialEnd, setMajorTimeFlowInitialEnd] = useState('');
  const [editError, setEditError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ExamItem | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);
  const [lastDeletedExam, setLastDeletedExam] = useState<{
    item: ExamItem;
    index: number;
  } | null>(null);
  const [collapsedList, setCollapsedList] = useState(false);
  const [longDurationConfirmed, setLongDurationConfirmed] = useState(false);

  const openMajorStartTimeFlow = () => {
    if (!editing) return;
    const startTime = editing.startTime || toISO(toLocalInput(nowMs()));
    const start = new Date(startTime).getTime();
    const currentEnd = new Date(editing.endTime).getTime();
    const endTime =
      Number.isFinite(currentEnd) && currentEnd > start ? editing.endTime : toISO(toLocalInput(start + 60 * 60_000));
    setMajorTimeFlowInitialStart(editing.startTime);
    setMajorTimeFlowInitialEnd(editing.endTime);
    setEditing((value) => (value ? { ...value, startTime, endTime } : value));
    setMajorTimeFlowOpen(true);
  };

  const cancelMajorTimeFlow = () => {
    setEditing((value) =>
      value
        ? {
            ...value,
            startTime: majorTimeFlowInitialStart,
            endTime: majorTimeFlowInitialEnd,
          }
        : value,
    );
    setMajorTimeFlowOpen(false);
  };

  /**
   * 保存一个科目（新增或修改）。编辑器表单与「新建考试」向导共用这一处实现，
   * 校验（重叠确认、>6 小时跨天确认、科目名归一化、选科联动）不会两边漂移。
   */
  const saveItem = async (
    draft: EditItem,
    options?: { longDurationConfirmed?: boolean },
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (!draft.name.trim()) return { ok: false, error: '请输入考试名称' };
    if (!draft.startTime || !draft.endTime) return { ok: false, error: '请输入开始与结束时间' };
    if (new Date(draft.startTime) >= new Date(draft.endTime)) return { ok: false, error: '结束时间必须晚于开始时间' };
    const overlaps = items.some(
      (x) =>
        x.id !== draft.id &&
        x.enabled &&
        draft.enabled &&
        new Date(draft.startTime) < new Date(x.endTime) &&
        new Date(draft.endTime) > new Date(x.startTime),
    );
    if (
      overlaps &&
      !(await confirmDialog({
        title: '考试时间重叠',
        message: '此科目与已启用科目时间重叠，仍要保存吗？',
        tone: 'warning',
        confirmLabel: '仍然保存',
      }))
    )
      return { ok: false, error: '' };
    if (
      new Date(draft.endTime).getTime() - new Date(draft.startTime).getTime() > 6 * 60 * 60 * 1000 &&
      !options?.longDurationConfirmed
    ) {
      return { ok: false, error: '本场时长超过 6 小时，请确认这是跨天或特殊安排。' };
    }
    const normalizedName = normalizeSubjectName(draft.name.trim());
    const targetClassIds = autoTrackClassIdsForMajorItem(activeMajor, normalizedName);
    let next: ExamItem[];
    if (draft.id)
      next = items.map((x) =>
        x.id === draft.id ? { ...x, ...draft, name: normalizedName, targetClassIds, id: x.id, order: x.order } : x,
      );
    else
      next = [
        ...items,
        {
          id: makeId(),
          order: items.length ? Math.max(...items.map((x) => x.order)) + 1 : 0,
          name: normalizedName,
          startTime: toISO(draft.startTime),
          endTime: toISO(draft.endTime),
          enabled: draft.enabled,
          targetClassIds,
        },
      ];
    commitItems(normalizeExamItems(next), draft.id ? `编辑「${normalizedName}」` : `新增「${normalizedName}」`);
    return { ok: true };
  };

  const commitEdit = async () => {
    if (!editing) return;
    const result = await saveItem(editing, { longDurationConfirmed });
    if (!result.ok) {
      if (result.error) setEditError(result.error);
      return;
    }
    setEditing(null);
    setEditError('');
    setLongDurationConfirmed(false);
  };

  const setExamEnabled = (id: string, enabled: boolean) =>
    commitItems(
      items.map((x) => (x.id === id ? { ...x, enabled } : x)),
      `${enabled ? '启用' : '停用'}「${items.find((x) => x.id === id)?.name ?? '分考试'}」`,
    );
  const remove = (item: ExamItem) => {
    const index = items.findIndex((x) => x.id === item.id);
    setLastDeletedExam({ item, index });
    commitItems(
      items.filter((x) => x.id !== item.id),
      `删除「${item.name}」`,
    );
    setDeleteTarget(null);
  };
  const removeItems = (ids: string[]) => {
    const removing = new Set(ids);
    if (removing.size === 0) return;
    const removedNames = items.filter((item) => removing.has(item.id)).map((item) => item.name);
    commitItems(
      items.filter((item) => !removing.has(item.id)),
      `批量删除 ${removing.size} 项分考试（${removedNames.slice(0, 5).join('、')}${
        removedNames.length > 5 ? '等' : ''
      }）`,
    );
    setSelectedItemIds(new Set());
    setDeleteSelectedOpen(false);
    notify('success', `已删除 ${removing.size} 项分考试。`);
  };
  useEffect(() => {
    setSelectedItemIds(new Set());
  }, [editingMajorId]);
  const restoreExam = () => {
    if (!lastDeletedExam) return;
    const next = [...items];
    next.splice(Math.min(lastDeletedExam.index, next.length), 0, lastDeletedExam.item);
    commitItems(next, `撤销删除「${lastDeletedExam.item.name}」`);
    setLastDeletedExam(null);
  };

  return {
    editing,
    setEditing,
    customSubjectActive,
    setCustomSubjectActive,
    majorTimeFlowOpen,
    setMajorTimeFlowOpen,
    setMajorTimeFlowInitialStart,
    setMajorTimeFlowInitialEnd,
    editError,
    setEditError,
    deleteTarget,
    setDeleteTarget,
    selectedItemIds,
    setSelectedItemIds,
    deleteSelectedOpen,
    setDeleteSelectedOpen,
    lastDeletedExam,
    setLastDeletedExam,
    collapsedList,
    setCollapsedList,
    longDurationConfirmed,
    setLongDurationConfirmed,
    openMajorStartTimeFlow,
    cancelMajorTimeFlow,
    commitEdit,
    saveItem,
    setExamEnabled,
    remove,
    removeItems,
    restoreExam,
  };
}
