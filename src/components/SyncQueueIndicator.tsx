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
        notify(
          "warning",
          snapshot.pendingCount > 1
            ? `正在提交：还有 ${snapshot.pendingCount} 项待提交，请等待完成后再关闭页面。`
            : "正在提交云端数据，请等待完成后再关闭页面。",
          "云端提交中",
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
