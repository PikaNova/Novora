// 全局云端同步队列：统一限速、防抖与批处理，避免 Vercel/Neon 免费版被高频请求打爆。
// 覆盖范围：考试数据写入（examService）、设备/插件写入（classBinding）。
// 心跳类请求（sendDeviceHeartbeat / sendPluginViewerHeartbeat）不经过这里，
// 它们的调用频率已由各自定时器 + "进行中即跳过"保护好，无需排队限速。

export type SyncPriority = 'high' | 'normal';

export interface SyncQueueSnapshot {
  /** 尚未完成的同步任务数（含防抖等待中 + 排队中 + 正在发送的 1 项） */
  pendingCount: number;
  /** 当前是否有同步活动，用于指示器显示动画 */
  syncing: boolean;
  /** 当前正在提交或下一项待提交的用户可读说明 */
  currentLabel?: string;
  /** 本次批次（从空闲到再次空闲）共需提交的总项数 */
  waveTotal: number;
  /** 本次批次已完成的项数 */
  waveCompleted: number;
  /** 当前正在发送的请求是否已超过慢阈值，仍在等待响应 */
  slow: boolean;
  /** 当前请求已经耗时的毫秒数（仅在 slow 为 true 时有意义） */
  elapsedMs: number;
}

type Listener = (snapshot: SyncQueueSnapshot) => void;

const MIN_BUSINESS_INTERVAL_MS = 900; // 全局最小请求间隔（validated safe for Vercel Hobby / Neon Free）
const DEFAULT_DEBOUNCE_MS = 1000; // 防抖静默期
const DEFAULT_MAX_WAIT_MS = 6000; // 防抖最大等待上限
/** 批次窗口：上一项完成后这个时间内又有新任务进来，仍视为同一批次，不重置进度计数。*/
const WAVE_GRACE_MS = 800;
/** 单项请求超过这个时长仍未返回，就在状态栏提示“数据库响应较慢”。*/
const SLOW_THRESHOLD_MS = 4000;
/** 慢任务计时器轮询间隔，用于刷新 elapsedMs 显示。*/
const SLOW_POLL_INTERVAL_MS = 1000;

interface BusinessTask {
  priority: number; // 0 = high, 1 = normal
  key?: string;
  label?: string;
  run: () => Promise<void>;
  cancel?: () => void;
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
let currentLabel: string | undefined;
let lastBusinessSendAt = 0;
let batchDepth = 0;

// 批次进度计数状态
let waveTotal = 0;
let waveCompleted = 0;
let waveCloseTimer: ReturnType<typeof setTimeout> | null = null;

// 慢任务检测状态
let slow = false;
let slowStartedAt = 0;
let slowTimer: ReturnType<typeof setTimeout> | null = null;
let slowPollTimer: ReturnType<typeof setInterval> | null = null;

function wait(ms: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms));
}

function notifyListeners(): void {
  const snapshot = getSyncQueueSnapshot();
  listeners.forEach((listener) => listener(snapshot));
}

export function getSyncQueueSnapshot(): SyncQueueSnapshot {
  const pendingCount = debounceMap.size + businessQueue.length + inFlight;
  return {
    pendingCount,
    syncing: pendingCount > 0,
    currentLabel: currentLabel ?? businessQueue[0]?.label,
    waveTotal,
    waveCompleted,
    slow,
    elapsedMs: slow ? Date.now() - slowStartedAt : 0,
  };
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
  enterWave();
  notifyListeners();
}

/** 进入一次新的提交波次：若当前波次已结束（无待处理任务）则重置计数器，否则只增加总数。 */
function enterWave(): void {
  if (waveCloseTimer) {
    clearTimeout(waveCloseTimer);
    waveCloseTimer = null;
  }
  const pendingCount = debounceMap.size + businessQueue.length + inFlight;
  if (pendingCount === 0 && waveTotal > 0 && waveCompleted >= waveTotal) {
    waveTotal = 0;
    waveCompleted = 0;
  }
  waveTotal += 1;
}

