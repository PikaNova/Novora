import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getClassBindingInstanceId } from '../services/classBinding';
import { getAppSettings, updateExamSettings } from '../utils/appSettings';
import { applyTemporaryExamCommand } from '../services/temporaryExam';
import { notify } from '../services/notify';
import { pluginInstanceFromSearch, sendPluginViewerHeartbeat } from '../services/pluginPairing';
import { CLOUD_VERSION_EVENT, logoutAdmin } from '../services/examService';
import { resolveDeviceCommandReceipt } from '../utils/deviceCommandReceipt';
import { getSyncTransport, subscribeToSync } from '../sync/transport';

/** 设置变更后的即时心跳合并窗口；多次变更只补发一次。 */
const SETTINGS_CHANGED_TICK_DEBOUNCE_MS = 2_000;

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
        const outcome = applyTemporaryExamCommand(command);
        if (!outcome.ok) {
          // 没执行就如实报失败：后台会显示「失败：原因」，不再把 no-op 当成功。
          transport.noteCommandFailed(command.id, outcome.reason);
          notify('warning', `后台指令未执行：${outcome.reason}`, '临时考试指令');
          return;
        }
        // 登记回执：传输层会在下一轮心跳里带上，并在执行后补发一次快速回执。
        transport.noteCommandAcknowledged(command.id);
        notify(receipt.tone, receipt.message);
      },
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') transport.tick();
    };
    /**
     * 设置变更后的即时心跳要防抖：一次「保存并发布」会连着触发好几次
     * `exam-board:settings-changed`（保存快照、写动作、绑定回写…），每次都立刻发心跳
     * 会把上报节奏从 30s/60s 打成 1s 级——服务端每轮心跳都要跑一遍生命周期推进与命令认领，
     * 纯属白烧。合并成一次即可，2 秒内教室里看到的状态一样新。
     */
    let settingsTickTimer: ReturnType<typeof setTimeout> | null = null;
    const onSettingsChanged = () => {
      if (settingsTickTimer !== null) clearTimeout(settingsTickTimer);
      settingsTickTimer = setTimeout(() => {
        settingsTickTimer = null;
        transport.tick();
      }, SETTINGS_CHANGED_TICK_DEBOUNCE_MS);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('exam-board:settings-changed', onSettingsChanged);
    return () => {
      unsubscribe();
      if (settingsTickTimer !== null) clearTimeout(settingsTickTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('exam-board:settings-changed', onSettingsChanged);
    };
  }, [navigate]);

  return null;
}
