import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { sendDeviceHeartbeat } from '../services/classBinding';
import { APP_VERSION } from '../services/telemetry';
import { getAppSettings } from '../utils/appSettings';
import { getResolvedExamItems } from '../utils/appSchedule';
import { nowMs, parseZonedTime } from '../utils/timeSource';

export default function DeviceHeartbeat() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const send = () => {
      const now = nowMs();
      const items = getResolvedExamItems(now);
      const current = items.find(item => item.enabled && parseZonedTime(item.startTime) <= now && parseZonedTime(item.endTime) > now);
      const next = current ?? items.find(item => item.enabled && parseZonedTime(item.startTime) > now);
      const settings = getAppSettings();
      void sendDeviceHeartbeat({
        page: pathname,
        clientVersion: APP_VERSION,
        status: current ? 'exam-running' : next ? 'waiting' : 'idle',
        currentExam: settings.exam.title,
        currentSubject: next?.name ?? '',
        examStart: next?.startTime ?? '',
        examEnd: next?.endTime ?? '',
      }).then(revoked => { if (revoked && pathname !== '/') navigate('/', { replace: true }); });
    };
    send();
    const timer = window.setInterval(send, 25_000);
    const onVisible = () => { if (document.visibilityState === 'visible') send(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('exam-board:settings-changed', send);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('exam-board:settings-changed', send); };
  }, [navigate, pathname]);

  return null;
}
