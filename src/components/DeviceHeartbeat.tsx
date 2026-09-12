import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getClassBindingInstanceId } from '../services/classBinding';
import { getAppSettings, updateExamSettings } from '../utils/appSettings';
import { endTemporaryExam, extendTemporaryExam, setTemporaryExamPaused } from '../services/temporaryExam';
import { notify } from '../services/notify';
import { pluginInstanceFromSearch, sendPluginViewerHeartbeat } from '../services/pluginPairing';
import { CLOUD_VERSION_EVENT, logoutAdmin } from '../services/examService';
import { resolveDeviceCommandReceipt } from '../utils/deviceCommandReceipt';
import { getSyncTransport, subscribeToSync } from '../sync/transport';

/**
 * 设备心跳与后台指令的副作用入口。
 *
 * 轮询节奏、请求体组装、命令去重都收在 src/sync/transport.ts；这里只负责
 * 「收到命令 / 绑定变更 / 被撤销之后要做什么」。本地部署改用 WSS 时换掉传输实现即可，
 * 这个组件不需要跟着改。
 */
export default function DeviceHeartbeat() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  // 回调里要读到最新的路由信息，用 ref 固定。
  const pathnameRef = useRef(pathname);
  const searchRef = useRef(search);
  pathnameRef.current = pathname;
  searchRef.current = search;

  useEffect(() => {
    const transport = getSyncTransport();
    const unsubscribe = subscribeToSync({
      onTick: () => {
        void sendPluginViewerHeartbeat(pluginInstanceFromSearch(searchRef.current), getClassBindingInstanceId());
      },
      onRevoked: () => {
        logoutAdmin();
        const current = pathnameRef.current;
        const managementRoute = current === '/admin' || current.startsWith('/admin/') || current === '/settings';
        const bindingRoute =
          current === '/exam' ||
          current === '/preferences' ||
          current === '/local-settings' ||
          current === '/plugin/connect';
        if (managementRoute) navigate('/login?next=%2Fadmin&deviceRemoved=1', { replace: true });
        else if (bindingRoute) navigate('/', { replace: true });
      },
      onBinding: (binding) => {
        if (binding.revoked) return;
        const currentBinding = getAppSettings().exam;
        if (currentBinding.selectedGradeId !== binding.gradeId || currentBinding.selectedClassId !== binding.classId)
          updateExamSettings({ selectedGradeId: binding.gradeId, selectedClassId: binding.classId });
        if (binding.isManagement && pathnameRef.current === '/exam') {
          navigate('/', { replace: true });
        }
      },
      onVersion: (version) => {
        window.dispatchEvent(new CustomEvent(CLOUD_VERSION_EVENT, { detail: { version } }));
      },
      onCommand: (command) => {
        const receipt = resolveDeviceCommandReceipt(command, '');
        if (!receipt) return;
        if (command.action === 'pause') setTemporaryExamPaused(true);
        if (command.action === 'resume') setTemporaryExamPaused(false);
        if (command.action === 'extend') extendTemporaryExam(command.minutes || 5);
        if (command.action === 'end') endTemporaryExam();
        // 登记回执：传输层会在下一轮心跳里带上，并在执行后补发一次快速回执。
        transport.noteCommandAcknowledged(command.id);
        notify(receipt.tone, receipt.message);
      },
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') transport.tick();
    };
    const onSettingsChanged = () => transport.tick();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('exam-board:settings-changed', onSettingsChanged);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('exam-board:settings-changed', onSettingsChanged);
    };
  }, [navigate]);

  return null;
}
