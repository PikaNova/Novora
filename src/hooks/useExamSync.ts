import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExamItem, AlertsSettings } from '../types';
import { APP_SETTINGS_CHANGED_EVENT, APP_SETTINGS_KEY, getAppSettings, updateExamSettings, updateAlertsSettings } from '../utils/appSettings';
import { fetchExamsFromServer } from '../services/examService';
import { flushPendingExamSync, getPendingExamSync } from '../services/examOutbox';
import { getResolvedExamItems } from '../utils/appSchedule';

interface Options {
  onUpdate?: (data: { items: ExamItem[]; title: string; alerts: AlertsSettings }) => void;
  intervalMs?: number;
  bootstrapInstanceId?: string;
  onBootstrapBinding?: (classTag: string | null) => void;
}

export type ExamDataSyncState = 'local' | 'syncing' | 'synced' | 'pending' | 'offline' | 'error' | 'auth-required';
const AUTO_REFRESH_COOLDOWN_MS = 10_000;

export function useExamSync({ onUpdate, intervalMs = 60000, bootstrapInstanceId, onBootstrapBinding }: Options = {}) {
  const lastApplied = useRef(0);
  const lastPullAt = useRef(0);
  const pulling = useRef(false);
  const bootstrapResolved = useRef(false);
  const bootstrapInstanceIdRef = useRef(bootstrapInstanceId);
  if (!bootstrapResolved.current && bootstrapInstanceId) bootstrapInstanceIdRef.current = bootstrapInstanceId;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const onBootstrapBindingRef = useRef(onBootstrapBinding);
  onBootstrapBindingRef.current = onBootstrapBinding;
  const [syncState, setSyncState] = useState<ExamDataSyncState>(() => typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : (getPendingExamSync() ? 'pending' : 'local'));
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const [hasPendingSync, setHasPendingSync] = useState(() => !!getPendingExamSync());

  const applyLocal = useCallback(() => {
    const s = getAppSettings();
    // 展示端统一消费“大型考试 + 生效周测”合并后的时间线（major-only 下等价于旧 exam.items）。
    onUpdateRef.current?.({ items: getResolvedExamItems(), title: s.exam.title, alerts: s.alerts });
    const pending = !!getPendingExamSync();
    setHasPendingSync(pending);
    setSyncState(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : (pending ? 'pending' : 'local'));
  }, []);

  const applyPayload = useCallback((payload: { items: ExamItem[]; title: string; alerts: AlertsSettings | null; majors: any[]; activeMajorId: string; updatedAt: number; scheduleMode?: any; weeklyPlans?: any; activeWeeklyPlanId?: any; activeWeeklyPlanIdByClass?: any; weeklyConflictPolicy?: any }) => {
    const updates: Record<string, unknown> = {
      items: payload.items,
      title: payload.title,
      updatedAt: payload.updatedAt,
    };
    if (payload.majors && payload.majors.length) updates.majors = payload.majors;
    if (payload.activeMajorId) updates.activeMajorId = payload.activeMajorId;
    // 仅在服务端返回周测字段时才写入，避免 undefined 覆盖本地已同步的周测数据。
    if (payload.scheduleMode !== undefined) updates.scheduleMode = payload.scheduleMode;
    if (payload.weeklyPlans !== undefined) updates.weeklyPlans = payload.weeklyPlans;
    if (payload.activeWeeklyPlanId !== undefined) updates.activeWeeklyPlanId = payload.activeWeeklyPlanId;
    if (payload.activeWeeklyPlanIdByClass !== undefined) updates.activeWeeklyPlanIdByClass = payload.activeWeeklyPlanIdByClass;
    if (payload.weeklyConflictPolicy !== undefined) updates.weeklyConflictPolicy = payload.weeklyConflictPolicy;
    updateExamSettings(updates as any);
    if (payload.alerts) updateAlertsSettings(payload.alerts);
    const s = getAppSettings();
    onUpdateRef.current?.({ items: getResolvedExamItems(), title: s.exam.title, alerts: s.alerts });
  }, []);

  const refresh = useCallback(async (force = false) => {
    if (pulling.current) return;
    const pullStartedAt = Date.now();
    if (!force && lastPullAt.current && pullStartedAt - lastPullAt.current < AUTO_REFRESH_COOLDOWN_MS) return;
    // 手动/恢复时先应用本地快照；离线永远可立即显示最新本机编辑。
    applyLocal();
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    lastPullAt.current = pullStartedAt;
    pulling.current = true;
    setSyncState('syncing');
    try {
      const flushed = await flushPendingExamSync(force);
      if (flushed.kind === 'saved') {
        applyPayload({ ...flushed.payload, updatedAt: flushed.updatedAt });
        setHasPendingSync(false);
      } else if (flushed.kind === 'offline') { setSyncState('offline'); return; }
      else if (flushed.kind === 'deferred') { setHasPendingSync(true); setSyncState('pending'); return; }
      else if (flushed.kind === 'unauthorized') { setSyncState('auth-required'); return; }
      else if (flushed.kind === 'error') { setHasPendingSync(true); setSyncState('error'); return; }

      // 本地仍有待办时绝不以云端旧数据覆盖；等待下一次冲刷/三方合并。
      if (getPendingExamSync()) { setHasPendingSync(true); setSyncState('pending'); return; }
      const bootstrapId = bootstrapResolved.current ? undefined : bootstrapInstanceIdRef.current;
      const remote = await fetchExamsFromServer(bootstrapId);
      if (bootstrapId && remote) {
        onBootstrapBindingRef.current?.(remote.boundClassTag ?? null);
        bootstrapResolved.current = true;
      }
      if (!remote) { setSyncState('error'); return; }
      const localAt = getAppSettings().exam?.updatedAt ?? 0;
      const baseline = Math.max(lastApplied.current, localAt);
      if (remote.updatedAt > baseline) {
        lastApplied.current = remote.updatedAt;
        applyPayload(remote);
      }
      setHasPendingSync(false);
      setLastSyncAt(Date.now());
      setSyncState('synced');
    } finally {
      pulling.current = false;
    }
  }, [applyLocal, applyPayload]);

  useEffect(() => {
    let cancelled = false;
    const pull = () => { if (!cancelled) void refresh(); };
    pull();
    const id = setInterval(() => { if (document.visibilityState === 'visible') pull(); }, intervalMs);
    // PWA/离线设备恢复网络、回到前台时立即补拉云端，API 始终网络优先。
    const onOnline = () => { void pull(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void pull(); };
    // 后台标签页的定时器可能被浏览器暂停；恢复焦点或 BFCache 页面时立即补拉最新数据。
    const onFocus = () => { void pull(); };
    const onPageShow = () => { void pull(); };
    const onLocalChanged = () => { applyLocal(); };
    const onStorage = (event: StorageEvent) => { if (event.key === APP_SETTINGS_KEY) applyLocal(); };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener(APP_SETTINGS_CHANGED_EVENT, onLocalChanged);
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, onLocalChanged);
      window.removeEventListener('storage', onStorage);
    };
  }, [intervalMs, refresh, applyLocal]);

  return { refresh, reloadLocal: applyLocal, syncState, lastSyncAt, hasPendingSync };
}
