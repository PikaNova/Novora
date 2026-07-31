import { useState } from "react";
import type {
  IsoWeekday,
  WeeklyExamItem,
  WeeklyPlan,
  WeeklyWeekType,
} from "../../types/exam";
import {
  genWeeklyItemId,
  genWeeklyOverrideId,
  genWeeklyPlanId,
  normalizeWeeklyPlan,
} from "../../utils/weeklySchedule";
import { HM_RE, padHM, sortWeeklyItems } from "../../utils/settings/weekly";
import { notify } from "../../services/notify";
import type { ClassPickerOption } from "../../components/ClassMultiPicker";

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

interface UseWeeklyImportArgs {
  weeklyPlans: WeeklyPlan[];
  activePlan: WeeklyPlan | null;
  items: WeeklyExamItem[];
  selectedClassId: string;
  pickerOptions: ClassPickerOption[];
  activeWeeklyPlanIdByClassId: Record<string, string | null>;
  onSavePlans: (
    plans: WeeklyPlan[],
    activeId: string | null,
    classId: string,
    immediate?: boolean,
    activeByClass?: Record<string, string | null>,
  ) => void;
}

/** \u5bfc\u5165\u5de5\u4f5c\u6d41\u7684\u72b6\u6001\u4e0e\u5904\u7406\u51fd\u6570\u3002\u4ece WeeklyPanel.tsx \u8fc1\u5165\uff0c\u4fdd\u6301\u4e0e\u539f\u6709\u903b\u8f91\u5b8c\u5168\u4e00\u81f4\u3002 */
export function useWeeklyImport({
  weeklyPlans,
  activePlan,
  items,
  selectedClassId,
  pickerOptions,
  activeWeeklyPlanIdByClassId,
  onSavePlans,
}: UseWeeklyImportArgs) {
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [importClassIds, setImportClassIds] = useState<string[]>([]);
  const [importStep, setImportStep] = useState<WeeklyImportStep>("paste");
  const [importSummary, setImportSummary] = useState<WeeklyImportSummary | null>(null);
  const [importExcludedIndexes, setImportExcludedIndexes] = useState<number[]>([]);

  const openImport = () => {
    setImportText("");
    setImportError("");
    setImportSummary(null);
    setImportStep("paste");
    setImportClassIds(selectedClassId ? [selectedClassId] : []);
    setImportOpen(true);
  };

  const closeImport = (clearText = false) => {
    setImportOpen(false);
    setImportError("");
    setImportClassIds([]);
    setImportStep("paste");
    setImportSummary(null);
    setImportExcludedIndexes([]);
    if (clearText) setImportText("");
  };

  const validateImportJson = () => {
    setImportError("");
    try {
      const source = JSON.parse(importText);
      const importedPlan =
        source?.plan && typeof source.plan === "object" ? source.plan : source;
      const list = Array.isArray(importedPlan)
        ? importedPlan
        : importedPlan?.items;
      if (!Array.isArray(list)) {
        throw new Error("JSON \u5fc5\u987b\u662f\u5468\u6d4b\u6570\u7ec4\uff0c\u6216\u5305\u542b items \u6570\u7ec4");
      }
      const invalidIndex = list.findIndex((raw: unknown) => {
        const item = raw as Record<string, unknown>;
        return (
          !item?.name ||
          !HM_RE.test(String(item.startTime ?? "")) ||
          !HM_RE.test(String(item.endTime ?? ""))
        );
      });
      if (invalidIndex >= 0) {
        throw new Error(
          `\u7b2c ${invalidIndex + 1} \u9879\u9700\u8981\u6709\u6548\u7684 name\u3001startTime \u548c endTime`,
        );
      }
      const previewItems = list.map((raw: unknown) => {
        const item = raw as Record<string, unknown>;
        const weekday = ([1, 2, 3, 4, 5, 6, 7] as number[]).includes(item.weekday as number)
          ? (item.weekday as IsoWeekday)
          : 1;
        const startTime = padHM(String(item.startTime));
        const endTime = padHM(String(item.endTime));
        return {
          name: String(item.name),
          weekday,
          startTime,
          endTime,
          warning: !item.endNextDay && endTime <= startTime ? "\u7ed3\u675f\u65f6\u95f4\u4e0d\u665a\u4e8e\u5f00\u59cb\u65f6\u95f4" : undefined,
        };
      });
      const warnings = previewItems.flatMap((item, index) => item.warning ? [`\u7b2c ${index + 1} \u9879\uff1a${item.warning}`] : []);
      setImportSummary({
        itemCount: list.length,
        planName:
          typeof importedPlan?.name === "string"
            ? importedPlan.name
            : undefined,
        items: previewItems,
        warnings,
      });
      setImportExcludedIndexes([]);
      setImportStep("preview");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "JSON \u683c\u5f0f\u9519\u8bef");
    }
  };

  const importJson = () => {
    if (!activePlan) return;
    setImportError("");
    try {
      const source = JSON.parse(importText);
      const targets = importClassIds.length
        ? importClassIds
        : [selectedClassId];
      if (!targets.length) throw new Error("\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u4e2a\u76ee\u6807\u73ed\u7ea7");
      if (source?.plan && typeof source.plan === "object") {
        const imported = normalizeWeeklyPlan(source.plan, weeklyPlans.length);
        const includedItems = imported.items.filter((_, index) => !importExcludedIndexes.includes(index));
        const importedPlans = targets.map((classId, offset) => {
          const target = pickerOptions.find((item) => item.id === classId)!;
          const idMap = new Map(
            includedItems.map((item) => [item.id, genWeeklyItemId()]),
          );
          return {
            ...imported,
            id: genWeeklyPlanId(),
            name: `${target.className} \u00b7 ${imported.name.replace(/\uff08\u5bfc\u5165\uff09$/u, "")}`,
            gradeId: target.gradeId,
            classId,
            order: weeklyPlans.length + offset,
            items: includedItems.map((item, index) => ({
              ...item,
              id: idMap.get(item.id)!,
              order: index,
            })),
            overrides: imported.overrides
              .filter((item) => idMap.has(item.sourceItemId))
              .map((item) => ({
                ...item,
                id: genWeeklyOverrideId(
                  idMap.get(item.sourceItemId)!,
                  item.date,
                ),
                sourceItemId: idMap.get(item.sourceItemId)!,
              })),
          };
        });
        const nextActive = {
          ...activeWeeklyPlanIdByClassId,
          ...Object.fromEntries(
            importedPlans.map((plan) => [plan.classId, plan.id]),
          ),
        };
        onSavePlans(
          [...weeklyPlans, ...importedPlans],
          importedPlans[0].id,
          importedPlans[0].classId,
          true,
          nextActive,
        );
        closeImport(true);
        notify("success", `\u5df2\u5411 ${importedPlans.length} \u4e2a\u73ed\u7ea7\u5bfc\u5165\u72ec\u7acb\u8ba1\u5212\u3002`);
        return;
      }
      const list = Array.isArray(source) ? source : source.items;
      if (!Array.isArray(list))
        throw new Error("JSON \u5fc5\u987b\u662f\u5468\u6d4b\u6570\u7ec4\uff0c\u6216\u5305\u542b items \u6570\u7ec4");
      const nextItems: WeeklyExamItem[] = list.filter((_: unknown, index: number) => !importExcludedIndexes.includes(index)).map(
        (raw: unknown, index: number) => {
          const row = raw as Record<string, unknown>;
          const weekday = ([1, 2, 3, 4, 5, 6, 7] as number[]).includes(
            row.weekday as number,
          )
            ? (row.weekday as IsoWeekday)
            : 1;
          if (!row.name || !row.startTime || !row.endTime)
            throw new Error(
              `\u7b2c ${index + 1} \u9879\u7f3a\u5c11 name\u3001startTime \u6216 endTime`,
            );
          return {
            id: String(row.id ?? genWeeklyItemId()),
            name: String(row.name),
            weekday,
            startTime: padHM(String(row.startTime)),
            endTime: padHM(String(row.endTime)),
            endNextDay: !!row.endNextDay,
            enabled: row.enabled !== false,
            order: typeof row.order === "number" ? row.order : index,
            location:
              typeof row.location === "string" ? row.location : undefined,
            note: typeof row.note === "string" ? row.note : undefined,
            weekType: (["all", "a", "b"] as WeeklyWeekType[]).includes(
              row.weekType as WeeklyWeekType,
            )
              ? (row.weekType as WeeklyWeekType)
              : "all",
          };
        },
      );
      const targetPlanIds = new Set(
        targets
          .map(
            (classId) =>
              activeWeeklyPlanIdByClassId[classId] ??
              weeklyPlans.find((plan) => plan.classId === classId)?.id,
          )
          .filter(Boolean),
      );
      if (targetPlanIds.size !== targets.length)
        throw new Error("\u90e8\u5206\u76ee\u6807\u73ed\u7ea7\u5c1a\u65e0\u5468\u6d4b\u8ba1\u5212\uff0c\u8bf7\u5148\u6279\u91cf\u65b0\u5efa\u8ba1\u5212");
      const plans = weeklyPlans.map((plan) =>
        targetPlanIds.has(plan.id)
          ? {
              ...plan,
              items: sortWeeklyItems(
                nextItems.map((item, index) => ({
                  ...item,
                  id: genWeeklyItemId(),
                  order: index,
                })),
              ),
            }
          : plan,
      );
      onSavePlans(plans, activePlan.id, selectedClassId, true);
      closeImport(true);
      notify("success", `\u5df2\u5411 ${targets.length} \u4e2a\u73ed\u7ea7\u5bfc\u5165\u5468\u6d4b\u9879\u76ee\u3002`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "JSON \u683c\u5f0f\u9519\u8bef");
    }
  };

  const exportJson = () => {
    if (!activePlan) return;
    const file = new Blob(
      [
        JSON.stringify(
          {
            schemaVersion: 1,
            plan: activePlan,
            items,
            exportedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      ],
      { type: "application/json;charset=utf-8" },
    );
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activePlan.name || "weekly"}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

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
    openImport,
    closeImport,
    validateImportJson,
    importJson,
    exportJson,
  };
}
