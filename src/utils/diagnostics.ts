/**
 * 静默上报用的运行时诊断快照。
 *
 * 起因：错误上报过去只带错误本身（message/stack/route），作者端拿到的信息不足以判断
 * 「出错前用户做了什么、当时网络与同步处于什么状态、装的是哪个构建」。这里统一采集
 * 三类信息，全部只含计数、枚举与脱敏后的短文本，不含考试内容与学生信息：
 *
 * - 事件序列（breadcrumbs）：路由切换、接口成败、同步批次、在线/离线、页面可见性；
 * - 网络快照：在线状态、连接类型与 RTT、离网时长、失败与慢请求计数；
 * - 应用快照：排考模式、初始化阶段、周测计划数、可见班级数、本地存储占用、PWA/SW 状态。
 */
import { getAppSettings } from './appSettings';
import { getDiagnosticCaptureConfig, getLocalLogEntries } from './logger';
import { getSyncQueueSnapshot, subscribeSyncQueue } from '../services/syncQueue';
import { examSaveMetricsContext } from '../services/examSaveMetrics';
import type { ErrorReportContext } from '../shared/errorReportContracts';

export type DiagnosticLevel = 'info' | 'warn' | 'error';

const BREADCRUMB_KEY = 'novora_breadcrumbs_v1';
const MAX_BREADCRUMBS = 40;
const BREADCRUMB_TTL_MS = 30 * 60 * 1000;
const MAX_EVENT_LENGTH = 60;
const MAX_DETAIL_LENGTH = 160;

interface Breadcrumb {
  at: number;
  event: string;
  detail?: string;
  level?: DiagnosticLevel;
}

interface RuntimeState {
  startedAt: number;
  online: boolean;
  offlineSince: number;
  visible: boolean;
  hiddenTotalMs: number;
  hiddenSince: number;
  failedRequests: number;
  slowRequests: number;
  lastApi: { at: number; status: number | null; durationMs: number } | null;
}

const runtime: RuntimeState = {
  startedAt: Date.now(),
  online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  offlineSince: 0,
  visible: typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
  hiddenTotalMs: 0,
  hiddenSince: 0,
  failedRequests: 0,
  slowRequests: 0,
  lastApi: null,
};

let started = false;
const recentApiEvents = new Map<string, number>();
const API_EVENT_DEDUPE_MS = 10_000;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function clip(value: unknown, max: number): string | null {
  if (value == null) return null;
  const text = String(value)
    // eslint-disable-next-line no-control-regex -- security boundary for untrusted runtime text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, max) : null;
}

function readBreadcrumbs(): Breadcrumb[] {
  const raw = storage()?.getItem(BREADCRUMB_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - BREADCRUMB_TTL_MS;
    return parsed
      .filter((item): item is Breadcrumb => {
        const row = item as Partial<Breadcrumb> | null;
        return !!row && typeof row.event === 'string' && Number.isFinite(row.at) && Number(row.at) >= cutoff;
      })
      .slice(-MAX_BREADCRUMBS);
  } catch {
    return [];
  }
}

function writeBreadcrumbs(rows: Breadcrumb[]): void {
  try {
    storage()?.setItem(BREADCRUMB_KEY, JSON.stringify(rows.slice(-MAX_BREADCRUMBS)));
  } catch {
    // 存储不可用（隐私模式/配额满）时只丢事件序列，不影响上报本身。
  }
}

let breadcrumbs: Breadcrumb[] | null = null;

function allBreadcrumbs(): Breadcrumb[] {
  if (!breadcrumbs) breadcrumbs = readBreadcrumbs();
  return breadcrumbs;
}

/** 记录一条出错前后的事件序列。任何字段都会被截断，调用方不需要自己兜底。 */
export function recordDiagnosticEvent(event: string, detail?: unknown, level: DiagnosticLevel = 'info'): void {
  const safeEvent = clip(event, MAX_EVENT_LENGTH);
  if (!safeEvent) return;
  const safeDetail = clip(detail, MAX_DETAIL_LENGTH);
  const rows = allBreadcrumbs();
  rows.push({ at: Date.now(), event: safeEvent, ...(safeDetail ? { detail: safeDetail } : {}), level });
  if (rows.length > MAX_BREADCRUMBS) rows.splice(0, rows.length - MAX_BREADCRUMBS);
  writeBreadcrumbs(rows);
}

