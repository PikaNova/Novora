import { useState } from "react";

export interface WeeklyRescheduleTarget<TConflict> {
  occ: TConflict;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
}

/** Owns exception and reschedule UI state. Mutation logic stays in WeeklyPanel. */
export function useWeeklyExceptions<TConflict>() {
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  const [newExcludeDate, setNewExcludeDate] = useState("");
  const [conflictTarget, setConflictTarget] = useState<TConflict | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<
    WeeklyRescheduleTarget<TConflict> | null
  >(null);
  const [rescheduleError, setRescheduleError] = useState("");
  const [rescheduleTimeOpen, setRescheduleTimeOpen] = useState(false);

  return {
    exceptionsOpen,
    setExceptionsOpen,
    newExcludeDate,
    setNewExcludeDate,
    conflictTarget,
    setConflictTarget,
    rescheduleTarget,
    setRescheduleTarget,
    rescheduleError,
    setRescheduleError,
    rescheduleTimeOpen,
    setRescheduleTimeOpen,
  };
}
