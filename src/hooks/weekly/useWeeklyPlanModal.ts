/**
 * useWeeklyPlanModal
 * 周测计划的增删改（新建/设置/删除/启停/切换）状态与处理函数。
 * 从 WeeklyPanel.tsx 中提取，保持与原有逻辑完全一致。
 */
import { useEffect, useState } from 'react';
import type { WeeklyPlan, WeeklyWeekMode } from '../../types/exam';
import { createEmptyWeeklyPlan, getShanghaiDateKey } from '../../utils/weeklySchedule';
import { notify } from '../../services/notify';
import type { ClassPickerOption } from '../../components/ClassMultiPicker';
import { DATE_RE, planTitleForClass } from '../../utils/settings/weekly';

export type PlanModal = {
  mode: 'add' | 'settings';
  name: string;
  gradeId: string;
  classIds: string[];
  activeFrom: string;
  activeUntil: string;
  anchorDate: string;
  forever: boolean;
  repeatEveryWeeks: number;
  weekMode: WeeklyWeekMode;
  excludeOfficialHolidays: boolean;
} | null;

export type LastDeleted =
  | { kind: 'plan'; plan: WeeklyPlan; index: number }
  | {
      kind: 'plans';
      plans: Array<{ plan: WeeklyPlan; index: number }>;
      activeByClass: Record<string, string | null>;
    }
  | { kind: 'item'; item: import('../../types/exam').WeeklyExamItem; index: number; planId: string }
  | { kind: 'occurrence'; overrideId: string; name: string }
  | null;

interface UsePlanModalArgs {
  weeklyPlans: WeeklyPlan[];
  activeWeeklyPlanIdByClassId: Record<string, string | null>;
  selectedGradeId: string;
  selectedClassId: string;
  selectedClassName: string;
  pickerOptions: ClassPickerOption[];
  activePlan: WeeklyPlan | null;
  onSavePlans: (
    plans: WeeklyPlan[],
    activeId: string | null,
    classId: string,
    immediate?: boolean,
    activeByClass?: Record<string, string | null>,
  ) => void;
  onSelectScope?: (gradeId: string, classId: string) => void;
  setLastDeleted: React.Dispatch<React.SetStateAction<LastDeleted>>;
}

