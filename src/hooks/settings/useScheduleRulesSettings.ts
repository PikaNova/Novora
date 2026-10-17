import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCloudSnapshot, saveExamsToServer } from '../../services/examService';
import { formatApiError } from '../../services/apiError';
import { notify } from '../../services/notify';
import { getAppSettings, updateExamSettings } from '../../utils/appSettings';
import type { ScheduleMode, WeeklyConflictPolicy } from '../../types/exam';

function saveInput() {
  const settings = getAppSettings();
  const exam = settings.exam;
  return {
    items: exam.items,
    title: exam.title,
    majors: exam.majors,
    activeMajorId: exam.activeMajorId,
    alerts: settings.alerts,
    scheduleMode: exam.scheduleMode,
    weeklyPlans: exam.weeklyPlans,
    activeWeeklyPlanId: exam.activeWeeklyPlanId,
    activeWeeklyPlanIdByClassId: exam.activeWeeklyPlanIdByClassId,
    grades: exam.grades,
    classes: exam.classes,
    weeklyConflictPolicy: exam.weeklyConflictPolicy,
    majorExamCreationLockEnabled: exam.majorExamCreationLockEnabled,
  };
}

export function useScheduleRulesSettings(canEditScheduleMode: boolean, canEditConflictPolicy: boolean) {
  const navigate = useNavigate();
  const initialExam = getAppSettings().exam;
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(initialExam.scheduleMode);
  const [weeklyConflictPolicy, setWeeklyConflictPolicy] = useState<WeeklyConflictPolicy>(
    initialExam.weeklyConflictPolicy,
  );
  const [saveStatus, setSaveStatus] = useState('');

  const persist = useCallback(
    async (changed: { scheduleMode?: ScheduleMode; weeklyConflictPolicy?: WeeklyConflictPolicy }) => {
      const input = saveInput();
      let result = await saveExamsToServer({
        ...input,
        baseUpdatedAt: getCloudSnapshot()?.updatedAt ?? 0,
        clientQueueKey: 'settings-schedule-rules',
        clientSyncLabel: '保存考试调度规则',
      });

      if (result && typeof result === 'object' && result.kind === 'conflict' && result.remote) {
        const remote = result.remote;
        result = await saveExamsToServer({
          ...input,
          items: remote.items ?? input.items,
          title: remote.title ?? input.title,
          majors: remote.majors ?? input.majors,
          activeMajorId: remote.activeMajorId ?? input.activeMajorId,
          alerts: remote.alerts ?? input.alerts,
          scheduleMode: changed.scheduleMode ?? remote.scheduleMode ?? input.scheduleMode,
          weeklyPlans: remote.weeklyPlans ?? input.weeklyPlans,
          activeWeeklyPlanId: remote.activeWeeklyPlanId ?? input.activeWeeklyPlanId,
          activeWeeklyPlanIdByClassId: remote.activeWeeklyPlanIdByClassId ?? input.activeWeeklyPlanIdByClassId,
          grades: remote.grades ?? input.grades,
          classes: remote.classes ?? input.classes,
          weeklyConflictPolicy:
            changed.weeklyConflictPolicy ?? remote.weeklyConflictPolicy ?? input.weeklyConflictPolicy,
          baseUpdatedAt: remote.updatedAt,
          clientQueueKey: 'settings-schedule-rules',
          clientSyncLabel: '合并云端变化后保存考试调度规则',
        });
      }

      if (result === 'unauthorized') {
        navigate('/login?next=/settings/exam', { replace: true });
        return false;
      }
      if (typeof result === 'number') {
        updateExamSettings({ updatedAt: result });
        setSaveStatus('已保存到云端');
        return true;
      }
      const message =
        result && typeof result === 'object' && result.kind === 'error'
          ? formatApiError(result.error, '考试调度规则保存失败')
          : '考试调度规则遇到云端变化，自动合并失败；请刷新后重新保存。';
      setSaveStatus(message);
      notify('error', message, '保存失败', { id: 'schedule-rules-save-error' });
      return false;
    },
    [navigate],
  );

  const changeScheduleMode = useCallback(
    (value: ScheduleMode) => {
      if (!canEditScheduleMode) return;
      setScheduleMode(value);
      updateExamSettings({ scheduleMode: value, updatedAt: Date.now() });
      setSaveStatus('正在保存到云端…');
      void persist({ scheduleMode: value });
    },
    [canEditScheduleMode, persist],
  );

  const changeConflictPolicy = useCallback(
    (value: WeeklyConflictPolicy) => {
      if (!canEditConflictPolicy) return;
      setWeeklyConflictPolicy(value);
      updateExamSettings({ weeklyConflictPolicy: value, updatedAt: Date.now() });
      setSaveStatus('正在保存到云端…');
      void persist({ weeklyConflictPolicy: value });
    },
    [canEditConflictPolicy, persist],
  );

  return { scheduleMode, weeklyConflictPolicy, saveStatus, changeScheduleMode, changeConflictPolicy };
}
