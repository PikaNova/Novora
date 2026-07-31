import { useEffect, useState } from "react";

export interface WeeklyCopyModal {
  sourcePlanId: string;
  targetClassIds: string[];
  name: string;
}

/** Owns copy, batch-delete, and print workflow state. */
export function useWeeklyBatchOps() {
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
  }, [copyModal !== null]);

  useEffect(() => {
    if (batchDeleteOpen) setBatchDeleteStep(0);
  }, [batchDeleteOpen]);

  useEffect(() => {
    if (printPickerOpen) setPrintPickerStep(0);
  }, [printPickerOpen]);

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
  };
}
