import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import {
  getSyncQueueSnapshot,
  subscribeSyncQueue,
  type SyncQueueSnapshot,
} from "../services/syncQueue";
import "../styles/sync-queue-indicator.css";

/** 显示在后台弹窗右上角，仅在同步进行中出现。 */
export default function SyncQueueIndicator() {
  const [snapshot, setSnapshot] = useState<SyncQueueSnapshot>(() =>
    getSyncQueueSnapshot(),
  );

  useEffect(() => subscribeSyncQueue(setSnapshot), []);

  if (!snapshot.syncing) return null;

  return (
    <div className="sync-queue-badge" role="status" aria-live="polite">
      <span className="sync-queue-badge__pulse" aria-hidden="true" />
      <LoaderCircle className="sync-queue-badge__icon" size={13} aria-hidden="true" />
      <span className="sync-queue-badge__text">
        {snapshot.pendingCount > 1 ? `同步中 · ${snapshot.pendingCount} 项` : "同步中…"}
      </span>
    </div>
  );
}
