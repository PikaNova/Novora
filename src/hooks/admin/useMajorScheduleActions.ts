import { useCallback, useEffect, useState } from "react";
import type { MutableRefObject } from "react";
import type { NavigateFunction } from "react-router-dom";
import type { AlertsSettings, ExamItem, MajorExam } from "../../types";
import type { SchoolClass, SchoolGrade } from "../../types/school";
import { isTrackSubject, normalizeSubjectName } from "../../data/subjects";
import { subjectAppliesToClass } from "../../types/school";
import type { InitializationState } from "../../utils/settings/school";
import {
  getAppSettings,
  updateExamSettings,
  updateAlertsSettings,
  genMajorId,
} from "../../utils/appSettings";
import {
  getCloudSnapshot,
  saveExamsToServer,
  type AdminUserContext,
} from "../../services/examService";
import { threeWayMergeExam } from "../../utils/examMerge";
import {
  clearPendingExamSync,
  getPendingExamSync,
  queuePendingExamSync,
} from "../../services/examOutbox";
import { recordSyncConflict } from "../../services/offlineStore";
import { notify } from "../../services/notify";
import { formatApiError } from "../../services/apiError";
import { normalizeExamItems } from "../../utils/examSchedule";
import type { QuickMajorPublishInput } from "../../components/QuickMajorPublishModal";
import type { WeeklyState } from "./useWeeklyScheduleSync";
import type { SyncState } from "./adminPageUtils";
import { makeId, syncMajorStateRef, toLocalInput } from "./adminPageUtils";

export type MajorModal = {
  mode: "add" | "rename";
  name: string;
  targetGradeIds: string[];
  next?: "import";
} | null;

const retryBackoffDelay = (attempt: number) =>
  new Promise((resolve) =>
    setTimeout(resolve, Math.min(4000, 400 * 2 ** attempt)),
  );

