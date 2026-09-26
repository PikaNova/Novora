import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { AlertsSettings, ExamItem, MajorExam } from '../../types';
import type { SchoolClass, SchoolGrade } from '../../types/school';
import { isTrackSubject, normalizeSubjectName } from '../../data/subjects';
import { classesInMajorScope as sharedClassesInMajorScope, computeAutoTrackClassIds } from '../../utils/trackClassIds';
import { majorAppliesToGrade as sharedMajorAppliesToGrade } from '../../utils/examRecordEditTarget';
import type { InitializationState } from '../../utils/settings/school';
import {
  getAppSettings,
  updateExamSettings,
  updateAlertsSettings,
  genMajorId,
  normalizeConflictPolicy,
} from '../../utils/appSettings';
import {
  applyFrozenArchivedMajors,
  getCloudSnapshot,
  saveExamsToServer,
  takeFrozenArchivedMajors,
  type AdminUserContext,
} from '../../services/examService';
import type { ExamSavePayload } from '../../shared/examContracts';
import { threeWayMergeExam } from '../../utils/examMerge';
import { clearPendingExamSync, getPendingExamSync, queuePendingExamSync } from '../../services/examOutbox';
import { recordSyncConflict } from '../../services/offlineStore';
import { notify } from '../../services/notify';
import { formatApiError } from '../../services/apiError';
import { normalizeExamItems } from '../../utils/examSchedule';
import { nowMs } from '../../utils/timeSource';
import type { QuickMajorPublishInput } from '../../components/QuickMajorPublishModal';
import type { WeeklyState } from './useWeeklyScheduleSync';
import type { SyncState } from './adminPageUtils';
import { makeId, shouldResetWizardStepOnOpen, syncMajorStateRef, toLocalInput } from './adminPageUtils';

export type MajorModal = {
  mode: 'add' | 'rename';
  name: string;
  targetGradeIds: string[];
  next?: 'import';
} | null;

