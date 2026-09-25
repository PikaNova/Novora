import { useEffect, useState } from 'react';
import type { WeeklyPlan } from '../../types/exam';
import { genWeeklyItemId, genWeeklyOverrideId, genWeeklyPlanId } from '../../utils/weeklySchedule';
import { confirmDialog } from '../../services/appDialog';
import { notify } from '../../services/notify';
import type { LastDeleted } from './useWeeklyPlanModal';
import { buildCopiedPlanTitle } from '../../components/weekly/weeklyShared';

export interface WeeklyCopyModal {
  sourcePlanId: string;
  targetClassIds: string[];
  name: string;
  suffix: string;
}

type ClassOption = { id: string; gradeId: string; label: string };

/** \u53d6\u6807\u7b7e\u6700\u540e\u4e00\u6bb5\uff08\u53bb\u9664\u5e74\u7ea7/\u73ed\u7ea7\u524d\u7f00\uff09\uff0c\u7528\u4e8e\u62fc\u63a5\u590d\u5236\u540e\u7684\u8ba1\u5212\u540d\u79f0\u3002 */
export function lastLabelSegment(label: string): string {
  const parts = label.split(' \u00b7 ');
  return parts[parts.length - 1] || label;
}

interface UseWeeklyBatchOpsArgs {
  weeklyPlans: WeeklyPlan[];
  classOptions: ClassOption[];
  activeWeeklyPlanIdByClassId: Record<string, string | null>;
  activePlan: WeeklyPlan | null;
  selectedClassId: string;
  onSavePlans: (
    plans: WeeklyPlan[],
    activeId: string | null,
    classId: string,
    immediate?: boolean,
    activeByClass?: Record<string, string | null>,
  ) => void;
  setLastDeleted: React.Dispatch<React.SetStateAction<LastDeleted>>;
}

