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
  const [globalBusy, setGlobalBusy] = useState(false);
  const [globalError, setGlobalError] = useState('');

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
            setGlobalError('');
          }
        })
        .catch((error: unknown) => {
          if (alive) setGlobalError(error instanceof Error ? error.message : String(error));
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
    setGlobalBusy(true);
    setGlobalError('');
    try {
      await requestGlobalTimeSync();
      setGlobalControl(await getGlobalTimeControl());
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : String(error));
    } finally {
      setGlobalBusy(false);
    }
  };

  const saveBroadcastOffset = async (seconds: number) => {
    setGlobalBusy(true);
    setGlobalError('');
    try {
      await saveGlobalTimeOffset(Math.round(seconds * 1000));
      setGlobalControl(await getGlobalTimeControl());
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : String(error));
    } finally {
      setGlobalBusy(false);
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
    globalBusy,
    globalError,
    syncAllClients,
    saveBroadcastOffset,
  };
}
