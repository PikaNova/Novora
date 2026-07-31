import { useState } from "react";
import type { IsoWeekday } from "../../types/exam";

export type WeeklyImportStep = "paste" | "preview" | "targets";

export interface WeeklyImportSummary {
  itemCount: number;
  planName?: string;
  items: Array<{
    name: string;
    weekday: IsoWeekday;
    startTime: string;
    endTime: string;
    warning?: string;
  }>;
  warnings: string[];
}

/** Owns the import workflow state. Parsing and persistence stay in WeeklyPanel. */
export function useWeeklyImport() {
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [importClassIds, setImportClassIds] = useState<string[]>([]);
  const [importStep, setImportStep] = useState<WeeklyImportStep>("paste");
  const [importSummary, setImportSummary] =
    useState<WeeklyImportSummary | null>(null);
  const [importExcludedIndexes, setImportExcludedIndexes] = useState<number[]>([]);

  return {
    importOpen,
    setImportOpen,
    importText,
    setImportText,
    importError,
    setImportError,
    importClassIds,
    setImportClassIds,
    importStep,
    setImportStep,
    importSummary,
    setImportSummary,
    importExcludedIndexes,
    setImportExcludedIndexes,
  };
}