/** \u590d\u5236\u8ba1\u5212\u3001\u6279\u91cf\u5220\u9664\u3001\u6253\u5370\u5de5\u4f5c\u6d41\u7684\u72b6\u6001\u4e0e\u5904\u7406\u51fd\u6570\u3002\u4ece WeeklyPanel.tsx \u8fc1\u5165\uff0c\u4fdd\u6301\u4e0e\u539f\u6709\u903b\u8f91\u5b8c\u5168\u4e00\u81f4\u3002 */
export function useWeeklyBatchOps({
  weeklyPlans,
  classOptions,
  activeWeeklyPlanIdByClassId,
  activePlan,
  selectedClassId,
  onSavePlans,
  setLastDeleted,
}: UseWeeklyBatchOpsArgs) {
  const [copyModal, setCopyModal] = useState<WeeklyCopyModal | null>(null);
  const [copyWizardStep, setCopyWizardStep] = useState(0);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchDeleteStep, setBatchDeleteStep] = useState(0);
  const [batchDeletePlanIds, setBatchDeletePlanIds] = useState<string[]>([]);
  const [printOpen, setPrintOpen] = useState(false);
  const [printPickerOpen, setPrintPickerOpen] = useState(false);
  const [printPickerStep, setPrintPickerStep] = useState(0);
  const [printClassIds, setPrintClassIds] = useState<string[]>([]);

  useEffect(() => {
    if (copyModal) setCopyWizardStep(0);
    // Only reset the wizard step when the modal opens or closes, not when its fields change.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- modal content identity intentionally excluded
  }, [copyModal !== null]);

  useEffect(() => {
    if (batchDeleteOpen) setBatchDeleteStep(0);
  }, [batchDeleteOpen]);

  useEffect(() => {
    if (printPickerOpen) setPrintPickerStep(0);
  }, [printPickerOpen]);

  const commitCopyPlan = () => {
    if (!activePlan) return;
    if (!copyModal?.targetClassIds.length) return;
    const source = weeklyPlans.find((plan) => plan.id === copyModal.sourcePlanId);
    if (!source) return;
    const copyName = copyModal.name.trim() || source.name.replace(/\uff08\u590d\u5236\uff09$/u, '');
    const copies = copyModal.targetClassIds.map((classId, offset) => {
      const target = classOptions.find((item) => item.id === classId)!;
      const idMap = new Map(source.items.map((item) => [item.id, genWeeklyItemId()]));
      const sourceClass = classOptions.find((item) => item.id === source.classId);
      const sourceClassName = sourceClass ? lastLabelSegment(sourceClass.label) : '';
      const targetClassName = lastLabelSegment(target.label);
      const targetName = buildCopiedPlanTitle(copyName, sourceClassName, targetClassName, copyModal.suffix);
      return {
        ...source,
        id: genWeeklyPlanId(),
        gradeId: target.gradeId,
        classId,
        name: targetName,
        enabled: true,
        order: weeklyPlans.length + offset,
        items: source.items.map((item, index) => ({
          ...item,
          id: idMap.get(item.id)!,
          order: index,
        })),
        overrides: source.overrides
          .filter((item) => idMap.has(item.sourceItemId))
          .map((item) => ({
            ...item,
            sourceItemId: idMap.get(item.sourceItemId)!,
            id: genWeeklyOverrideId(idMap.get(item.sourceItemId)!, item.date),
          })),
      };
    });
    const nextActiveByClass = {
      ...activeWeeklyPlanIdByClassId,
      ...Object.fromEntries(copies.map((plan) => [plan.classId, plan.id])),
    };
    onSavePlans([...weeklyPlans, ...copies], activePlan.id, selectedClassId, true, nextActiveByClass);
    notify(
      'success',
      `\u8ba1\u5212\u5df2\u5e94\u7528\u5230 ${copies.length} \u4e2a\u73ed\u7ea7\uff0c\u5e76\u8bbe\u4e3a\u5404\u73ed\u5f53\u524d\u542f\u7528\u8ba1\u5212\u3002`,
    );
    setCopyModal(null);
  };

  const removeSelectedPlans = async () => {
    if (!batchDeletePlanIds.length) return;
    const selected = new Set(batchDeletePlanIds);
    const removed = weeklyPlans.flatMap((plan, index) => (selected.has(plan.id) ? [{ plan, index }] : []));
    if (!removed.length) return;
    if (
      !(await confirmDialog({
        title: `\u5220\u9664 ${removed.length} \u4e2a\u5468\u6d4b\u8ba1\u5212`,
        message:
          '\u6240\u9009\u8ba1\u5212\u53ca\u5176\u4e2d\u7684\u5168\u90e8\u5468\u6d4b\u3001\u4f8b\u5916\u65e5\u671f\u548c\u4e34\u65f6\u8c03\u6574\u90fd\u4f1a\u5220\u9664\u3002\u6b64\u64cd\u4f5c\u53ef\u5728\u9875\u9762\u9876\u90e8\u6574\u6279\u64a4\u9500\u3002',
        tone: 'danger',
        confirmLabel: '\u6279\u91cf\u5220\u9664',
      }))
    )
      return;
    const remaining = weeklyPlans.filter((plan) => !selected.has(plan.id)).map((plan, order) => ({ ...plan, order }));
    const nextActiveByClass = { ...activeWeeklyPlanIdByClassId };
    for (const classId of new Set(removed.map((item) => item.plan.classId))) {
      if (selected.has(nextActiveByClass[classId] ?? ''))
        nextActiveByClass[classId] = remaining.find((plan) => plan.classId === classId)?.id ?? null;
    }
    setLastDeleted({
      kind: 'plans',
      plans: removed,
      activeByClass: { ...activeWeeklyPlanIdByClassId },
    });
    onSavePlans(remaining, nextActiveByClass[selectedClassId] ?? null, selectedClassId, true, nextActiveByClass);
    setBatchDeleteOpen(false);
    setBatchDeletePlanIds([]);
    notify('success', `\u5df2\u5220\u9664 ${removed.length} \u4e2a\u5468\u6d4b\u8ba1\u5212\u3002`);
  };

  return {
    copyModal,
    setCopyModal,
    copyWizardStep,
    setCopyWizardStep,
    batchDeleteOpen,
    setBatchDeleteOpen,
    batchDeleteStep,
    setBatchDeleteStep,
    batchDeletePlanIds,
    setBatchDeletePlanIds,
    printOpen,
    setPrintOpen,
    printPickerOpen,
    setPrintPickerOpen,
    printPickerStep,
    setPrintPickerStep,
    printClassIds,
    setPrintClassIds,
    commitCopyPlan,
    removeSelectedPlans,
  };
}