// Owns the major-exam domain: the exam roster itself (`majors`), which one is
// active/being edited, the selected grade/class scope, all major-exam modal
// state, and the shared save/push pipeline used by both major exams and (via
// indirection refs) alerts and weekly settings. This is the biggest and most
// central domain hook -- most other admin hooks read from it.
export function useMajorScheduleActions(params: {
  adminUser: AdminUserContext | null;
  initialMajors: MajorExam[];
  initialActiveMajorId: string;
  initialSelectedGradeId: string;
  initialSelectedClassId: string;
  classes: SchoolClass[];
  visibleGrades: SchoolGrade[];
  visibleClasses: SchoolClass[];
  visibleClassIds: Set<string>;
  hasAllScope: boolean;
  alertsRef: MutableRefObject<AlertsSettings>;
  setAlerts: (alerts: AlertsSettings) => void;
  weeklyStateRef: MutableRefObject<WeeklyState>;
  initializationRef: MutableRefObject<InitializationState>;
  navigate: NavigateFunction;
  pendingRef: MutableRefObject<boolean>;
  examPushChainRef: MutableRefObject<Promise<void>>;
  saveTimer: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  stateRef: MutableRefObject<{ majors: MajorExam[]; activeMajorId: string }>;
  setSync: (state: SyncState) => void;
  editingRef: MutableRefObject<{ name: string } | null>;
  setEditingRef: MutableRefObject<(value: unknown) => void>;
}) {
  const {
    adminUser,
    initialMajors,
    initialActiveMajorId,
    initialSelectedGradeId,
    initialSelectedClassId,
    classes,
    visibleGrades,
    visibleClasses,
    visibleClassIds,
    hasAllScope,
    alertsRef,
    setAlerts,
    weeklyStateRef,
    initializationRef,
    navigate,
    pendingRef,
    examPushChainRef,
    saveTimer,
    stateRef,
    setSync,
    editingRef,
    setEditingRef,
  } = params;

  const [majors, setMajors] = useState<MajorExam[]>(initialMajors);
  const [activeMajorId, setActiveMajorId] = useState<string>(
    initialActiveMajorId,
  );
  const [editingMajorId, setEditingMajorId] = useState<string>(
    initialActiveMajorId,
  );
  const [editingMajorIdByGrade, setEditingMajorIdByGrade] = useState<
    Record<string, string>
  >({});
  const [selectedGradeId, setSelectedGradeId] = useState<string>(
    initialSelectedGradeId,
  );
  const [selectedClassId, setSelectedClassId] = useState<string>(
    initialSelectedClassId,
  );

  const [majorModal, setMajorModal] = useState<MajorModal>(null);
  const [majorModalStep, setMajorModalStep] = useState(0);
  const [majorError, setMajorError] = useState("");
  const [deleteMajorOpen, setDeleteMajorOpen] = useState(false);
  const [quickMajorDeleteTarget, setQuickMajorDeleteTarget] =
    useState<MajorExam | null>(null);
  const [majorPrintOpen, setMajorPrintOpen] = useState(false);
  const [quickMajorOpen, setQuickMajorOpen] = useState(false);
  const [majorBatchAddOpen, setMajorBatchAddOpen] = useState(false);

  useEffect(() => {
    if (majorModal) setMajorModalStep(0);
  }, [majorModal !== null]);

  useEffect(() => {
    if (!adminUser || !visibleGrades.length) return;
    if (!visibleGrades.some((grade) => grade.id === selectedGradeId)) {
      const gradeId = visibleGrades[0].id;
      const classId =
        adminUser.roleId === "class_admin"
          ? (visibleClasses.find((item) => item.gradeId === gradeId)?.id ?? "")
          : "";
      setSelectedGradeId(gradeId);
      setSelectedClassId(classId);
      updateExamSettings({ selectedGradeId: gradeId, selectedClassId: classId });
      return;
    }
    if (
      (selectedClassId &&
        !visibleClasses.some(
          (item) => item.id === selectedClassId && item.gradeId === selectedGradeId,
        )) ||
      (!selectedClassId && adminUser.roleId === "class_admin")
    ) {
      const classId =
        adminUser.roleId === "class_admin"
          ? (visibleClasses.find((item) => item.gradeId === selectedGradeId)?.id ?? "")
          : "";
      setSelectedClassId(classId);
      updateExamSettings({ selectedGradeId, selectedClassId: classId });
    }
  }, [adminUser, selectedGradeId, selectedClassId, visibleGrades, visibleClasses]);

  const visibleMajors = majors.filter((major) => {
    if (hasAllScope) return true;
    const gradeMatch =
      !major.targetGradeIds?.length ||
      major.targetGradeIds.some((id) =>
        visibleGrades.some((grade) => grade.id === id),
      );
    const classMatch =
      !major.targetClassIds?.length ||
      major.targetClassIds.some((id) => visibleClassIds.has(id));
    return gradeMatch && classMatch;
  });

  const majorAppliesToGrade = (major: MajorExam, gradeId: string) => {
    if (!gradeId) return false;
    if (major.targetGradeIds?.length) return major.targetGradeIds.includes(gradeId);
    if (major.targetClassIds?.length) {
      return major.targetClassIds.some((classId) =>
        classes.some((item) => item.id === classId && item.gradeId === gradeId),
      );
    }
    return true;
  };

  const scopedMajors = selectedGradeId
    ? visibleMajors.filter((major) => majorAppliesToGrade(major, selectedGradeId))
    : [];
  const orderedScopedMajors = [...scopedMajors].sort((a, b) => {
    const aSpecific = a.targetGradeIds?.includes(selectedGradeId) ? 0 : 1;
    const bSpecific = b.targetGradeIds?.includes(selectedGradeId) ? 0 : 1;
    if (aSpecific !== bSpecific) return aSpecific - bSpecific;
    const now = Date.now();
    const score = (major: MajorExam) => {
      const enabled = major.items.filter((item) => item.enabled);
      const start = Math.min(
        ...enabled.map((item) => new Date(item.startTime).getTime()),
      );
      const end = Math.max(
        ...enabled.map((item) => new Date(item.endTime).getTime()),
      );
      if (Number.isFinite(start) && now >= start && now <= end) return 0;
      if (Number.isFinite(start) && start > now) return 1;
      return 2;
    };
    const phaseDiff = score(a) - score(b);
    if (phaseDiff) return phaseDiff;
    const aStart = Math.min(
      ...a.items
        .map((item) => new Date(item.startTime).getTime())
        .filter(Number.isFinite),
    );
    const bStart = Math.min(
      ...b.items
        .map((item) => new Date(item.startTime).getTime())
        .filter(Number.isFinite),
    );
    return (
      (Number.isFinite(aStart) ? aStart : Number.MAX_SAFE_INTEGER) -
        (Number.isFinite(bStart) ? bStart : Number.MAX_SAFE_INTEGER) ||
      a.order - b.order
    );
  });
  const hasScopedMajor = orderedScopedMajors.length > 0;
  const activeMajor: MajorExam =
    orderedScopedMajors.find((m) => m.id === editingMajorId) ??
    orderedScopedMajors[0] ?? {
      id: "",
      name: "当前年级暂无大型考试",
      items: [],
      order: -1,
      targetGradeIds: selectedGradeId ? [selectedGradeId] : [],
    };
  const items = activeMajor?.items ?? [];
  const subjectTrackModeEnabled =
    initializationRef.current.subjectTrackModeEnabled !== false;
  const classesInMajorScope = (major: MajorExam) =>
    visibleClasses.filter((item) => {
      if (!item.enabled) return false;
      if (major.targetClassIds?.length) return major.targetClassIds.includes(item.id);
      if (major.targetGradeIds?.length) return major.targetGradeIds.includes(item.gradeId);
      return true;
    });
  const autoTrackClassIdsForMajorItem = (major: MajorExam, subject: string) => {
    const normalized = normalizeSubjectName(subject);
    if (!subjectTrackModeEnabled) return undefined;
    if (!isTrackSubject(normalized)) return undefined;
    const ids = classesInMajorScope(major)
      .filter((item) => subjectAppliesToClass(normalized, item))
      .map((item) => item.id);
    return ids.length ? ids : ["__no_matching_track_class__"];
  };
  const activeMajorTrackSubjects = items.filter((item) => isTrackSubject(item.name));
  const activeMajorTrackScopedCount = activeMajorTrackSubjects.filter(
    (item) => item.targetClassIds?.length,
  ).length;
  const activeMajorUnsetTrackClassCount = classesInMajorScope(activeMajor).filter(
    (item) => !item.track?.length,
  ).length;

  const changeSelectedGrade = (gradeId: string) => {
    if (gradeId === selectedGradeId) return;
    if (editingRef.current) {
      const subject = editingRef.current.name.trim() || "未命名分考试";
      notify(
        "warning",
        `“${subject}”仍在编辑中，请先确认并保存，或取消本次编辑后再切换年级。`,
        "请先保存分考试",
      );
      return;
    }
    if (gradeId && !visibleGrades.some((grade) => grade.id === gradeId)) return;
    setSelectedGradeId(gradeId);
    setSelectedClassId("");
    const candidates = visibleMajors.filter((major) =>
      majorAppliesToGrade(major, gradeId),
    );
    const remembered = editingMajorIdByGrade[gradeId];
    const nextMajor =
      candidates.find((major) => major.id === remembered) ??
      candidates.find((major) => major.targetGradeIds?.includes(gradeId)) ??
      candidates[0];
    if (nextMajor) setEditingMajorId(nextMajor.id);
    updateExamSettings({ selectedGradeId: gradeId, selectedClassId: "" });
  };
  const changeSelectedClass = (classId: string) => {
    if (
      classId &&
      !visibleClasses.some(
        (item) => item.id === classId && item.gradeId === selectedGradeId,
      )
    )
      return;
    setSelectedClassId(classId);
    updateExamSettings({ selectedGradeId, selectedClassId: classId });
  };

  const buildPayload = (ms: MajorExam[], activeId: string) => {
    const active = ms.find((m) => m.id === activeId) ?? ms[0];
    return {
      items: active?.items ?? [],
      title: active?.name ?? "",
      majors: ms,
      activeMajorId: activeId,
      alerts: alertsRef.current,
      ...weeklyStateRef.current,
      initialization: initializationRef.current,
    };
  };

  const pushToServerExec = useCallback(
    async (ms: MajorExam[], activeId: string, syncLabel = "保存考试安排") => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        pendingRef.current = true;
        setSync("offline");
        return;
      }
      setSync("saving");
      const queued = getPendingExamSync();
      const payload = queued?.payload ?? buildPayload(ms, activeId);
      const baseSnapshot = getCloudSnapshot();
      const baseUpdatedAt = Math.max(
        queued?.baseSnapshot?.updatedAt ?? 0,
        baseSnapshot?.updatedAt ?? 0,
      );
      let expectedSavedAt = queued?.savedAt;
      const isStalePush = () =>
        expectedSavedAt != null &&
        getPendingExamSync()?.savedAt !== expectedSavedAt;
      const MAX_ATTEMPTS = 3;
      let currentPayload: typeof payload = payload;
      let currentBaseUpdatedAt = baseUpdatedAt;
      let currentBaseline = baseSnapshot;
      let totalConflicts = 0;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const result = await saveExamsToServer({
          ...currentPayload,
          baseUpdatedAt: currentBaseUpdatedAt,
          clientQueueKey: "admin-exam-save",
          clientSyncLabel:
            attempt === 0 ? syncLabel : `${syncLabel} · 合并后重试(${attempt})`,
        } as never);
        if (isStalePush()) return;
        if (result === "unauthorized") {
          navigate("/login?next=/admin", { replace: true });
          return;
        }
        if (result && typeof result === "object" && result.kind === "conflict") {
          if (!result.remote) {
            pendingRef.current = true;
            setSync("error");
            notify(
              "error",
              "云端冲突数据不完整，本机修改已保留；请刷新后台后再保存。",
              "同步失败",
              { id: "admin-exam-sync-error" },
            );
            return;
          }
          const local = { ...currentPayload, updatedAt: currentBaseUpdatedAt };
          const merged = threeWayMergeExam(
            (currentBaseline ?? result.remote) as never,
            local as never,
            result.remote as never,
          );
          if (merged.conflictCount)
            void recordSyncConflict(merged.conflictCount, local, result.remote);
          const { alerts: mergedAlerts, ...mergedExam } = merged.payload as typeof payload & {
            alerts?: AlertsSettings;
          };
          const normalizedMergedExam = {
            ...mergedExam,
            weeklyConflictPolicy:
              (mergedExam as { weeklyConflictPolicy?: unknown }).weeklyConflictPolicy ??
              weeklyStateRef.current.weeklyConflictPolicy,
          };
          if (isStalePush()) return;
          const mergedQueuedAt = Date.now();
          queuePendingExamSync({
            payload: merged.payload,
            baseSnapshot: result.remote,
            savedAt: mergedQueuedAt,
          });
          expectedSavedAt = mergedQueuedAt;
          const mergedMajors = (merged.payload as { majors: MajorExam[] }).majors;
          const mergedActiveMajorId =
            (merged.payload as { activeMajorId: string }).activeMajorId;
          syncMajorStateRef(stateRef, mergedMajors, mergedActiveMajorId);
          setMajors(mergedMajors);
          setActiveMajorId(mergedActiveMajorId);
          updateExamSettings({
            ...normalizedMergedExam,
            updatedAt: result.remote.updatedAt,
          } as never);
          if (mergedAlerts) {
            updateAlertsSettings({
              ...mergedAlerts,
              updatedAt: result.remote.updatedAt,
            } as never);
            setAlerts(getAppSettings().alerts);
          }
          totalConflicts += merged.conflictCount;
          currentPayload = merged.payload as typeof payload;
          currentBaseUpdatedAt = result.remote.updatedAt;
          currentBaseline = result.remote;
          if (attempt < MAX_ATTEMPTS - 1) {
            await retryBackoffDelay(attempt);
            continue;
          }
          pendingRef.current = true;
          setSync(
            typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error",
          );
          notify(
            "error",
            "云端数据变化较频繁，自动合并已重试多次仍未成功，结果已保留在本机，请稍后重新保存。",
            "同步失败",
            { id: "admin-exam-sync-error" },
          );
          return;
        }
        if (typeof result !== "number") {
          pendingRef.current = true;
          setSync(
            typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error",
          );
          if (result && result.kind === "error")
            notify(
              "error",
              formatApiError(result.error, "保存考试数据失败"),
              result.error.code.startsWith("DATABASE_") ? "数据库连接失败" : "同步失败",
              { id: "admin-exam-sync-error" },
            );
          return;
        }
        pendingRef.current = false;
        clearPendingExamSync(expectedSavedAt);
        const { alerts: pAlerts, ...examPayload } = currentPayload as typeof payload & {
          alerts?: AlertsSettings;
        };
        updateExamSettings({
          ...examPayload,
          weeklyConflictPolicy:
            (examPayload as { weeklyConflictPolicy?: unknown }).weeklyConflictPolicy ??
            weeklyStateRef.current.weeklyConflictPolicy,
          updatedAt: result,
        } as never);
        if (pAlerts) updateAlertsSettings({ ...pAlerts, updatedAt: result } as never);
        setSync("saved");
        if (totalConflicts)
          notify(
            "warning",
            `已合并本机与云端修改；${totalConflicts} 个同字段冲突保留本机值。`,
            "数据冲突已处理",
          );
        return;
      }
    },
    [navigate],
  );

  const pushToServer = useCallback(
    (ms: MajorExam[], activeId: string, syncLabel = "保存考试安排") => {
      const run = examPushChainRef.current.then(() =>
        pushToServerExec(ms, activeId, syncLabel),
      );
      examPushChainRef.current = run.catch(() => {});
      return run;
    },
    [pushToServerExec],
  );

  const commit = useCallback(
    (ms: MajorExam[], activeId: string, immediate = false, syncLabel = "保存考试安排") => {
      syncMajorStateRef(stateRef, ms, activeId);
      setMajors(ms);
      setActiveMajorId(activeId);
      const now = Date.now();
      const { alerts: pAlerts, ...examPayload } = buildPayload(ms, activeId);
      updateExamSettings({ ...examPayload, updatedAt: now } as never);
      if (pAlerts) updateAlertsSettings({ ...pAlerts, updatedAt: now } as never);
      queuePendingExamSync({
        payload: { ...examPayload, alerts: pAlerts ?? null },
        baseSnapshot: getCloudSnapshot(),
        savedAt: now,
      });
      pendingRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (immediate) {
        void pushToServer(ms, activeId, syncLabel);
        return;
      }
      setSync(
        typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "saving",
      );
      saveTimer.current = setTimeout(() => {
        void pushToServer(ms, activeId, syncLabel);
      }, 650);
    },
    [pushToServer],
  );

  const commitItems = useCallback(
    (nextItems: ExamItem[], syncLabel = "保存考试安排") => {
      const ms = stateRef.current.majors.map((m) =>
        m.id === editingMajorId ? { ...m, items: nextItems } : m,
      );
      commit(ms, stateRef.current.activeMajorId, false, syncLabel);
    },
    [commit, editingMajorId],
  );
  const commitBatchMajorItems = (nextItems: ExamItem[]) => {
    commitItems(normalizeExamItems(nextItems), "批量更新分考试");
    setMajorBatchAddOpen(false);
  };

  const switchMajor = (id: string) => {
    if (id === editingMajorId) return;
    setEditingRef.current(null);
    setEditingMajorId(id);
    if (selectedGradeId)
      setEditingMajorIdByGrade((value) => ({ ...value, [selectedGradeId]: id }));
  };
  const commitMajorModal = (onContinueToImport: () => void) => {
    if (!majorModal) return;
    const name = majorModal.name.trim();
    if (!name) {
      setMajorError("请输入大型考试名称");
      return;
    }
    const continueToImport = majorModal.mode === "add" && majorModal.next === "import";
    if (majorModal.mode === "add") {
      const nm: MajorExam = {
        id: genMajorId(),
        name,
        items: [],
        order: majors.length,
        targetGradeIds: majorModal.targetGradeIds,
      };
      const ms = [...majors, nm];
      setEditingMajorId(nm.id);
      if (selectedGradeId)
        setEditingMajorIdByGrade((value) => ({ ...value, [selectedGradeId]: nm.id }));
      commit(ms, nm.id, true, `新增大型考试「${name}」`);
    } else {
      const ms = majors.map((m) =>
        m.id === activeMajor.id
          ? { ...m, name, targetGradeIds: majorModal.targetGradeIds }
          : m,
      );
      commit(ms, activeMajorId, true, `更新大型考试「${name}」`);
    }
    setMajorModal(null);
    setMajorError("");
    if (continueToImport) onContinueToImport();
  };
  const removeMajor = () => {
    if (majors.length <= 1) return;
    const removedId = activeMajor.id;
    const ms = majors
      .filter((m) => m.id !== removedId)
      .map((m, i) => ({ ...m, order: i }));
    const nextActiveId = removedId === activeMajorId ? ms[0].id : activeMajorId;
    const nextEditing =
      ms.find((major) => majorAppliesToGrade(major, selectedGradeId)) ?? ms[0];
    setEditingMajorId(nextEditing.id);
    setEditingMajorIdByGrade((value) => {
      const next = { ...value };
      for (const gradeId of Object.keys(next))
        if (next[gradeId] === removedId) delete next[gradeId];
      if (selectedGradeId) next[selectedGradeId] = nextEditing.id;
      return next;
    });
    commit(ms, nextActiveId, true, `删除大型考试「${activeMajor.name}」`);
    setDeleteMajorOpen(false);
  };
  const removeQuickMajor = (major: MajorExam) => {
    const ms = majors
      .filter((item) => item.id !== major.id)
      .map((item, index) => ({ ...item, order: index }));
    const nextActiveId = activeMajorId === major.id ? ms[0]?.id ?? "" : activeMajorId;
    const nextEditing = ms.find((item) => majorAppliesToGrade(item, selectedGradeId)) ?? ms[0];
    setEditingMajorId(nextEditing?.id ?? "");
    setEditingMajorIdByGrade((value) => {
      const next = { ...value };
      for (const gradeId of Object.keys(next)) {
        if (next[gradeId] === major.id) delete next[gradeId];
      }
      if (selectedGradeId && nextEditing) next[selectedGradeId] = nextEditing.id;
      return next;
    });
    commit(ms, nextActiveId, true, `删除临时考试「${major.name}」`);
    setQuickMajorDeleteTarget(null);
  };
  const publishQuickMajor = (input: QuickMajorPublishInput) => {
    const start = new Date(input.startTime).getTime();
    if (!Number.isFinite(start)) {
      notify("error", "开始时间无效，请重新设置。", "无法发布");
      return;
    }
    const now = Date.now();
    const quick: MajorExam = {
      id: genMajorId(),
      name: input.name,
      items: [
        {
          id: makeId(),
          name: normalizeSubjectName(input.subject),
          startTime: input.startTime,
          endTime: toLocalInput(start + input.durationMinutes * 60_000),
          enabled: true,
          order: 0,
        },
      ],
      order: majors.length,
      targetGradeIds: input.targetGradeIds,
      targetClassIds: input.targetClassIds,
      source: "quick",
      temporary: true,
      priorityOverSchedule: input.priorityOverSchedule,
      createdAt: now,
      createdBy: adminUser?.id,
      endedAt: null,
    };
    const next = [...majors, quick];
    setEditingMajorId(quick.id);
    if (selectedGradeId && input.targetGradeIds.includes(selectedGradeId))
      setEditingMajorIdByGrade((value) => ({ ...value, [selectedGradeId]: quick.id }));
    commit(next, quick.id, true, `快速发布「${quick.name}」`);
    setQuickMajorOpen(false);
    notify("success", `已下发「${quick.name}」，看板将在下一次同步时收到安排。`, "统一考试已发布");
  };
  const updateQuickMajor = (id: string, patch: Partial<MajorExam>, successMessage: string) => {
    const next = majors.map((major) => (major.id === id ? { ...major, ...patch } : major));
    commit(next, activeMajorId, true, successMessage);
    notify("success", successMessage, "临时统一考试已更新");
  };
  const extendQuickMajor = (major: MajorExam) =>
    updateQuickMajor(
      major.id,
      {
        items: major.items.map((item) => ({
          ...item,
          endTime: toLocalInput(new Date(item.endTime).getTime() + 5 * 60_000),
        })),
      },
      `「${major.name}」已延长 5 分钟。`,
    );
  const endQuickMajor = (major: MajorExam) =>
    updateQuickMajor(
      major.id,
      {
        endedAt: Date.now(),
        items: major.items.map((item) => ({ ...item, enabled: false })),
      },
      `「${major.name}」已提前结束。`,
    );
  const promoteQuickMajor = (major: MajorExam) =>
    updateQuickMajor(
      major.id,
      { source: "regular", temporary: false, priorityOverSchedule: false },
      `「${major.name}」已转存为正式大型考试。`,
    );

  return {
    majors,
    setMajors,
    activeMajorId,
    setActiveMajorId,
    editingMajorId,
    setEditingMajorId,
    editingMajorIdByGrade,
    setEditingMajorIdByGrade,
    selectedGradeId,
    setSelectedGradeId,
    selectedClassId,
    setSelectedClassId,
    majorModal,
    setMajorModal,
    majorModalStep,
    setMajorModalStep,
    majorError,
    setMajorError,
    deleteMajorOpen,
    setDeleteMajorOpen,
    quickMajorDeleteTarget,
    setQuickMajorDeleteTarget,
    majorPrintOpen,
    setMajorPrintOpen,
    quickMajorOpen,
    setQuickMajorOpen,
    majorBatchAddOpen,
    setMajorBatchAddOpen,
    visibleMajors,
    majorAppliesToGrade,
    scopedMajors,
    orderedScopedMajors,
    hasScopedMajor,
    activeMajor,
    items,
    subjectTrackModeEnabled,
    classesInMajorScope,
    autoTrackClassIdsForMajorItem,
    activeMajorTrackSubjects,
    activeMajorTrackScopedCount,
    activeMajorUnsetTrackClassCount,
    changeSelectedGrade,
    changeSelectedClass,
    buildPayload,
    pushToServerExec,
    pushToServer,
    commit,
    commitItems,
    commitBatchMajorItems,
    switchMajor,
    commitMajorModal,
    removeMajor,
    removeQuickMajor,
    publishQuickMajor,
    updateQuickMajor,
    extendQuickMajor,
    endQuickMajor,
    promoteQuickMajor,
  };
}
