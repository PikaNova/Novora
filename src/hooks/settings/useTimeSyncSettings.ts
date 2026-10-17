import { useEffect, useState } from 'react';
import { getAppSettings, updateTimeSyncSettings } from '../../utils/appSettings';
import type { TimeSyncSettings } from '../../utils/appSettings';
import { isTimeSyncReady, formatDateTimeInZone } from '../../utils/timeSource';
import {
  getGlobalTimeControl,
  requestGlobalTimeSync,
  saveGlobalTimeOffset,
  type GlobalTimeControl,
} from '../../services/timeControl';

export function useTimeSyncSettings() {
  const [ts, setTs] = useState<TimeSyncSettings>(() => getAppSettings().general.timeSync);
  const [syncing, setSyncing] = useState(false);
  const [globalControl, setGlobalControl] = useState<GlobalTimeControl | null>(null);
  const [globalAction, setGlobalAction] = useState<'syncing-clients' | 'saving-offset' | null>(null);
  const [globalLoadError, setGlobalLoadError] = useState('');
  const [offsetError, setOffsetError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [offsetSaveNotice, setOffsetSaveNotice] = useState('');
  const [syncNotice, setSyncNotice] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);

  useEffect(() => {
    const onUpd = () => {
      setTs(getAppSettings().general.timeSync);
      setSyncing(false);
    };
    window.addEventListener('timeSync:updated', onUpd as EventListener);
    return () => window.removeEventListener('timeSync:updated', onUpd as EventListener);
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void getGlobalTimeControl()
        .then((value) => {
          if (alive) {
            setGlobalControl(value);
            setGlobalLoadError('');
          }
        })
        .catch((error: unknown) => {
          if (alive) setGlobalLoadError(error instanceof Error ? error.message : String(error));
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const patchTs = (p: Partial<TimeSyncSettings>, reschedule = false) => {
    updateTimeSyncSettings(p);
    setTs(getAppSettings().general.timeSync);
    if (reschedule) window.dispatchEvent(new CustomEvent('timeSync:reschedule'));
  };

  const syncNow = () => {
    setSyncing(true);
    window.dispatchEvent(new CustomEvent('timeSync:syncNow'));
    window.setTimeout(() => setSyncing(false), 8000);
  };

  const syncAllClients = async () => {
    setGlobalAction('syncing-clients');
    setSyncError('');
    setSyncNotice('');
    setSyncBusy(true);
    try {
      await requestGlobalTimeSync();
      setGlobalControl(await getGlobalTimeControl());
      setSyncNotice('校时任务已下发，客户端正在执行并返回结果。');
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setGlobalAction(null);
      setSyncBusy(false);
    }
  };

  const saveBroadcastOffset = async (seconds: number) => {
    setGlobalAction('saving-offset');
    setOffsetError('');
    setOffsetSaveNotice('');
    try {
      await saveGlobalTimeOffset(Math.round(seconds * 1000));
      setGlobalControl(await getGlobalTimeControl());
      setOffsetSaveNotice('已保存到服务器；客户端将在下一次心跳时应用。');
      return true;
    } catch (error) {
      setOffsetError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setGlobalAction(null);
    }
  };

  const ready = isTimeSyncReady();
  const lastSyncLabel =
    ts.lastSyncServerAt && ts.lastSyncServerAt > 0
      ? formatDateTimeInZone(ts.lastSyncServerAt)
      : ts.lastSyncAt > 0
        ? formatDateTimeInZone(ts.lastSyncAt)
        : '尚未校时';

  return {
    ts,
    syncing,
    ready,
    lastSyncLabel,
    patchTs,
    syncNow,
    globalControl,
    globalBusy: globalAction !== null,
    globalAction,
    syncBusy,
    globalLoadError,
    offsetError,
    syncError,
    offsetSaveNotice,
    syncNotice,
    syncAllClients,
    saveBroadcastOffset,
  };
}
