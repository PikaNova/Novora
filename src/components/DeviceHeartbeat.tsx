import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getClassBindingInstanceId, sendDeviceHeartbeat } from '../services/classBinding';
import { APP_VERSION } from '../services/telemetry';
import { getAppSettings } from '../utils/appSettings';
import { getResolvedExamItems } from '../utils/appSchedule';
import { nowMs, parseZonedTime } from '../utils/timeSource';
import { endTemporaryExam, extendTemporaryExam, getTemporaryExam, setTemporaryExamPaused } from '../services/temporaryExam';
import { notify } from '../services/notify';
import { pluginInstanceFromSearch, sendPluginViewerHeartbeat } from '../services/pluginPairing';
import { updateExamSettings } from '../utils/appSettings';

export default function DeviceHeartbeat() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let acknowledgedCommandId = '';
    const send = () => {
      void sendPluginViewerHeartbeat(pluginInstanceFromSearch(search), getClassBindingInstanceId());
      const now = nowMs();
      const items = getResolvedExamItems(now);
      const current = items.find(item => item.enabled && parseZonedTime(item.startTime) <= now && parseZonedTime(item.endTime) > now);
      const next = current ?? items.find(item => item.enabled && parseZonedTime(item.startTime) > now);
      const settings = getAppSettings();
      const temporary = getTemporaryExam();
      const temporaryActive = temporary && temporary.status !== 'ended' && new Date(temporary.endTime).getTime() > now;
      const currentIsTemporary = current?.kind === 'temporary';
      void sendDeviceHeartbeat({
        page: pathname,
        clientVersion: APP_VERSION,
        status: current ? 'exam-running' : temporaryActive && temporary.status === 'paused' ? 'temporary-paused' : next ? 'waiting' : 'idle',
        currentExam: currentIsTemporary ? `${current.name} - 临时考试` : current?.majorName || settings.exam.title,
        currentSubject: current?.name ?? next?.name ?? '',
        examStart: current?.startTime ?? next?.startTime ?? '',
        examEnd: current?.endTime ?? next?.endTime ?? '',
        acknowledgedCommandId,
      }).then(result => {
        const bindingRequired = pathname === '/exam' || pathname === '/preferences' || pathname === '/local-settings' || pathname === '/plugin/connect';
        if (result.revoked && bindingRequired) { navigate('/', { replace: true }); return; }
        if (result.binding && !result.binding.revoked) {
          const currentBinding = getAppSettings().exam;
          if (currentBinding.selectedGradeId !== result.binding.gradeId || currentBinding.selectedClassId !== result.binding.classId) updateExamSettings({ selectedGradeId: result.binding.gradeId, selectedClassId: result.binding.classId });
          if (result.binding.isManagement && pathname === '/exam') { navigate('/', { replace: true }); return; }
        }
        if (!result.command || result.command.id === acknowledgedCommandId) return;
        if (result.command.action === 'pause') setTemporaryExamPaused(true);
        if (result.command.action === 'resume') setTemporaryExamPaused(false);
        if (result.command.action === 'extend') extendTemporaryExam(result.command.minutes || 5);
        if (result.command.action === 'end') endTemporaryExam();
        acknowledgedCommandId = result.command.id;
        const actionLabel = result.command.action === 'pause' ? '暂停' : result.command.action === 'resume' ? '继续' : result.command.action === 'extend' ? `延长 ${result.command.minutes || 5} 分钟` : '结束';
        notify(result.command.action === 'end' ? 'warning' : 'success', `后台已${actionLabel}本机临时考试。`);
        window.setTimeout(send, 250);
      });
    };
    send();
    const timer = window.setInterval(send, 25_000);
    const onVisible = () => { if (document.visibilityState === 'visible') send(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('exam-board:settings-changed', send);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('exam-board:settings-changed', send); };
  }, [navigate, pathname, search]);

  return null;
}
