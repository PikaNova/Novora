import { useEffect, useState } from "react";
import {
  getAppSettings,
  updateTimeSyncSettings,
} from "../../utils/appSettings";
import type { TimeSyncSettings } from "../../utils/appSettings";
import { isTimeSyncReady, formatDateTimeInZone } from "../../utils/timeSource";

export function useTimeSyncSettings() {
  const [ts, setTs] = useState<TimeSyncSettings>(
    () => getAppSettings().general.timeSync,
  );
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const onUpd = () => {
      setTs(getAppSettings().general.timeSync);
      setSyncing(false);
    };
    window.addEventListener("timeSync:updated", onUpd as EventListener);
    return () =>
      window.removeEventListener("timeSync:updated", onUpd as EventListener);
  }, []);

  const patchTs = (p: Partial<TimeSyncSettings>, reschedule = false) => {
    updateTimeSyncSettings(p);
    setTs(getAppSettings().general.timeSync);
    if (reschedule)
      window.dispatchEvent(new CustomEvent("timeSync:reschedule"));
  };

  const syncNow = () => {
    setSyncing(true);
    window.dispatchEvent(new CustomEvent("timeSync:syncNow"));
    window.setTimeout(() => setSyncing(false), 8000);
  };

  const ready = isTimeSyncReady();
  const lastSyncLabel =
    ts.lastSyncAt > 0 ? formatDateTimeInZone(ts.lastSyncAt) : "尚未校时";

  return { ts, syncing, ready, lastSyncLabel, patchTs, syncNow };
}
