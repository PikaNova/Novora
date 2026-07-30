import { useEffect, useState } from "react";
import { LoaderCircle, CheckCircle2 } from "lucide-react";
import {
  getSyncQueueSnapshot,
  subscribeSyncQueue,
  type SyncQueueSnapshot,
} from "../services/syncQueue";
import "../styles/sync-queue-indicator.css";

/**
 * 全局云端同步队列状态指示器：显示在触发云端写入的弹窗内，
 * 复用统一的 syncQueue 状态，无需每个弹窗各自维护同步提示文案。
 */
export default function SyncQueueIndicator() {
  const [snapshot, setSnapshot] = useState<SyncQueueSnapshot>(() =>
    getSyncQueueSnapshot(),
  );

  useEffect(() => subscribeSyncQueue(setSnapshot), []);

  return (
    <div
      className={`sync-queue-indicator${snapshot.syncing ? " is-syncing" : " is-idle"}`}
      role="status"
      aria-live="polite"
    >
      {snapshot.syncing ? (
        <LoaderCircle
          className="sync-queue-indicator__icon is-spinning"
          size={14}
          aria-hidden="true"
        />
      ) : (
        <CheckCircle2
          className="sync-queue-indicator__icon"
          size={14}
          aria-hidden="true"
        />
      )}
      <span className="sync-queue-indicator__text">
        {snapshot.syncing
          ? snapshot.pendingCount > 1
            ? `正在同步云端 · 剩余 ${snapshot.pendingCount} 项`
            : "正在同步云端…"
          : "已全部同步"}
      </span>
    </div>
  );
}
