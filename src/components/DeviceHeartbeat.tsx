import { journal } from '../utils/runtimeJournal.js';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getClassBindingInstanceId } from '../services/classBinding';
import { getAppSettings, updateExamSettings, updateTimeSyncSettings } from '../utils/appSettings';
import { runManualTimeSync } from '../utils/timeSync';
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
  const seenTimeSyncRequests = useRef(new Set<string>());
  pathnameRef.current = pathname;
  searchRef.current = search;

  useEffect(() => {
    const transport = getSyncTransport();
    const unsubscribe = subscribeToSync({
      onTick: () => {
        void sendPluginViewerHeartbeat(pluginInstanceFromSearch(searchRef.current), getClassBindingInstanceId());
      },
      onRevoked: () => {
        journal('device.revoked', {}, 'warn', 'device', '设备已被撤销');
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
        if (currentBinding.selectedGradeId !== binding.gradeId || currentBinding.selectedClassId !== binding.classId) {
          journal(
            'device.binding_changed',
            { bound: !!binding.classId, management: !!binding.isManagement },
            'info',
            'device',
            '设备绑定发生变化',
          );
          updateExamSettings({ selectedGradeId: binding.gradeId, selectedClassId: binding.classId });
        }
        if (binding.isManagement && pathnameRef.current === '/exam') {
          navigate('/', { replace: true });
        }
      },
      onVersion: (version) => {
        window.dispatchEvent(new CustomEvent(CLOUD_VERSION_EVENT, { detail: { version } }));
      },
      onTimeControl: (control) => {
        const settings = getAppSettings().general.timeSync;
        if (
          settings.broadcastOffsetMs !== control.offsetMs ||
          (settings.broadcastOffsetRevision ?? 0) !== control.revision
        ) {
          updateTimeSyncSettings({ broadcastOffsetMs: control.offsetMs, broadcastOffsetRevision: control.revision });
          window.dispatchEvent(new CustomEvent('timeSync:updated'));
        }
        transport.noteTimeControlApplied(control.revision);
        if (!control.syncRequestId || seenTimeSyncRequests.current.has(control.syncRequestId)) return;
        const currentPath = pathnameRef.current;
        const canSyncHere =
          currentPath === '/' ||
          currentPath === '/exam' ||
          currentPath.startsWith('/settings') ||
          currentPath.startsWith('/admin');
        if (!canSyncHere) return;
        seenTimeSyncRequests.current.add(control.syncRequestId);
        notify('warning', '已收到全校校时请求，正在校时', '时间同步');
        void new Promise((resolve) => window.setTimeout(resolve, Math.random() * 3000))
          .then(() => runManualTimeSync())
          .then((synced) => {
            const latest = getAppSettings().general.timeSync;
            const error = synced ? '' : latest.lastError || '设备未能完成校时';
            transport.noteTimeSyncRequestResult(control.syncRequestId, synced ? 'synced' : 'failed', error, Date.now());
            notify(synced ? 'success' : 'error', synced ? '全校统一校时完成' : `全校统一校时失败：${error}`);
          });
      },
      onCommand: (command) => {
        const receipt = resolveDeviceCommandReceipt(command, '');
        if (!receipt) return;
        journal('device.command_received', { action: command.action }, 'info', 'device', '收到后台指令', command.id);
        const outcome = applyTemporaryExamCommand(command);
        journal(
          outcome.ok ? 'device.command_applied' : 'device.command_failed',
          { action: command.action },
          outcome.ok ? 'info' : 'error',
          'device',
          outcome.ok ? '后台指令执行成功' : outcome.reason,
          command.id,
        );
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
