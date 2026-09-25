import { ANNOUNCEMENT_SEEN_MIN_MS, type AnnouncementSeenItem } from '../shared/examAnnouncementContracts.js';

/**
 * 大屏公告的"看过"计时器（回执口径：累计展示满 3 秒才算已读）。
 *
 * 一次会话里的上报规则：
 * - 累计展示跨过门槛（默认 3 秒）时立刻上报一次，让管理端尽快看到回执；
 * - 之后继续留在屏幕上，关闭/卸载时把新增的时长再补报一次（不足门槛就不报）。
 * 于是长停留不会只在 3 秒处定格，`seen_ms` 反映真实停留，`seen_count` 是本会话的上报次数。
 *
 * 计时只在"卡片确实可见且标签页在前台"时累加，滚动路过、切到后台、屏幕锁屏都不算已读。
 */
export type SeenTracker = {
  /** 可见状态变化（滚动进/出视野、切前台/后台）。 */
  setVisible(visible: boolean): void;
  /** 关闭窗口 / 组件卸载：停表并补报增量。 */
  dispose(): void;
  /** 便于测试与调试：当前累计时长与是否已经上报过。 */
  snapshot(): { id: string; pendingMs: number; reported: boolean };
};

export type SeenTrackerOptions = {
  id: string;
  onSeen: (item: AnnouncementSeenItem) => void;
  minMs?: number;
  now?: () => number;
};

export function createSeenTracker({
  id,
  onSeen,
  minMs = ANNOUNCEMENT_SEEN_MIN_MS,
  now = Date.now,
}: SeenTrackerOptions): SeenTracker {
  /** 当前这段连续可见的起点；null 表示现在不可见。 */
  let visibleSince: number | null = null;
  /** 已经停表、但还没上报的时长。 */
  let unreported = 0;
  let reported = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const current = () => (visibleSince == null ? 0 : Math.max(0, now() - visibleSince));
  const pending = () => unreported + current();
  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  /** 把正在计时的一段结算进 unreported，同时保持继续计时。 */
  const settle = () => {
    if (visibleSince == null) return;
    const at = now();
    unreported += Math.max(0, at - visibleSince);
    visibleSince = at;
  };
  const reportPending = () => {
    if (unreported < minMs) return;
    const seenMs = unreported;
    unreported = 0;
    reported = true;
    clearTimer();
    onSeen({ id, seenMs });
  };
  const scheduleThreshold = () => {
    clearTimer();
    if (reported || visibleSince == null) return;
    const need = minMs - pending();
    if (need <= 0) {
      settle();
      reportPending();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      if (visibleSince == null) return;
      settle();
      reportPending();
    }, need);
  };

  return {
    setVisible(visible: boolean) {
      if (visible) {
        if (visibleSince != null) return;
        visibleSince = now();
        scheduleThreshold();
        return;
      }
      if (visibleSince == null) {
        // 本来就不可见：仍然把欠着的增量报掉（例如切后台后关闭窗口）。
        reportPending();
        return;
      }
      settle();
      visibleSince = null;
      clearTimer();
      reportPending();
    },
    dispose() {
      if (visibleSince != null) {
        settle();
        visibleSince = null;
      }
      clearTimer();
      reportPending();
    },
    snapshot() {
      return { id, pendingMs: pending(), reported };
    },
  };
}
