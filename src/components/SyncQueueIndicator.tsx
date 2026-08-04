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
        // 波次进度：本次提交波次内已完成 waveCompleted 项，共 waveTotal 项。
        // 比起仅看瞬时队列长度，这个计数不会因为逐项防抖提交而被重置成“最后 1 项”。
        const total = Math.max(snapshot.waveTotal, snapshot.waveCompleted + 1);
        const currentIndex = Math.min(snapshot.waveCompleted + 1, total);
        const progressLabel = `第 ${currentIndex}/${total} 项`;
        const currentLabel = snapshot.currentLabel?.trim();
        const remainingHint =
          total > 1 ? `共 ${total} 项，已完成 ${snapshot.waveCompleted} 项。` : "完成后会自动关闭提醒。";
        const slowHint = snapshot.slow
          ? ` 数据库响应较慢，已等待 ${Math.round(snapshot.elapsedMs / 1000)}s，仍在重试。`
          : "";
        notify(
          "warning",
          (currentLabel ? `${currentLabel}。${remainingHint}` : `正在按顺序提交云端数据，${remainingHint}`) + slowHint,
          `云端提交中 · ${progressLabel}${snapshot.slow ? " · 响应较慢" : ""}`,
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
