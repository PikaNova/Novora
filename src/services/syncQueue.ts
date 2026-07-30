// 全局云端同步队列：统一限速、防抖与批处理，避免 Vercel/Neon 免费版被高频请求打爆。
// 覆盖范围：考试数据写入（examService）、设备/插件写入（classBinding）。
// 心跳类请求（sendDeviceHeartbeat / sendPluginViewerHeartbeat）不经过这里，
// 它们的调用频率已由各自定时器 + "进行中即跳过" 保护好，无需排队限速。

export type SyncPriority = 'high' | 'normal';

export interface SyncQueueSnapshot {
  /** 尚未完成的同步任务数（含防抖等待中 + 排队中 + 正在发送的 1 项） */
  pendingCount: number;
  /** 当前是否有同步活动，用于指示器显示动画 */
  syncing: boolean;
}

type Listener = (snapshot: SyncQueueSnapshot) => void;

const MIN_BUSINESS_INTERVAL_MS = 900; // 全局最小请求间隔（validated safe for Vercel Hobby / Neon Free）
const DEFAULT_DEBOUNCE_MS = 1000; // 防抖静默期
const DEFAULT_MAX_WAIT_MS = 6000; // 防抖最大等待上限

interface BusinessTask {
  priority: number; // 0 = high, 1 = normal
  run: () => Promise<void>;
}

interface DebounceEntry {
  timer: ReturnType<typeof setTimeout>;
  firstQueuedAt: number;
  flush: () => void;
}

const listeners = new Set<Listener>();
const businessQueue: BusinessTask[] = [];
const debounceMap = new Map<string, DebounceEntry>();
const deferredInBatch = new Set<string>();

let dispatching = false;
let inFlight = 0;
let lastBusinessSendAt = 0;
let batchDepth = 0;

function wait(ms: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms));
}

function notifyListeners(): void {
  const snapshot = getSyncQueueSnapshot();
  listeners.forEach((listener) => listener(snapshot));
}

export function getSyncQueueSnapshot(): SyncQueueSnapshot {
  const pendingCount = debounceMap.size + businessQueue.length + inFlight;
  return { pendingCount, syncing: pendingCount > 0 };
}

export function subscribeSyncQueue(listener: Listener): () => void {
  listeners.add(listener);
  listener(getSyncQueueSnapshot());
  return () => listeners.delete(listener);
}

/** 批量操作开始：期间被触发的防抖任务会推迟到 endBatch 时统一放入发送队列，避免逐项排队刷屏。 */
export function beginBatch(): void {
  batchDepth += 1;
}

/** 批量操作结束：把期间被推迟的防抖任务一次性放入发送队列（仍受全局限速与优先级约束）。 */
export function endBatch(): void {
  batchDepth = Math.max(0, batchDepth - 1);
  if (batchDepth === 0 && deferredInBatch.size) {
    const keys = [...deferredInBatch];
    deferredInBatch.clear();
    keys.forEach(flushDebounce);
  }
}

function flushDebounce(key: string): void {
  const entry = debounceMap.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  debounceMap.delete(key);
  entry.flush();
}

/**
 * 防抖调度：把同一个 key 的多次触发合并为一次 flush 调用。
 * - 静默期内没有新触发才会真正 flush；
 * - 即使持续触发，也保证 maxWaitMs 后强制 flush 一次；
 * - 处于 beginBatch()/endBatch() 之间时，flush 会推迟到 endBatch()。
 */
export function scheduleDebounced(
  key: string,
  flush: () => void,
  opts: { debounceMs?: number; maxWaitMs?: number } = {},
): void {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const existing = debounceMap.get(key);
  if (existing) clearTimeout(existing.timer);
  const firstQueuedAt = existing?.firstQueuedAt ?? Date.now();
  const remainingToMax = maxWaitMs - (Date.now() - firstQueuedAt);
  const delay = Math.max(0, Math.min(debounceMs, remainingToMax));
  const timer = setTimeout(() => {
    if (batchDepth > 0) {
      deferredInBatch.add(key);
      return;
    }
    flushDebounce(key);
  }, delay);
  debounceMap.set(key, { timer, firstQueuedAt, flush });
  if (batchDepth > 0) deferredInBatch.add(key);
  notifyListeners();
}

/**
 * 全局限速 + 优先级排队执行：替代原先分别独立的"考试写入队列"和"设备写入队列"，
 * 保证所有云端写入共享同一个最小请求间隔，不再相互抢跑触发并发峰值。
 */
export function runQueued<T>(
  task: () => Promise<T>,
  opts: { priority?: SyncPriority } = {},
): Promise<T> {
  const priority = opts.priority === 'high' ? 0 : 1;
  return new Promise<T>((resolve, reject) => {
    businessQueue.push({
      priority,
      run: async () => {
        try {
          resolve(await task());
        } catch (error) {
          reject(error);
        }
      },
    });
    businessQueue.sort((a, b) => a.priority - b.priority);
    notifyListeners();
    void dispatch();
  });
}

async function dispatch(): Promise<void> {
  if (dispatching) return;
  dispatching = true;
  try {
    while (businessQueue.length > 0) {
      const next = businessQueue.shift()!;
      const elapsed = Date.now() - lastBusinessSendAt;
      if (elapsed < MIN_BUSINESS_INTERVAL_MS) await wait(MIN_BUSINESS_INTERVAL_MS - elapsed);
      inFlight = 1;
      notifyListeners();
      await next.run();
      lastBusinessSendAt = Date.now();
      inFlight = 0;
      notifyListeners();
    }
  } finally {
    dispatching = false;
    notifyListeners();
  }
}
