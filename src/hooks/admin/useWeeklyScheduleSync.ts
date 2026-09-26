import { useCallback, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { MajorExam } from '../../types';
import type { ScheduleMode, WeeklyPlan, WeeklyConflictPolicy } from '../../types/exam';
import type { SchoolClass, SchoolGrade } from '../../types/school';
import {
  adminCanClass,
  adminCanGrade,
  getCloudSnapshot,
  saveExamsToServer,
  type AdminUserContext,
} from '../../services/examService';
import { threeWayMergeExam } from '../../utils/examMerge';
import { clearPendingExamSync, getPendingExamSync, queuePendingExamSync } from '../../services/examOutbox';
import { normalizeConflictPolicy, updateExamSettings } from '../../utils/appSettings';
import { notify } from '../../services/notify';
import { formatApiError } from '../../services/apiError';
import { nowMs } from '../../utils/timeSource';
import type { ExamSavePayload } from '../../shared/examContracts';
import type { SyncState } from './adminPageUtils';
import { syncMajorStateRef } from './adminPageUtils';

export type WeeklyState = {
  scheduleMode: ScheduleMode;
  weeklyPlans: WeeklyPlan[];
  activeWeeklyPlanId: string | null;
  activeWeeklyPlanIdByClassId: Record<string, string | null>;
  grades: SchoolGrade[];
  classes: SchoolClass[];
  weeklyConflictPolicy: WeeklyConflictPolicy;
};

const retryBackoffDelay = (attempt: number) =>
  new Promise((resolve) => setTimeout(resolve, Math.min(4000, 400 * 2 ** attempt)));

// Owns weekly-schedule + grade/class roster state, and the independent weekly
// push/save pipeline (shares the /api/exams endpoint and conflict shape with
// the major-exam pipeline, but is serialized through its own outbox merge).
// Reaches into the major-exam domain only through the indirection refs
// (`buildPayloadRef`/`setMajorsRef`/`setActiveMajorIdRef`), since
// useMajorScheduleActions is initialized after this hook.
export function useWeeklyScheduleSync(params: {
  adminUser: AdminUserContext | null;
  initial: WeeklyState;
  navigate: NavigateFunction;
  stateRef: MutableRefObject<{ majors: MajorExam[]; activeMajorId: string }>;
  pendingRef: MutableRefObject<boolean>;
  examPushChainRef: MutableRefObject<Promise<void>>;
  weeklySaveTimer: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  buildPayloadRef: MutableRefObject<(ms: MajorExam[], activeId: string) => ExamSavePayload>;
  setMajorsRef: MutableRefObject<(ms: MajorExam[]) => void>;
  setActiveMajorIdRef: MutableRefObject<(id: string) => void>;
  setSync: (state: SyncState) => void;
}) {
  const {
    adminUser,
    initial,
    navigate,
    stateRef,
    pendingRef,
    examPushChainRef,
    weeklySaveTimer,
    buildPayloadRef,
    setMajorsRef,
    setActiveMajorIdRef,
    setSync,
  } = params;

  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(initial.scheduleMode);
  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlan[]>(initial.weeklyPlans);
  const [activeWeeklyPlanId, setActiveWeeklyPlanId] = useState<string | null>(initial.activeWeeklyPlanId);
  const [activeWeeklyPlanIdByClassId, setActiveWeeklyPlanIdByClassId] = useState<Record<string, string | null>>(
    initial.activeWeeklyPlanIdByClassId,
  );
  const [grades, setGrades] = useState<SchoolGrade[]>(initial.grades);
  const [classes, setClasses] = useState<SchoolClass[]>(initial.classes);
  const [weeklyConflictPolicy, setWeeklyConflictPolicy] = useState<WeeklyConflictPolicy>(initial.weeklyConflictPolicy);

  const weeklyStateRef = useRef<WeeklyState>({
    scheduleMode,
    weeklyPlans,
    activeWeeklyPlanId,
    activeWeeklyPlanIdByClassId,
    grades,
    classes,
    weeklyConflictPolicy,
  });
  weeklyStateRef.current = {
    scheduleMode,
    weeklyPlans,
    activeWeeklyPlanId,
    activeWeeklyPlanIdByClassId,
    grades,
    classes,
    weeklyConflictPolicy,
  };

  const hasAllScope =
    !!adminUser && (adminUser.permissions.includes('*') || adminUser.scopes.some((scope) => scope.type === 'all'));
  const visibleGrades = grades.filter((grade) => adminCanGrade(grade.id, adminUser));
  const visibleClasses = classes.filter((item) => adminCanClass(item.gradeId, item.id, adminUser));
  const visibleClassIds = new Set(visibleClasses.map((item) => item.id));
  const visibleWeeklyPlans = weeklyPlans.filter((plan) => visibleClassIds.has(plan.classId));

  const pushWeeklyToServerExec = useCallback(
    async (weekly: WeeklyState, syncLabel = '保存周测与班级安排') => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        pendingRef.current = true;
        setSync('offline');
        const queued = getPendingExamSync();
        // payload 一律现场构造：待同步队列里的旧快照会吞掉之后的本地改动（例如刚删掉的考试）。
        const basePayload = buildPayloadRef.current(stateRef.current.majors, stateRef.current.activeMajorId);
        queuePendingExamSync({
          payload: { ...basePayload, ...weekly },
          baseSnapshot: queued?.baseSnapshot ?? getCloudSnapshot(),
          savedAt: nowMs(),
        });
        return;
      }
      setSync('saving');
      const ms = stateRef.current.majors;
      const activeId = stateRef.current.activeMajorId;
      const queued = getPendingExamSync();
      // 同上：调用方给的 ms 是最新状态，别被队列里的旧 payload 盖掉。
      const base = buildPayloadRef.current(ms, activeId);
      const queuedBaseSnapshot = queued?.baseSnapshot;
      const liveBaseSnapshot = getCloudSnapshot();
      const baseSnapshot =
        (queuedBaseSnapshot?.updatedAt ?? 0) >= (liveBaseSnapshot?.updatedAt ?? 0)
          ? (queuedBaseSnapshot ?? liveBaseSnapshot)
          : (liveBaseSnapshot ?? queuedBaseSnapshot);
      const payload: ExamSavePayload = { ...base, ...weekly };
      const expectedSavedAt = queued?.savedAt;
      const isStaleWeeklyPush = () => expectedSavedAt != null && getPendingExamSync()?.savedAt !== expectedSavedAt;
      const result = await saveExamsToServer({
        ...payload,
        baseUpdatedAt: baseSnapshot?.updatedAt ?? 0,
        clientQueueKey: 'admin-exam-save',
        clientSyncLabel: syncLabel,
      });
      if (isStaleWeeklyPush()) return;
      if (result === 'unauthorized') {
        navigate('/login?next=/admin', { replace: true });
        return;
      }
      if (result && typeof result === 'object' && result.kind === 'conflict') {
        if (result.remote) {
          const baseline = getCloudSnapshot() ?? {
            ...result.remote,
            updatedAt: baseSnapshot?.updatedAt ?? 0,
          };
          const merged = threeWayMergeExam(
            baseline,
            { ...payload, updatedAt: baseSnapshot?.updatedAt ?? 0 },
            result.remote,
          );
          const mergedPending = {
            payload: merged.payload,
            baseSnapshot: result.remote,
            savedAt: nowMs(),
          };
          await retryBackoffDelay(0);
          const retry = await saveExamsToServer({
            ...merged.payload,
            baseUpdatedAt: result.remote.updatedAt,
            clientQueueKey: 'admin-exam-save',
            clientSyncLabel: `${syncLabel} · 合并后重试`,
          });
          if (isStaleWeeklyPush()) return;
          if (typeof retry === 'number') {
            const mergedPayload = merged.payload;
            const mergedWeekly: WeeklyState = {
              scheduleMode: mergedPayload.scheduleMode ?? weekly.scheduleMode,
              weeklyPlans: mergedPayload.weeklyPlans ?? weekly.weeklyPlans,
              activeWeeklyPlanId: mergedPayload.activeWeeklyPlanId ?? null,
              activeWeeklyPlanIdByClassId: mergedPayload.activeWeeklyPlanIdByClassId ?? {},
              grades: mergedPayload.grades ?? weekly.grades,
              classes: mergedPayload.classes ?? weekly.classes,
              weeklyConflictPolicy: mergedPayload.weeklyConflictPolicy ?? weekly.weeklyConflictPolicy,
            };
            if (mergedPayload.majors?.length) {
              const mergedActiveMajorId = mergedPayload.activeMajorId || mergedPayload.majors[0].id;
              syncMajorStateRef(stateRef, mergedPayload.majors, mergedActiveMajorId);
              setMajorsRef.current(mergedPayload.majors);
              setActiveMajorIdRef.current(mergedActiveMajorId);
            }
            setScheduleMode(mergedWeekly.scheduleMode);
            setWeeklyPlans(mergedWeekly.weeklyPlans);
            setActiveWeeklyPlanId(mergedWeekly.activeWeeklyPlanId);
            setActiveWeeklyPlanIdByClassId(mergedWeekly.activeWeeklyPlanIdByClassId);
            setGrades(mergedWeekly.grades);
            setClasses(mergedWeekly.classes);
            setWeeklyConflictPolicy(mergedWeekly.weeklyConflictPolicy);
            weeklyStateRef.current = mergedWeekly;
            updateExamSettings({
              ...mergedPayload,
              ...mergedWeekly,
              updatedAt: retry,
            });
            pendingRef.current = false;
            clearPendingExamSync(queued?.savedAt);
            setSync('saved');
            return;
          }
          queuePendingExamSync(mergedPending);
        }
        pendingRef.current = true;
        setSync('error');
        notify('error', `${syncLabel}遇到云端变化，自动重试仍失败；请刷新后台后重新保存。`, '同步失败', {
          id: 'admin-exam-sync-error',
        });
        return;
      }
      if (typeof result !== 'number') {
        pendingRef.current = true;
        queuePendingExamSync({
          payload,
          baseSnapshot: baseSnapshot ?? null,
          savedAt: queued?.savedAt ?? nowMs(),
        });
        setSync(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
        if (result && result.kind === 'error')
          notify(
            'error',
            formatApiError(result.error, `${syncLabel}失败`),
            result.error.code.startsWith('DATABASE_') ? '数据库连接失败' : '同步失败',
            { id: 'admin-exam-sync-error' },
          );
        return;
      }
      pendingRef.current = false;
      clearPendingExamSync(queued?.savedAt);
      updateExamSettings({
        ...payload,
        // 同一个理由：云端契约允许 null，本地设置只接受已规范化的策略对象。
        weeklyConflictPolicy: normalizeConflictPolicy(
          payload.weeklyConflictPolicy ?? weeklyStateRef.current.weeklyConflictPolicy,
        ),
        updatedAt: result,
      });
      setSync('saved');
    },
    [buildPayloadRef, navigate, pendingRef, setActiveMajorIdRef, setMajorsRef, setSync, stateRef],
  );

  const pushWeeklyToServer = useCallback(
    (weekly: WeeklyState, syncLabel?: string) => {
      const run = examPushChainRef.current.then(() => pushWeeklyToServerExec(weekly, syncLabel));
      examPushChainRef.current = run.catch(() => {});
      return run;
    },
    [examPushChainRef, pushWeeklyToServerExec],
  );

  const commitWeekly = useCallback(
    (weekly: Partial<WeeklyState>, immediate = false, syncLabel?: string) => {
      const next = { ...weeklyStateRef.current, ...weekly };
      setScheduleMode(next.scheduleMode);
      setWeeklyPlans(next.weeklyPlans);
      setActiveWeeklyPlanId(next.activeWeeklyPlanId);
      setActiveWeeklyPlanIdByClassId(next.activeWeeklyPlanIdByClassId);
      setGrades(next.grades);
      setClasses(next.classes);
      setWeeklyConflictPolicy(next.weeklyConflictPolicy);
      weeklyStateRef.current = next;
      const now = nowMs();
      updateExamSettings({ ...next, updatedAt: now });
      const queued = getPendingExamSync();
      // 同上：payload 现场构造，队列只提供 baseSnapshot / savedAt。
      const basePayload = buildPayloadRef.current(stateRef.current.majors, stateRef.current.activeMajorId);
      queuePendingExamSync({
        payload: { ...basePayload, ...next },
        baseSnapshot: queued?.baseSnapshot ?? getCloudSnapshot(),
        savedAt: now,
      });
      pendingRef.current = true;
      if (weeklySaveTimer.current) clearTimeout(weeklySaveTimer.current);
      if (immediate) {
        void pushWeeklyToServer(next, syncLabel);
        return;
      }
      setSync(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'saving');
      weeklySaveTimer.current = setTimeout(() => {
        void pushWeeklyToServer(next, syncLabel);
      }, 650);
    },
    [buildPayloadRef, pendingRef, pushWeeklyToServer, setSync, stateRef, weeklySaveTimer],
  );

  const handleScheduleModeChange = (mode: ScheduleMode) => commitWeekly({ scheduleMode: mode }, true);

  const handleSaveWeeklyPlans = (
    plans: WeeklyPlan[],
    activeId: string | null,
    classId: string,
    immediate = false,
    activeByClass?: Record<string, string | null>,
  ) => {
    const mergedPlans = hasAllScope
      ? plans
      : [
          ...weeklyStateRef.current.weeklyPlans.filter((plan) => !visibleClassIds.has(plan.classId)),
          ...plans.filter((plan) => visibleClassIds.has(plan.classId)),
        ];
    const nextByClass = activeByClass ?? {
      ...weeklyStateRef.current.activeWeeklyPlanIdByClassId,
      [classId]: activeId,
    };
    commitWeekly(
      {
        weeklyPlans: mergedPlans,
        activeWeeklyPlanId: classId ? weeklyStateRef.current.activeWeeklyPlanId : activeId,
        activeWeeklyPlanIdByClassId: nextByClass,
      },
      immediate,
    );
  };

  const handleConflictPolicyChange = (policy: WeeklyConflictPolicy, immediate = false) =>
    commitWeekly({ weeklyConflictPolicy: policy }, immediate);

  return {
    scheduleMode,
    setScheduleMode,
    weeklyPlans,
    setWeeklyPlans,
    activeWeeklyPlanId,
    setActiveWeeklyPlanId,
    activeWeeklyPlanIdByClassId,
    setActiveWeeklyPlanIdByClassId,
    grades,
    setGrades,
    classes,
    setClasses,
    weeklyConflictPolicy,
    setWeeklyConflictPolicy,
    weeklyStateRef,
    hasAllScope,
    visibleGrades,
    visibleClasses,
    visibleClassIds,
    visibleWeeklyPlans,
    pushWeeklyToServerExec,
    pushWeeklyToServer,
    commitWeekly,
    handleScheduleModeChange,
    handleSaveWeeklyPlans,
    handleConflictPolicyChange,
  };
}