/** 一项任务完成后调度关闭：若短时间内（WAVE_GRACE_MS）没有新任务进来，则认为本次波次结束，重置进度。 */
function scheduleWaveClose(): void {
  if (waveCloseTimer) clearTimeout(waveCloseTimer);
  waveCloseTimer = setTimeout(() => {
    const pendingCount = debounceMap.size + businessQueue.length + inFlight;
    if (pendingCount === 0) {
      waveTotal = 0;
      waveCompleted = 0;
      notifyListeners();
    }
    waveCloseTimer = null;
  }, WAVE_GRACE_MS);
}

function startSlowTimer(): void {
  stopSlowTimer();
  slowTimer = setTimeout(() => {
    slow = true;
    slowStartedAt = Date.now() - SLOW_THRESHOLD_MS;
    notifyListeners();
    slowPollTimer = setInterval(() => notifyListeners(), SLOW_POLL_INTERVAL_MS);
  }, SLOW_THRESHOLD_MS);
}

function stopSlowTimer(): void {
  if (slowTimer) {
    clearTimeout(slowTimer);
    slowTimer = null;
  }
  if (slowPollTimer) {
    clearInterval(slowPollTimer);
    slowPollTimer = null;
  }
  if (slow) {
    slow = false;
    slowStartedAt = 0;
  }
}

/**
 * 全局限速 + 优先级排队执行：替代原先分别独立的"考试写入队列"和"设备写入队列"，
 * 保证所有云端写入共享同一个最小请求间隔，不再相互抢跑触发并发峰值。
 */
export function runQueued<T>(
  task: () => Promise<T>,
  opts: { priority?: SyncPriority; key?: string; label?: string; supersededValue?: T } = {},
): Promise<T> {
  const priority = opts.priority === 'high' ? 0 : 1;
  enterWave();
  return new Promise<T>((resolve, reject) => {
    if (opts.key && opts.supersededValue !== undefined) {
      for (let index = businessQueue.length - 1; index >= 0; index -= 1) {
        const queued = businessQueue[index];
        if (queued.key !== opts.key) continue;
        businessQueue.splice(index, 1);
        queued.cancel?.();
      }
    }
    businessQueue.push({
      priority,
      key: opts.key,
      label: opts.label,
      run: async () => {
        try {
          resolve(await task());
        } catch (error) {
          reject(error);
        }
      },
      cancel: opts.supersededValue !== undefined
        ? () => resolve(opts.supersededValue as T)
        : undefined,
    });
    businessQueue.sort((a, b) => a.priority - b.priority);
    notifyListeners();
    void dispatch();
  });
}

/**
 * 仅供单元测试使用：把本模块的全部内部状态（队列、监听者、定时器、批次/慢任务计数）
 * 重置到初始值。生产代码从不调用这个函数——本模块是进程内单例，多个测试用例之间
 * 如果不重置会互相污染状态。
 */
export function __resetSyncQueueForTests(): void {
  listeners.clear();
  businessQueue.length = 0;
  debounceMap.forEach((entry) => clearTimeout(entry.timer));
  debounceMap.clear();
  deferredInBatch.clear();
  dispatching = false;
  inFlight = 0;
  currentLabel = undefined;
  lastBusinessSendAt = 0;
  batchDepth = 0;
  waveTotal = 0;
  waveCompleted = 0;
  if (waveCloseTimer) {
    clearTimeout(waveCloseTimer);
    waveCloseTimer = null;
  }
  slow = false;
  slowStartedAt = 0;
  if (slowTimer) {
    clearTimeout(slowTimer);
    slowTimer = null;
  }
  if (slowPollTimer) {
    clearInterval(slowPollTimer);
    slowPollTimer = null;
  }
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
      currentLabel = next.label;
      notifyListeners();
      startSlowTimer();
      await next.run();
      stopSlowTimer();
      lastBusinessSendAt = Date.now();
      inFlight = 0;
      currentLabel = undefined;
      waveCompleted += 1;
      notifyListeners();
      scheduleWaveClose();
    }
  } finally {
    dispatching = false;
    notifyListeners();
  }
}
