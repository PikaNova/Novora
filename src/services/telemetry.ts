// 客户端遥测服务
// - 仅在用户「同意」后上报；密钥内嵌于服务端 /api/telemetry，浏览器侧不接触密钥
// - 上报数据：实例ID、事件、版本、主机、时区、语言、UA、客户端时间戳（地区/IP哈希由服务端补全）

import { getAppSettings } from '../utils/appSettings';

const CONSENT_KEY = 'telemetry_consent';
const ENABLED_KEY = 'telemetry_enabled';
const INSTANCE_KEY = 'telemetry_instance_id';
const REPORTED_VER_KEY = 'telemetry_reported_version';

export type ConsentState = 'granted' | 'denied' | 'unset';

function ls(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getConsent(): ConsentState {
  const v = ls()?.getItem(CONSENT_KEY);
  return v === 'granted' || v === 'denied' ? v : 'unset';
}

export function setConsent(v: 'granted' | 'denied'): void {
  try {
    ls()?.setItem(CONSENT_KEY, v);
  } catch {
    /* ignore */
  }
}

export function isEnabled(): boolean {
  if (getConsent() !== 'granted') return false;
  const v = ls()?.getItem(ENABLED_KEY);
  return v == null ? true : v === 'true';
}

export function setEnabled(v: boolean): void {
  try {
    ls()?.setItem(ENABLED_KEY, v ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

export function getInstanceId(): string {
  const store = ls();
  let id = store?.getItem(INSTANCE_KEY) || '';
  if (!id) {
    const rnd = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    id = rnd;
    try {
      store?.setItem(INSTANCE_KEY, id);
    } catch {
      /* ignore */
    }
  }
  return id;
}

export const APP_VERSION: string = __APP_VERSION__;
export const COMMIT_SHA: string = __COMMIT_SHA__;

/**
 * 周测（v1.24.0）使用情况快照，仅用于作者端「周测启用率」匿名统计。
 * 不含任何科目名称、时间等考试内容，仅规则数量与开关状态。
 */
export interface WeeklyUsageSnapshot {
  scheduleMode: string;
  inUse: boolean;
  plansTotal: number;
  plansEnabled: number;
  activeItemsEnabled: number;
  itemsEnabledTotal: number;
  conflictPolicyEnabled: boolean;
}

export function getWeeklyUsageSnapshot(): WeeklyUsageSnapshot | null {
  try {
    const exam = getAppSettings().exam;
    const plans = Array.isArray(exam.weeklyPlans) ? exam.weeklyPlans : [];
    const enabledPlans = plans.filter((p) => p.enabled);
    const activePlan = plans.find((p) => p.id === exam.activeWeeklyPlanId);
    const activeItemsEnabled = activePlan ? activePlan.items.filter((i) => i.enabled).length : 0;
    const itemsEnabledTotal = enabledPlans.reduce((sum, p) => sum + p.items.filter((i) => i.enabled).length, 0);
    const inUse = exam.scheduleMode !== 'major-only' && !!activePlan?.enabled && activeItemsEnabled > 0;
    return {
      scheduleMode: exam.scheduleMode,
      inUse,
      plansTotal: plans.length,
      plansEnabled: enabledPlans.length,
      activeItemsEnabled,
      itemsEnabledTotal,
      conflictPolicyEnabled: !!exam.weeklyConflictPolicy?.enabled,
    };
  } catch {
    return null;
  }
}

async function send(event: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  if (!isEnabled()) return false;
  try {
    const body = {
      instanceId: getInstanceId(),
      event,
      appVersion: __APP_VERSION__,
      commitSha: __COMMIT_SHA__,
      host: location.host,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      lang: navigator.language,
      userAgent: navigator.userAgent,
      clientTs: Date.now(),
      weekly: getWeeklyUsageSnapshot(),
      ...extra,
    };
    const r = await fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** 应用启动时调用：版本首次出现则上报一次 deploy，否则上报 boot。 */
export async function reportOnStart(): Promise<void> {
  if (!isEnabled()) return;
  const store = ls();
  const reported = store?.getItem(REPORTED_VER_KEY) || '';
  if (reported !== __APP_VERSION__) {
    const ok = await send('deploy');
    if (ok) {
      try {
        store?.setItem(REPORTED_VER_KEY, __APP_VERSION__);
      } catch {
        /* ignore */
      }
    }
  } else {
    await send('boot');
  }
}

export async function reportNow(event = 'manual'): Promise<boolean> {
  return send(event);
}
/** Lightweight anonymous runtime signal for the author console; no exam content is sent. */
export async function reportPerformance(): Promise<void> {
  if (!isEnabled() || typeof performance === 'undefined') return;
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; rtt?: number; saveData?: boolean } }).connection;
  await send('perf', { perf: {
    page: location.pathname, ttfbMs: nav ? Math.round(nav.responseStart) : null,
    domReadyMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    loadMs: nav ? Math.round(nav.loadEventEnd) : null,
    transferBytes: nav?.transferSize ?? null, effectiveType: connection?.effectiveType ?? null,
    networkRttMs: connection?.rtt ?? null, saveData: connection?.saveData ?? false,
  }});
}
