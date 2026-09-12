import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getClassBindingInstanceId, sendDeviceHeartbeat } from '../services/classBinding';
import { APP_VERSION } from '../services/telemetry';
import { getAppSettings } from '../utils/appSettings';
import { getResolvedExamItems } from '../utils/appSchedule';
import { nowMs, parseZonedTime } from '../utils/timeSource';
import {
  endTemporaryExam,
  extendTemporaryExam,
  getTemporaryExam,
  setTemporaryExamPaused,
} from '../services/temporaryExam';
import { notify } from '../services/notify';
import { pluginInstanceFromSearch, sendPluginViewerHeartbeat } from '../services/pluginPairing';
import { updateExamSettings } from '../utils/appSettings';
import { logoutAdmin } from '../services/examService';
import { resolveDeviceCommandReceipt } from '../utils/deviceCommandReceipt';
import { deviceHeartbeatIntervalMs } from '../shared/deviceContracts';
import { jitteredIntervalMs } from '../shared/polling';
import { CLOUD_VERSION_EVENT } from '../services/examService';

export default function DeviceHeartbeat() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let acknowledgedCommandId = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      const now = nowMs();
      const items = getResolvedExamItems(now);
      const current = items.find(
        (item) => item.enabled && parseZonedTime(item.startTime) <= now && parseZonedTime(item.endTime) > now,
      );
      const temporary = getTemporaryExam();
      const temporaryActive = temporary && temporary.status !== 'ended' && new Date(temporary.endTime).getTime() > now;
      const delay = jitteredIntervalMs(
        deviceHeartbeatIntervalMs({
          temporaryActive,
          hasCurrentExam: Boolean(current),
        }),
      );
      timer = setTimeout(send, delay);
    };
    const send = () => {
      void sendPluginViewerHeartbeat(pluginInstanceFromSearch(search), getClassBindingInstanceId());
      const now = nowMs();
      const items = getResolvedExamItems(now);
      const current = items.find(
        (item) => item.enabled && parseZonedTime(item.startTime) <= now && parseZonedTime(item.endTime) > now,
      );
      const next = current ?? items.find((item) => item.enabled && parseZonedTime(item.startTime) > now);
      const settings = getAppSettings();
      const temporary = getTemporaryExam();
      const temporaryActive = temporary && temporary.status !== 'ended' && new Date(temporary.endTime).getTime() > now;
      const reportedExam = current ?? next;
      const reportedKind = reportedExam?.kind;
      const reportedExamName = !reportedExam
        ? ''
        : reportedKind === 'temporary'
          ? `${reportedExam.name} - 临时考试`
          : reportedKind === 'weekly'
            ? '周测'
            : reportedExam.majorName || settings.exam.title || '大型考试';
      void sendDeviceHeartbeat({
        page: pathname,
        clientVersion: APP_VERSION,
        status:
          temporaryActive && temporary.status === 'paused'
            ? 'temporary-paused'
            : current
              ? 'exam-running'
              : next
                ? 'waiting'
                : 'idle',
        currentExam: reportedExamName,
        currentSubject: reportedExam?.name ?? '',
        examStart: reportedExam?.startTime ?? '',
        examEnd: reportedExam?.endTime ?? '',
        acknowledgedCommandId,
      }).then((result) => {
        if (typeof result.version === 'number') {
          window.dispatchEvent(new CustomEvent(CLOUD_VERSION_EVENT, { detail: { version: result.version } }));
        }
        if (result.revoked) {
          logoutAdmin();
          const managementRoute = pathname === '/admin' || pathname.startsWith('/admin/') || pathname === '/settings';
          const bindingRoute =
            pathname === '/exam' ||
            pathname === '/preferences' ||
            pathname === '/local-settings' ||
            pathname === '/plugin/connect';
          if (managementRoute) navigate('/login?next=%2Fadmin&deviceRemoved=1', { replace: true });
          else if (bindingRoute) navigate('/', { replace: true });
          return;
        }
        if (result.binding && !result.binding.revoked) {
          const currentBinding = getAppSettings().exam;
          if (
            currentBinding.selectedGradeId !== result.binding.gradeId ||
            currentBinding.selectedClassId !== result.binding.classId
          )
            updateExamSettings({ selectedGradeId: result.binding.gradeId, selectedClassId: result.binding.classId });
          if (result.binding.isManagement && pathname === '/exam') {
            navigate('/', { replace: true });
            return;
          }
        }
        const receipt = resolveDeviceCommandReceipt(result.command, acknowledgedCommandId);
        if (!receipt) return;
        const { command } = receipt;
        if (command.action === 'pause') setTemporaryExamPaused(true);
        if (command.action === 'resume') setTemporaryExamPaused(false);
        if (command.action === 'extend') extendTemporaryExam(command.minutes || 5);
        if (command.action === 'end') endTemporaryExam();
        acknowledgedCommandId = command.id;
        notify(receipt.tone, receipt.message);
        window.setTimeout(send, 250);
      });
      schedule();
    };
    send();
    const onVisible = () => {
      if (document.visibilityState === 'visible') send();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('exam-board:settings-changed', send);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('exam-board:settings-changed', send);
    };
  }, [navigate, pathname, search]);

  return null;
}