const retryBackoffDelay = (attempt: number) =>
  new Promise((resolve) => setTimeout(resolve, Math.min(4000, 400 * 2 ** attempt)));

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
  const [activeMajorId, setActiveMajorId] = useState<string>(initialActiveMajorId);
  const [editingMajorId, setEditingMajorId] = useState<string>(initialActiveMajorId);
  const [editingMajorIdByGrade, setEditingMajorIdByGrade] = useState<Record<string, string>>({});
  const [selectedGradeId, setSelectedGradeId] = useState<string>(initialSelectedGradeId);
  const [selectedClassId, setSelectedClassId] = useState<string>(initialSelectedClassId);

  const [majorModal, setMajorModal] = useState<MajorModal>(null);
  const [majorModalStep, setMajorModalStep] = useState(0);
  const [majorError, setMajorError] = useState('');
  const [deleteMajorOpen, setDeleteMajorOpen] = useState(false);
  const [quickMajorDeleteTarget, setQuickMajorDeleteTarget] = useState<MajorExam | null>(null);
  const [majorPrintOpen, setMajorPrintOpen] = useState(false);
  const [quickMajorOpen, setQuickMajorOpen] = useState(false);
  const [majorBatchAddOpen, setMajorBatchAddOpen] = useState(false);

  // 只在弹窗「刚打开」时回到第一步：以前的依赖是整个 majorModal 对象，
  // 于是弹窗内任何一次 setMajorModal（改名称、改范围、向导中途写草稿）都会把步骤打回 0。
  const majorModalOpenRef = useRef(false);
  /**
   * 恢复路径（草稿提示条「下一步」）自己会把步骤设成确认步，这里给它一个「保留步骤」的开关：
   * 否则上面那条「刚打开就回到第一步」会把它压回 0，用户点「下一步」永远落在「考试名称」。
   */
  const keepStepOnNextOpenRef = useRef(false);
  const keepWizardStepOnNextOpen = useCallback(() => {
    keepStepOnNextOpenRef.current = true;
  }, []);
  useEffect(() => {
    const open = Boolean(majorModal);
    if (
      shouldResetWizardStepOnOpen({
        opened: open,
        wasOpen: majorModalOpenRef.current,
        keepStep: keepStepOnNextOpenRef.current,
      })
    ) {
      setMajorModalStep(0);
    }
    keepStepOnNextOpenRef.current = false;
    majorModalOpenRef.current = open;
  }, [majorModal]);

  useEffect(() => {
    if (!adminUser || !visibleGrades.length) return;
    if (!visibleGrades.some((grade) => grade.id === selectedGradeId)) {
      const gradeId = visibleGrades[0].id;
      const classId =
        adminUser.roleId === 'class_admin' ? (visibleClasses.find((item) => item.gradeId === gradeId)?.id ?? '') : '';
      setSelectedGradeId(gradeId);
      setSelectedClassId(classId);
      updateExamSettings({ selectedGradeId: gradeId, selectedClassId: classId });
      return;
    }
    if (
      (selectedClassId &&
        !visibleClasses.some((item) => item.id === selectedClassId && item.gradeId === selectedGradeId)) ||
      (!selectedClassId && adminUser.roleId === 'class_admin')
    ) {
      const classId =
        adminUser.roleId === 'class_admin'
          ? (visibleClasses.find((item) => item.gradeId === selectedGradeId)?.id ?? '')
          : '';
      setSelectedClassId(classId);
      updateExamSettings({ selectedGradeId, selectedClassId: classId });
    }
  }, [adminUser, selectedGradeId, selectedClassId, visibleGrades, visibleClasses]);

  const visibleMajors = majors.filter((major) => {
    if (hasAllScope) return true;
    const gradeMatch =
      !major.targetGradeIds?.length ||
      major.targetGradeIds.some((id) => visibleGrades.some((grade) => grade.id === id));
    const classMatch = !major.targetClassIds?.length || major.targetClassIds.some((id) => visibleClassIds.has(id));
    return gradeMatch && classMatch;
  });

  const majorAppliesToGrade = (major: MajorExam, gradeId: string) => {
    // 判定规则只有一份实现（详情抽屉定位「编辑考试」时要用同一条），这里只补上当前班级列表。
    return sharedMajorAppliesToGrade(major, gradeId, classes);
  };

  const scopedMajors = selectedGradeId
    ? visibleMajors.filter((major) => majorAppliesToGrade(major, selectedGradeId))
    : [];
  const orderedScopedMajors = [...scopedMajors].sort((a, b) => {
    const aSpecific = a.targetGradeIds?.includes(selectedGradeId) ? 0 : 1;
    const bSpecific = b.targetGradeIds?.includes(selectedGradeId) ? 0 : 1;
    if (aSpecific !== bSpecific) return aSpecific - bSpecific;
    const now = nowMs();
    const score = (major: MajorExam) => {
      const enabled = major.items.filter((item) => item.enabled);
      const start = Math.min(...enabled.map((item) => new Date(item.startTime).getTime()));
      const end = Math.max(...enabled.map((item) => new Date(item.endTime).getTime()));
      if (Number.isFinite(start) && now >= start && now <= end) return 0;
      if (Number.isFinite(start) && start > now) return 1;
      return 2;
    };
    const phaseDiff = score(a) - score(b);
    if (phaseDiff) return phaseDiff;
    const aStart = Math.min(...a.items.map((item) => new Date(item.startTime).getTime()).filter(Number.isFinite));
    const bStart = Math.min(...b.items.map((item) => new Date(item.startTime).getTime()).filter(Number.isFinite));
    return (
      (Number.isFinite(aStart) ? aStart : Number.MAX_SAFE_INTEGER) -
        (Number.isFinite(bStart) ? bStart : Number.MAX_SAFE_INTEGER) || a.order - b.order
    );
  });
  const hasScopedMajor = orderedScopedMajors.length > 0;
  const activeMajor: MajorExam = orderedScopedMajors.find((m) => m.id === editingMajorId) ??
    orderedScopedMajors[0] ?? {
      id: '',
      name: '当前年级暂无大型考试',
      items: [],
      order: -1,
      targetGradeIds: selectedGradeId ? [selectedGradeId] : [],
    };
  const items = activeMajor?.items ?? [];
  const subjectTrackModeEnabled = initializationRef.current.subjectTrackModeEnabled === true;
  const classesInMajorScope = (major: MajorExam) => sharedClassesInMajorScope(major, visibleClasses);
  const autoTrackClassIdsForMajorItem = (major: MajorExam, subject: string) =>
    computeAutoTrackClassIds(major, subject, visibleClasses, subjectTrackModeEnabled);
  const activeMajorTrackSubjects = items.filter((item) => isTrackSubject(item.name));
  const activeMajorTrackScopedCount = activeMajorTrackSubjects.filter((item) => item.targetClassIds?.length).length;
  const activeMajorUnsetTrackClassCount = classesInMajorScope(activeMajor).filter((item) => !item.track?.length).length;

  const changeSelectedGrade = (gradeId: string): boolean => {
    if (gradeId === selectedGradeId) return true;
    if (editingRef.current) {
      const subject = editingRef.current.name.trim() || '未命名分考试';
      notify('warning', `“${subject}”仍在编辑中，请先确认并保存，或取消本次编辑后再切换年级。`, '请先保存分考试');
      return false;
    }
    if (gradeId && !visibleGrades.some((grade) => grade.id === gradeId)) return false;
    setSelectedGradeId(gradeId);
    setSelectedClassId('');
    const candidates = visibleMajors.filter((major) => majorAppliesToGrade(major, gradeId));
    const remembered = editingMajorIdByGrade[gradeId];
    const nextMajor =
      candidates.find((major) => major.id === remembered) ??
      candidates.find((major) => major.targetGradeIds?.includes(gradeId)) ??
      candidates[0];
    setEditingMajorId(nextMajor?.id ?? '');
    updateExamSettings({ selectedGradeId: gradeId, selectedClassId: '' });
    return true;
  };
  const changeSelectedClass = (classId: string) => {
    if (classId && !visibleClasses.some((item) => item.id === classId && item.gradeId === selectedGradeId)) return;
    setSelectedClassId(classId);
    updateExamSettings({ selectedGradeId, selectedClassId: classId });
  };

  const buildPayload = useCallback(
    (ms: MajorExam[], activeId: string): ExamSavePayload => {
      const active = ms.find((m) => m.id === activeId) ?? ms[0];
      return {
        items: active?.items ?? [],
        title: active?.name ?? '',
        majors: ms,
        activeMajorId: activeId,
        alerts: alertsRef.current,
        ...weeklyStateRef.current,
        initialization: initializationRef.current,
      };
    },
    [alertsRef, weeklyStateRef, initializationRef],
  );

  const pushToServerExec = useCallback(
    async (ms: MajorExam[], activeId: string, syncLabel = '保存考试安排') => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        pendingRef.current = true;
        setSync('offline');
        return;
      }
      setSync('saving');
      const queued = getPendingExamSync();
      /**
       * 一律用调用方现场构造的这份 payload。
       *
       * 以前这里是 `queued?.payload ?? buildPayload(ms, activeId)`：上一次失败留在待同步队列里的
       * 旧快照会盖掉之后的本地改动——最典型的是「删掉一场考试，推送里还带着它」，
       * 于是服务端一直是 8 场、界面删了又回来，用户看到的现象就是「删不掉」。
       * 队列仍然有用：它提供 baseSnapshot 与 savedAt（三方合并与重试节流），只是不再提供 payload。
       */
      const payload = buildPayload(ms, activeId);
      const baseSnapshot = getCloudSnapshot();
      const baseUpdatedAt = Math.max(queued?.baseSnapshot?.updatedAt ?? 0, baseSnapshot?.updatedAt ?? 0);
      let expectedSavedAt = queued?.savedAt;
      const isStalePush = () => expectedSavedAt != null && getPendingExamSync()?.savedAt !== expectedSavedAt;
      const MAX_ATTEMPTS = 3;
      let currentPayload: typeof payload = payload;
      let currentBaseUpdatedAt = baseUpdatedAt;
      let currentBaseline = baseSnapshot;
      let totalConflicts = 0;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const result = await saveExamsToServer({
          ...currentPayload,
          baseUpdatedAt: currentBaseUpdatedAt,
          clientQueueKey: 'admin-exam-save',
          clientSyncLabel: attempt === 0 ? syncLabel : `${syncLabel} · 合并后重试(${attempt})`,
        });
        if (isStalePush()) return;
        if (result === 'unauthorized') {
          navigate('/login?next=/admin', { replace: true });
          return;
        }
        if (result && typeof result === 'object' && result.kind === 'conflict') {
          if (!result.remote) {
            pendingRef.current = true;
            setSync('error');
            notify('error', '云端冲突数据不完整，本机修改已保留；请刷新后台后再保存。', '同步失败', {
              id: 'admin-exam-sync-error',
            });
            return;
          }
          const local = { ...currentPayload, updatedAt: currentBaseUpdatedAt };
          const merged = threeWayMergeExam(currentBaseline ?? result.remote, local, result.remote);
          if (merged.conflictCount) void recordSyncConflict(merged.conflictCount, local, result.remote);
          const { alerts: mergedAlerts, ...mergedExam } = merged.payload;
          // 云端契约里 weeklyConflictPolicy 可以是 null（老快照没有这个字段），
          // 本地设置要的是已规范化的策略对象：统一在这里过一遍规范化，缺字段就沿用当前值。
          const normalizedMergedExam = {
            ...mergedExam,
            weeklyConflictPolicy: normalizeConflictPolicy(
              (mergedExam as { weeklyConflictPolicy?: unknown }).weeklyConflictPolicy ??
                weeklyStateRef.current.weeklyConflictPolicy,
            ),
          };
          if (isStalePush()) return;
          const mergedQueuedAt = nowMs();
          queuePendingExamSync({
            payload: merged.payload,
            baseSnapshot: result.remote,
            savedAt: mergedQueuedAt,
          });
          expectedSavedAt = mergedQueuedAt;
          const mergedMajors = (merged.payload as { majors: MajorExam[] }).majors;
          const mergedActiveMajorId = (merged.payload as { activeMajorId: string }).activeMajorId;
          syncMajorStateRef(stateRef, mergedMajors, mergedActiveMajorId);
          setMajors(mergedMajors);
          setActiveMajorId(mergedActiveMajorId);
          updateExamSettings({
            ...normalizedMergedExam,
            updatedAt: result.remote.updatedAt,
          });
          if (mergedAlerts) {
            updateAlertsSettings({
              ...mergedAlerts,
              updatedAt: result.remote.updatedAt,
            });
            setAlerts(getAppSettings().alerts);
          }
          totalConflicts += merged.conflictCount;
          currentPayload = merged.payload;
          currentBaseUpdatedAt = result.remote.updatedAt;
          currentBaseline = result.remote;
          if (attempt < MAX_ATTEMPTS - 1) {
            await retryBackoffDelay(attempt);
            continue;
          }
          pendingRef.current = true;
          setSync(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
          notify(
            'error',
            '云端数据变化较频繁，自动合并已重试多次仍未成功，结果已保留在本机，请稍后重新保存。',
            '同步失败',
            { id: 'admin-exam-sync-error' },
          );
          return;
        }
        if (typeof result !== 'number') {
          pendingRef.current = true;
          setSync(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
          if (result && result.kind === 'error')
            notify(
              'error',
              formatApiError(result.error, '保存考试数据失败'),
              result.error.code.startsWith('DATABASE_') ? '数据库连接失败' : '同步失败',
              { id: 'admin-exam-sync-error' },
            );
          return;
        }
        pendingRef.current = false;
        clearPendingExamSync(expectedSavedAt);
        // 服务端把已归档考试回退成了它自己的版本（含"本地删了但服务端仍在"）。
        // 本地必须跟着回灌 + 告诉用户，否则就是「本机删掉了、刷新又回来」的幽灵改动。
        const frozenMajors = takeFrozenArchivedMajors();
        if (frozenMajors.length) {
          const currentMajors = stateRef.current.majors;
          const restored = frozenMajors.filter(
            (major) => !currentMajors.some((item) => String(item.id) === String(major.id)),
          );
          const mergedMajors = applyFrozenArchivedMajors(currentMajors, frozenMajors);
          syncMajorStateRef(stateRef, mergedMajors, stateRef.current.activeMajorId);
          setMajors(mergedMajors);
          updateExamSettings({ majors: mergedMajors, updatedAt: result });
          const names = frozenMajors.map((major) => major.name || major.id).join('、');
          notify(
            'warning',
            restored.length
              ? `「${names}」已归档：服务端不接受删除，已按服务端版本放回。需要先「取消归档」再删除或修改。`
              : `「${names}」已归档：这次修改没有生效，已按服务端版本还原。需要先「取消归档」再修改。`,
            '改动没有生效',
            { id: 'exam-frozen-archived' },
          );
        }
        const { alerts: pAlerts, ...examPayload } = currentPayload;
        updateExamSettings({
          ...examPayload,
          weeklyConflictPolicy: normalizeConflictPolicy(
            (examPayload as { weeklyConflictPolicy?: unknown }).weeklyConflictPolicy ??
              weeklyStateRef.current.weeklyConflictPolicy,
          ),
          updatedAt: result,
        });
        if (pAlerts) updateAlertsSettings({ ...pAlerts, updatedAt: result });
        setSync('saved');
        if (totalConflicts)
          notify('warning', `已合并本机与云端修改；${totalConflicts} 个同字段冲突保留本机值。`, '数据冲突已处理');
        return;
      }
    },
    [buildPayload, navigate, pendingRef, setAlerts, setSync, stateRef, weeklyStateRef],
  );

  const pushToServer = useCallback(
    (ms: MajorExam[], activeId: string, syncLabel = '保存考试安排') => {
      const run = examPushChainRef.current.then(() => pushToServerExec(ms, activeId, syncLabel));
      examPushChainRef.current = run.catch(() => {});
      return run;
    },
    [examPushChainRef, pushToServerExec],
  );

  const commit = useCallback(
    (ms: MajorExam[], activeId: string, immediate = false, syncLabel = '保存考试安排'): Promise<void> | void => {
      syncMajorStateRef(stateRef, ms, activeId);
      setMajors(ms);
      setActiveMajorId(activeId);
      const now = nowMs();
      const { alerts: pAlerts, ...examPayload } = buildPayload(ms, activeId);
      updateExamSettings({
        ...examPayload,
        weeklyConflictPolicy: normalizeConflictPolicy(examPayload.weeklyConflictPolicy),
        updatedAt: now,
      });
      if (pAlerts) updateAlertsSettings({ ...pAlerts, updatedAt: now });
      queuePendingExamSync({
        payload: { ...examPayload, alerts: pAlerts ?? null },
        baseSnapshot: getCloudSnapshot(),
        savedAt: now,
      });
      pendingRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (immediate) {
        // 返回推送 Promise：删除草稿这类需要"服务端确认过才算数"的调用方可以 await 它。
        return pushToServer(ms, activeId, syncLabel);
      }
      setSync(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'saving');
      saveTimer.current = setTimeout(() => {
        void pushToServer(ms, activeId, syncLabel);
      }, 650);
    },
    [buildPayload, pendingRef, pushToServer, saveTimer, setSync, stateRef],
  );

  const commitItems = useCallback(
    (nextItems: ExamItem[], syncLabel = '保存考试安排') => {
      const ms = stateRef.current.majors.map((m) => (m.id === editingMajorId ? { ...m, items: nextItems } : m));
      commit(ms, stateRef.current.activeMajorId, false, syncLabel);
    },
    [commit, editingMajorId, stateRef],
  );
  const commitBatchMajorItems = (nextItems: ExamItem[]) => {
    commitItems(normalizeExamItems(nextItems), '批量更新分考试');
    setMajorBatchAddOpen(false);
  };

  const switchMajor = (id: string) => {
    if (id === editingMajorId) return;
    setEditingRef.current(null);
    setEditingMajorId(id);
    if (selectedGradeId) setEditingMajorIdByGrade((value) => ({ ...value, [selectedGradeId]: id }));
  };
  const commitMajorModal = (onContinueToImport: () => void): string | null => {
    if (!majorModal) return null;
    const name = majorModal.name.trim();
    if (!name) {
      setMajorError('请输入大型考试名称');
      return null;
    }
    const continueToImport = majorModal.mode === 'add' && majorModal.next === 'import';
    const targetGradeId = majorModal.targetGradeIds.find((id) => visibleGrades.some((grade) => grade.id === id)) ?? '';
    const alignSelectionToTarget = () => {
      if (!targetGradeId || targetGradeId === selectedGradeId) return;
      const classId =
        adminUser?.roleId === 'class_admin'
          ? (visibleClasses.find((item) => item.gradeId === targetGradeId)?.id ?? '')
          : '';
      setSelectedGradeId(targetGradeId);
      setSelectedClassId(classId);
      updateExamSettings({ selectedGradeId: targetGradeId, selectedClassId: classId });
    };
    if (majorModal.mode === 'add') {
      const nm: MajorExam = {
        id: genMajorId(),
        name,
        items: [],
        order: majors.length,
        targetGradeIds: majorModal.targetGradeIds,
      };
      const ms = [...majors, nm];
      alignSelectionToTarget();
      setEditingMajorId(nm.id);
      if (targetGradeId || selectedGradeId) {
        const gradeId = targetGradeId || selectedGradeId;
        setEditingMajorIdByGrade((value) => ({ ...value, [gradeId]: nm.id }));
      }
      commit(ms, nm.id, true, `新增大型考试「${name}」`);
      setMajorModal(null);
      setMajorError('');
      if (continueToImport) onContinueToImport();
      return nm.id;
    } else {
      const ms = majors.map((m) =>
        m.id === activeMajor.id ? { ...m, name, targetGradeIds: majorModal.targetGradeIds } : m,
      );
      alignSelectionToTarget();
      commit(ms, activeMajorId, true, `更新大型考试「${name}」`);
    }
    setMajorModal(null);
    setMajorError('');
    if (continueToImport) onContinueToImport();
    return activeMajorId || null;
  };
  /** 删除当前大型考试：等服务端确认后再报成功（与「删除草稿」同口径）。 */
  const removeMajor = async () => {
    if (majors.length <= 1) return;
    const removedId = activeMajor.id;
    const removedName = activeMajor.name || removedId;
    const ms = majors.filter((m) => m.id !== removedId).map((m, i) => ({ ...m, order: i }));
    const nextActiveId = removedId === activeMajorId ? ms[0].id : activeMajorId;
    const nextEditing = ms.find((major) => majorAppliesToGrade(major, selectedGradeId)) ?? ms[0];
    setEditingMajorId(nextEditing.id);
    setEditingMajorIdByGrade((value) => {
      const next = { ...value };
      for (const gradeId of Object.keys(next)) if (next[gradeId] === removedId) delete next[gradeId];
      if (selectedGradeId) next[selectedGradeId] = nextEditing.id;
      return next;
    });
    setDeleteMajorOpen(false);
    const pushed = commit(ms, nextActiveId, true, `删除大型考试「${removedName}」`);
    if (pushed) await pushed;
    // 已归档的考试会被服务端冻结并回灌，那条路径由 hook 的「改动没有生效」提示说明原因。
    if (getAppSettings().exam.majors.some((item) => item.id === removedId)) return;
    const stillPending = Boolean(getPendingExamSync());
    notify(
      stillPending ? 'warning' : 'success',
      stillPending
        ? `「${removedName}」已从本机移除，但还没同步到服务器（离线或网络不稳）；联网后会自动同步。`
        : `已删除「${removedName}」。教室端会在下一次同步时移除它。`,
      stillPending ? '待同步' : '考试已删除',
    );
  };
  /** 按 id 删掉一场考试（草稿、临时考试都走这里），并推送快照。 */
  const removeMajorById = (major: MajorExam, syncLabel: string): Promise<void> | void => {
    const ms = majors.filter((item) => item.id !== major.id).map((item, index) => ({ ...item, order: index }));
    const nextActiveId = activeMajorId === major.id ? (ms[0]?.id ?? '') : activeMajorId;
    const nextEditing = ms.find((item) => majorAppliesToGrade(item, selectedGradeId)) ?? ms[0];
    setEditingMajorId(nextEditing?.id ?? '');
    setEditingMajorIdByGrade((value) => {
      const next = { ...value };
      for (const gradeId of Object.keys(next)) {
        if (next[gradeId] === major.id) delete next[gradeId];
      }
      if (selectedGradeId && nextEditing) next[selectedGradeId] = nextEditing.id;
      return next;
    });
    return commit(ms, nextActiveId, true, syncLabel);
  };
  /** 删除临时统一考试：同样等服务端确认后再报成功。 */
  const removeQuickMajor = async (major: MajorExam) => {
    const name = major.name || major.id;
    setQuickMajorDeleteTarget(null);
    const pushed = removeMajorById(major, `删除临时考试「${name}」`);
    if (pushed) await pushed;
    if (getAppSettings().exam.majors.some((item) => item.id === major.id)) return;
    const stillPending = Boolean(getPendingExamSync());
    notify(
      stillPending ? 'warning' : 'success',
      stillPending
        ? `「${name}」已从本机移除，但还没同步到服务器（离线或网络不稳）；联网后会自动同步。`
        : `已删除临时考试「${name}」。`,
      stillPending ? '待同步' : '临时考试已删除',
    );
  };
  /** 关闭创建向导时丢弃空草稿（A 方案：只删还没填科目的那一场）。 */
  const discardDraftMajor = (major: MajorExam): Promise<void> | void =>
    removeMajorById(major, `丢弃草稿「${major.name}」`);
  const publishQuickMajor = (input: QuickMajorPublishInput) => {
    const start = new Date(input.startTime).getTime();
    if (!Number.isFinite(start)) {
      notify('error', '开始时间无效，请重新设置。', '无法发布');
      return;
    }
    const now = nowMs();
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
      source: 'quick',
      temporary: true,
      priorityOverSchedule: input.priorityOverSchedule,
      createdAt: now,
      createdBy: adminUser?.id,
      // 记录层需要考试窗口：快速考试没有单独的「开始/结束时间」输入，按首个科目时间与时长算出。
      startAt: start,
      endAt: start + input.durationMinutes * 60_000,
      endedAt: null,
    };
    const next = [...majors, quick];
    setEditingMajorId(quick.id);
    if (selectedGradeId && input.targetGradeIds.includes(selectedGradeId))
      setEditingMajorIdByGrade((value) => ({ ...value, [selectedGradeId]: quick.id }));
    commit(next, quick.id, true, `快速发布「${quick.name}」`);
    setQuickMajorOpen(false);
    notify('success', `已下发「${quick.name}」，看板将在下一次同步时收到安排。`, '统一考试已发布');
  };
  const updateQuickMajor = (id: string, patch: Partial<MajorExam>, successMessage: string) => {
    const next = majors.map((major) => (major.id === id ? { ...major, ...patch } : major));
    commit(next, activeMajorId, true, successMessage);
    notify('success', successMessage, '临时统一考试已更新');
  };
  const extendQuickMajor = (major: MajorExam) => {
    const itemEnds = major.items.map((item) => new Date(item.endTime).getTime()).filter(Number.isFinite);
    // 老数据没有 major.endAt，从最后一科结束时间推导，避免延长后两个口径不一致。
    const currentEndAt = major.endAt ?? (itemEnds.length ? Math.max(...itemEnds) : null);
    const nextEndAt = currentEndAt == null ? null : currentEndAt + 5 * 60_000;
    updateQuickMajor(
      major.id,
      {
        items: major.items.map((item) => ({
          ...item,
          endTime: toLocalInput(new Date(item.endTime).getTime() + 5 * 60_000),
        })),
        ...(nextEndAt == null ? {} : { endAt: nextEndAt }),
      },
      `「${major.name}」已延长 5 分钟。`,
    );
  };
  const endQuickMajor = (major: MajorExam) => {
    const endedAt = nowMs();
    updateQuickMajor(
      major.id,
      {
        endedAt,
        actualEndAt: endedAt,
        items: major.items.map((item) => ({ ...item, enabled: false })),
      },
      `「${major.name}」已提前结束。`,
    );
  };
  const promoteQuickMajor = (major: MajorExam) =>
    updateQuickMajor(
      major.id,
      { source: 'regular', temporary: false, priorityOverSchedule: false },
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
    keepWizardStepOnNextOpen,
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
    discardDraftMajor,
    publishQuickMajor,
    updateQuickMajor,
    extendQuickMajor,
    endQuickMajor,
    promoteQuickMajor,
  };
}
