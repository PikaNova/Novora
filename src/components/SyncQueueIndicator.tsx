import { useEffect, useRef } from "react";
import {
  getSyncQueueSnapshot,
  subscribeSyncQueue,
  type SyncQueueSnapshot,
} from "../services/syncQueue";
import { dismissNotice, notify } from "../services/notify";

const SYNC_QUEUE_NOTICE_ID = "sync-queue-indicator";
const SYNC_QUEUE_DURATION_MS = 24 * 60 * 60 * 1000;

export default function SyncQueueIndicator() {
  const wasSyncingRef = useRef(false);

  useEffect(() => {
    const handle = (snapshot: SyncQueueSnapshot) => {
      if (snapshot.syncing) {
        const pendingLabel = snapshot.pendingCount > 1
          ? `剩余 ${snapshot.pendingCount} 项`
          : "正在提交最后 1 项";
        const currentLabel = snapshot.currentLabel?.trim();
        notify(
          "warning",
          currentLabel
            ? `${currentLabel}。${snapshot.pendingCount > 1 ? `${snapshot.pendingCount} 项待完成。` : "完成后会自动关闭提醒。"}`
            : snapshot.pendingCount > 1
              ? `正在按顺序提交云端数据，${snapshot.pendingCount} 项待完成。`
              : "正在提交云端数据，完成后会自动关闭提醒。",
          `云端提交中 · ${pendingLabel}`,
          { id: SYNC_QUEUE_NOTICE_ID, variant: "queue", durationMs: SYNC_QUEUE_DURATION_MS },
        );
      } else if (wasSyncingRef.current) {
        dismissNotice(SYNC_QUEUE_NOTICE_ID);
      }
      wasSyncingRef.current = snapshot.syncing;
    };

    handle(getSyncQueueSnapshot());
    return subscribeSyncQueue(handle);
  }, []);

  return null;
}