/** 最近的事件序列（含本地日志里已有的校时等记录），供上报使用。 */
export function getDiagnosticBreadcrumbs(limit = MAX_BREADCRUMBS): ErrorReportContext[] {
  const rows = allBreadcrumbs()
    .slice(-limit)
    .map((row) => {
      const item: ErrorReportContext = { at: row.at, event: row.event };
      if (row.detail) item.detail = row.detail;
      if (row.level) item.level = row.level;
      return item;
    });
  // 本地日志（校时、设置读写失败等）也补进时间线，按时间排序后取最近的若干条。
  for (const entry of getLocalLogEntries(Date.now() - BREADCRUMB_TTL_MS).slice(-10)) {
    const message = clip(entry.message, MAX_DETAIL_LENGTH);
    if (!message) continue;
    rows.push({ at: entry.at, event: `log.${entry.level}`, detail: message });
  }
  return rows.sort((a, b) => Number(a.at) - Number(b.at)).slice(-limit);
}

export function __resetDiagnosticsForTests(): void {
  breadcrumbs = [];
  runtime.startedAt = Date.now();
  runtime.online = true;
  runtime.offlineSince = 0;
  runtime.visible = true;
  runtime.hiddenTotalMs = 0;
  runtime.hiddenSince = 0;
  runtime.failedRequests = 0;
  runtime.slowRequests = 0;
  runtime.lastApi = null;
  started = false;
  try {
    storage()?.removeItem(BREADCRUMB_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 接口调用结果：失败与慢请求计入快照；失败的读请求、所有写请求写入事件序列。
 * 写请求是「用户动作」的最直接代理（保存考试、绑定设备、导入导出都走这里），
 * 因此即使成功也记一条；同键短时间去重，避免轮询与重试刷屏。
 */
export function noteApiResult(input: {
  endpoint: string;
  status: number | null;
  durationMs: number;
  ok: boolean;
  method?: string;
  slowMs?: number;
}): void {
  const durationMs = Number.isFinite(input.durationMs) ? Math.max(0, Math.round(input.durationMs)) : 0;
  const endpoint = clip(input.endpoint, MAX_DETAIL_LENGTH);
  const method = String(input.method || 'GET').toUpperCase();
  const write = method !== 'GET' && method !== 'HEAD';
  runtime.lastApi = { at: Date.now(), status: input.status, durationMs };
  if (!input.ok) runtime.failedRequests += 1;
  const slow = durationMs >= (input.slowMs ?? 4_000);
  if (slow) runtime.slowRequests += 1;
  // 成功的读请求不记（轮询会淹没时间线），成功的写请求记一条。
  if (input.ok && !slow && !write) return;
  const status = input.status == null ? 'network' : String(input.status);
  const event = !input.ok ? 'api.fail' : write ? 'api.write' : 'api.slow';
  // 失败：同 endpoint+status 十秒一条（离网时会连续失败）；写成功：同请求两秒一条。
  const dedupeMs = input.ok ? 2_000 : API_EVENT_DEDUPE_MS;
  const dedupeKey = `${event}|${method}|${endpoint}|${status}`;
  const now = Date.now();
  const last = recentApiEvents.get(dedupeKey) || 0;
  if (now - last < dedupeMs) return;
  recentApiEvents.set(dedupeKey, now);
  if (recentApiEvents.size > 80) {
    for (const [key, at] of recentApiEvents) if (now - at > API_EVENT_DEDUPE_MS) recentApiEvents.delete(key);
  }
  recordDiagnosticEvent(
    event,
    `${method} ${endpoint || 'unknown'} · ${status} · ${durationMs}ms`,
    input.ok ? (write ? 'info' : 'warn') : 'error',
  );
}

/**
 * 业务动作埋点：业务代码只需一行 `recordUserAction('保存周测')`。
 * 不要传考试内容、班级名或学生信息，只写动作本身。
 */
export function recordUserAction(label: string): void {
  recordDiagnosticEvent('ui.action', label);
}

export function collectNetworkState(): ErrorReportContext {
  const now = Date.now();
  const connection = (
    typeof navigator === 'undefined'
      ? undefined
      : (
          navigator as Navigator & {
            connection?: { effectiveType?: string; rtt?: number; downlink?: number; saveData?: boolean };
          }
        ).connection
  ) as { effectiveType?: string; rtt?: number; downlink?: number; saveData?: boolean } | undefined;
  const hiddenTotalMs =
    runtime.hiddenTotalMs + (runtime.visible || !runtime.hiddenSince ? 0 : now - runtime.hiddenSince);
  const state: ErrorReportContext = {
    online: runtime.online,
    visible: runtime.visible,
    sinceLoadMs: now - runtime.startedAt,
    hiddenTotalMs: Math.round(hiddenTotalMs),
    offlineForMs: runtime.online || !runtime.offlineSince ? 0 : now - runtime.offlineSince,
    failedRequests: runtime.failedRequests,
    slowRequests: runtime.slowRequests,
  };
  if (connection?.effectiveType) state.effectiveType = connection.effectiveType;
  if (typeof connection?.rtt === 'number') state.rttMs = connection.rtt;
  if (typeof connection?.downlink === 'number') state.downlinkMbps = connection.downlink;
  if (typeof connection?.saveData === 'boolean') state.saveData = connection.saveData;
  if (runtime.lastApi) {
    state.lastApiStatus = runtime.lastApi.status ?? 0;
    state.lastApiAgoMs = now - runtime.lastApi.at;
    state.lastApiMs = runtime.lastApi.durationMs;
  }
  return state;
}

export function collectSyncState(): ErrorReportContext | null {
  try {
    const snapshot = getSyncQueueSnapshot();
    return {
      pendingCount: snapshot.pendingCount,
      syncing: snapshot.syncing,
      slow: snapshot.slow,
      elapsedMs: snapshot.elapsedMs,
      waveTotal: snapshot.waveTotal,
      waveCompleted: snapshot.waveCompleted,
      // 保存通道的累计指标（提交次数、字节分位、冲突域分布）：作者端据此判断提交瘦身与
      // 域级版本在真实学校里的效果，不必再靠开发者控制台。
      ...examSaveMetricsContext(),
    };
  } catch {
    return null;
  }
}

function localDataKb(): number | null {
  const store = storage();
  if (!store) return null;
  try {
    let bytes = 0;
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (!key) continue;
      bytes += key.length + (store.getItem(key)?.length || 0);
    }
    return Math.round(bytes / 1024);
  } catch {
    return null;
  }
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/** 应用状态快照：排考模式、初始化阶段与各类计数。 */
export function collectAppContext(): ErrorReportContext {
  const context: ErrorReportContext = {
    captureEnabled: getDiagnosticCaptureConfig().captureOnError,
    standalone: isStandalonePwa(),
    swActive: typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !!navigator.serviceWorker.controller,
    sinceLoadMs: Date.now() - runtime.startedAt,
  };
  const storageKb = localDataKb();
  if (storageKb != null) context.storageUsedKb = storageKb;
  try {
    const exam = getAppSettings().exam;
    const plans = Array.isArray(exam.weeklyPlans) ? exam.weeklyPlans : [];
    context.mode = String(exam.scheduleMode || 'unknown');
    context.stage = exam.initialization?.schoolName ? 'ready' : 'setup';
    context.plansTotal = plans.length;
    context.plansEnabled = plans.filter((plan) => plan.enabled).length;
    context.itemsEnabled = exam.items.filter((item) => item.enabled).length;
    context.seriesTotal = exam.majors.length;
    context.scopeGroups = exam.classes.length;
  } catch {
    context.stage = 'unknown';
  }
  return context;
}

/** 在应用启动时调用一次：登记在线/可见性变化与同步队列状态。 */
export function startDiagnosticTracking(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  allBreadcrumbs();

  window.addEventListener('online', () => {
    const offlineMs = runtime.offlineSince ? Date.now() - runtime.offlineSince : 0;
    runtime.online = true;
    runtime.offlineSince = 0;
    recordDiagnosticEvent('net.online', `离线 ${Math.round(offlineMs / 1000)}s`);
  });
  window.addEventListener('offline', () => {
    runtime.online = false;
    runtime.offlineSince = Date.now();
    recordDiagnosticEvent('net.offline', undefined, 'warn');
  });
  document.addEventListener('visibilitychange', () => {
    const now = Date.now();
    const visible = document.visibilityState !== 'hidden';
    if (visible === runtime.visible) return;
    if (visible) {
      runtime.hiddenTotalMs += runtime.hiddenSince ? now - runtime.hiddenSince : 0;
      runtime.hiddenSince = 0;
      recordDiagnosticEvent('page.visible', `隐藏 ${Math.round(runtime.hiddenTotalMs / 1000)}s`);
    } else {
      runtime.hiddenSince = now;
    }
    runtime.visible = visible;
  });

  // 同步批次只记「开始 / 变慢 / 排空」三种状态迁移，避免队列每次计数变化都写一条。
  let lastPending = -1;
  let lastSlow = false;
  try {
    subscribeSyncQueue((snapshot) => {
      if (snapshot.slow && !lastSlow) recordDiagnosticEvent('sync.slow', `在途 ${snapshot.elapsedMs}ms`, 'warn');
      if (lastPending <= 0 && snapshot.pendingCount > 0) {
        recordDiagnosticEvent(
          'sync.start',
          `${snapshot.pendingCount} 项待提交${snapshot.currentLabel ? ` · ${snapshot.currentLabel}` : ''}`,
        );
      } else if (lastPending > 0 && snapshot.pendingCount === 0) {
        recordDiagnosticEvent(
          'sync.done',
          `批次 ${snapshot.waveCompleted}/${snapshot.waveTotal || snapshot.waveCompleted}`,
        );
      }
      lastPending = snapshot.pendingCount;
      lastSlow = snapshot.slow;
    });
  } catch {
    // 同步队列不可用时只影响时间线，不影响上报。
  }
}