export function useWeeklyPlanModal({
  weeklyPlans,
  activeWeeklyPlanIdByClassId,
  selectedGradeId,
  selectedClassId,
  selectedClassName,
  pickerOptions,
  activePlan,
  onSavePlans,
  onSelectScope,
  setLastDeleted,
}: UsePlanModalArgs) {
  const [planModal, setPlanModal] = useState<PlanModal>(null);
  const [planWizardStep, setPlanWizardStep] = useState(0);
  const [planError, setPlanError] = useState('');
  const [deletePlanOpen, setDeletePlanOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);

  useEffect(() => {
    if (planModal) setPlanWizardStep(0);
    // Only reset the wizard step when the modal mode changes, not when its fields change.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- modal field identity intentionally excluded
  }, [planModal?.mode]);

  const openNewPlan = () => {
    const today = getShanghaiDateKey(Date.now());
    setPlanModal({
      mode: 'add',
      name: selectedClassName && selectedClassId ? planTitleForClass(selectedClassName) : '',
      gradeId: selectedGradeId,
      classIds: selectedClassId ? [selectedClassId] : [],
      activeFrom: today,
      activeUntil: '',
      anchorDate: today,
      forever: true,
      repeatEveryWeeks: 1,
      weekMode: 'single',
      excludeOfficialHolidays: false,
    });
    setPlanError('');
  };

  const openPlanSettings = () => {
    if (!activePlan) return;
    const today = getShanghaiDateKey(Date.now());
    setPlanModal({
      mode: 'settings',
      name: activePlan.name,
      gradeId: activePlan.gradeId,
      classIds: [activePlan.classId],
      activeFrom: activePlan.activeFrom || today,
      activeUntil: activePlan.activeUntil || '',
      anchorDate: activePlan.anchorDate || today,
      forever: !activePlan.activeUntil,
      repeatEveryWeeks: activePlan.repeatEveryWeeks ?? 1,
      weekMode: activePlan.weekMode ?? 'single',
      excludeOfficialHolidays: activePlan.excludeOfficialHolidays === true,
    });
    setPlanError('');
  };

  const commitPlanModal = () => {
    if (!planModal) return;
    const name = planModal.name.trim();
    if (planModal.mode === 'settings' && !name) {
      setPlanError('请输入计划名称');
      return;
    }
    if (!planModal.gradeId || !planModal.classIds.length) {
      setPlanError('请至少选择一个适用班级');
      return;
    }
    if (!DATE_RE.test(planModal.activeFrom)) {
      setPlanError('请填写生效日期');
      return;
    }
    if (!DATE_RE.test(planModal.anchorDate)) {
      setPlanError('请填写学期开始日期');
      return;
    }
    if (!planModal.forever && planModal.activeUntil && planModal.activeUntil < planModal.activeFrom) {
      setPlanError('结束日期不得早于生效日期');
      return;
    }
    const repeat = Math.min(8, Math.max(1, Math.round(planModal.repeatEveryWeeks) || 1));
    if (planModal.mode === 'add') {
      const created = planModal.classIds.map((classId, offset) => {
        const target = pickerOptions.find((item) => item.id === classId)!;
        const planName = planTitleForClass(target?.className);
        return {
          ...createEmptyWeeklyPlan(Date.now() + offset, planName),
          gradeId: target.gradeId,
          classId,
          activeFrom: planModal.activeFrom,
          activeUntil: planModal.forever ? null : planModal.activeUntil || null,
          anchorDate: planModal.anchorDate,
          repeatEveryWeeks: repeat,
          weekMode: planModal.weekMode,
          excludeOfficialHolidays: planModal.excludeOfficialHolidays,
          order: weeklyPlans.length + offset,
        };
      });
      const activeByClass = {
        ...activeWeeklyPlanIdByClassId,
        ...Object.fromEntries(created.map((plan) => [plan.classId, plan.id])),
      };
      onSavePlans([...weeklyPlans, ...created], created[0].id, created[0].classId, true, activeByClass);
      onSelectScope?.(created[0].gradeId, created[0].classId);
      notify('success', created.length > 1 ? `已为 ${created.length} 个班级创建独立周测计划。` : '周测计划已创建。');
    } else {
      if (!activePlan) return;
      const plans = weeklyPlans.map((p) =>
        p.id === activePlan.id
          ? {
              ...p,
              name,
              activeFrom: planModal.activeFrom,
              activeUntil: planModal.forever ? null : planModal.activeUntil || null,
              anchorDate: planModal.anchorDate,
              repeatEveryWeeks: repeat,
              weekMode: planModal.weekMode,
              excludeOfficialHolidays: planModal.excludeOfficialHolidays,
            }
          : p,
      );
      onSavePlans(plans, activePlan.id, selectedClassId, true);
    }
    setPlanModal(null);
    setPlanError('');
  };

  const removePlan = () => {
    if (!activePlan) return;
    const index = weeklyPlans.findIndex((p) => p.id === activePlan.id);
    const rest = weeklyPlans.filter((p) => p.id !== activePlan.id).map((p, i) => ({ ...p, order: i }));
    const nextId = rest.find((p) => p.classId === selectedClassId)?.id ?? null;
    setLastDeleted({ kind: 'plan', plan: activePlan, index });
    onSavePlans(rest, nextId, selectedClassId, true);
    setDeletePlanOpen(false);
  };

  const togglePlanEnabled = () => {
    if (!activePlan) return;
    const plans = weeklyPlans.map((p) => (p.id === activePlan.id ? { ...p, enabled: !p.enabled } : p));
    onSavePlans(plans, activePlan.id, selectedClassId, true);
  };

  const switchPlan = (id: string) => {
    if (!activePlan || id === activePlan.id) return;
    onSavePlans(weeklyPlans, id, selectedClassId, true);
  };

  return {
    planModal,
    setPlanModal,
    planWizardStep,
    setPlanWizardStep,
    planError,
    setPlanError,
    deletePlanOpen,
    setDeletePlanOpen,
    policyOpen,
    setPolicyOpen,
    openNewPlan,
    openPlanSettings,
    commitPlanModal,
    removePlan,
    togglePlanEnabled,
    switchPlan,
  };
}
