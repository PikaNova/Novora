import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExamItem, AlertsSettings } from '../types';
import { APP_SETTINGS_CHANGED_EVENT, APP_SETTINGS_KEY, getAppSettings, updateExamSettings, updateAlertsSettings } from '../utils/appSettings';
import { fetchExamsFromServer, getLastExamApiError } from '../services/examService';
import { flushPendingExamSync, getPendingExamSync } from '../services/examOutbox';
import { getResolvedExamItems } from '../utils/appSchedule';
import type { DeviceBinding } from '../services/classBinding';
import { ApiError, formatApiError, getSyncNotifyTitle } from '../services/apiError';
import { notify } from '../services/notify';

interface Options {
  onUpdate?: (data: { items: ExamItem[]; title: string; alerts: AlertsSettings }) => void;
  intervalMs?: number;
  minRefreshMs?: number;
  bootstrapInstanceId?: string;
  onBootstrapBinding?: (binding: DeviceBinding | null) => void;
}

export type ExamDataSyncState = 'local' | 'syncing' | 'synced' | 'pending' | 'offline' | 'error' | 'auth-required' | 'max-retries';
const AUTO_REFRESH_COOLDOWN_MS = 10_000;
// 首次同步若命中“看起来还未初始化”且服务端 updatedAt 并不比本地更新的响应，
// 大概率是打到了服务端某个刚启动、还没看到最新写入的旧缓存实例（详见 api/exams.ts 的说明）。
// 稍等片刻后强制重拉一次即可自愈，避免用户误以为“班级没建成功”，非要手动刷新页面才恢复。
const STALE_FIRST_SYNC_RETRY_MS = 1_500;

export function useExamSync({ onUpdate, intervalMs = 60000, minRefreshMs = AUTO_REFRESH_COOLDOWN_MS, bootstrapInstanceId, onBootstrapBinding }: Options = {}) {
  const lastApplied = useRef(0);
  const lastPullAt = useRef(0);
  const pulling = useRef(false);
  const staleFirstSyncRetryDone = useRef(false);
  const bootstrapResolved = useRef(false);
  const bootstrapInstanceIdRef = useRef(bootstrapInstanceId);
  if (!bootstrapResolved.current && bootstrapInstanceId) bootstrapInstanceIdRef.current = bootstrapInstanceId;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const onBootstrapBindingRef = useRef(onBootstrapBinding);
  onBootstrapBindingRef.current = onBootstrapBinding;

  const [syncState, setSyncState] = useState<ExamDataSyncState>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : (getPendingExamSync() ? 'pending' : 'local'));
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const [hasPendingSync, setHasPendingSync] = useState(() => !!getPendingExamSync());
  const [syncError, setSyncError] = useState('');
  const [needsRelogin, setNeedsRelogin] = useState(false);
  // V3：账号被标记“必须修改密码”时单独暴露，UI 可据此引导用户先去改密
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);

  /**
   * 错误通知去重: 仅用 error.code（不含 requestId）做去重键。
   * 相同类型的错误（如持续断网）不会重复弹出 toast。
   * 同步恢复后自动清除去重键。
   */
  const lastNotifiedErrorCode = useRef('');

  const reportSyncError = useCallback((fallback: string) => {
    const error = getLastExamApiError();
    // 优先展示 API 错误（V3 起为服务端真实原因），否则尝试从 outbox 读取 lastError
    const outboxPending = getPendingExamSync();
    const message = error
      ? formatApiError(error)
      : outboxPending?.lastError ?? fallback;

    setSyncError(message);

    // 仅用 code 去重（而非 code + requestId），避免相同类型错误连续弹出
    const dedupeKey = error instanceof ApiError ? error.code : (outboxPending?.lastError ?? message);
    if (dedupeKey !== lastNotifiedErrorCode.current) {
      lastNotifiedErrorCode.current = dedupeKey;
      notify('error', message, getSyncNotifyTitle(error instanceof ApiError ? error.code : undefined));
    }
  }, []);

  const applyLocal = useCallback(() => {
    const s = getAppSettings();
    onUpdateRef.current?.({ items: getResolvedExamItems(), title: s.exam.title, alerts: s.alerts });
    const pending = !!getPendingExamSync();
    setHasPendingSync(pending);
    setSyncState(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : (pending ? 'pending' : 'local'));
  }, []);

  const applyPayload = useCallback((payload: {
    items: ExamItem[]; title: string; alerts: AlertsSettings | null;
    majors: any[]; activeMajorId: string; updatedAt: number;
    scheduleMode?: any; weeklyPlans?: any; activeWeeklyPlanId?: any;
    activeWeeklyPlanIdByClassId?: any; grades?: any; classes?: any;
    initialization?: any; weeklyConflictPolicy?: any; designPolicy?: any;
  }) => {
    const updates: Record<string, unknown> = {
      items: payload.items,
      title: payload.title,
      updatedAt: payload.updatedAt,
    };
    if (payload.majors && payload.majors.length) updates.majors = payload.majors;
    if (payload.activeMajorId) updates.activeMajorId = payload.activeMajorId;
    if (payload.scheduleMode !== undefined) updates.scheduleMode = payload.scheduleMode;
    if (payload.weeklyPlans !== undefined) updates.weeklyPlans = payload.weeklyPlans;
    if (payload.activeWeeklyPlanId !== undefined) updates.activeWeeklyPlanId = payload.activeWeeklyPlanId;
    if (payload.activeWeeklyPlanIdByClassId !== undefined) updates.activeWeeklyPlanIdByClassId = payload.activeWeeklyPlanIdByClassId;
    if (payload.grades !== undefined) updates.grades = payload.grades;
    if (payload.classes !== undefined) updates.classes = payload.classes;
    if (payload.initialization !== undefined) updates.initialization = payload.initialization;
    if (payload.weeklyConflictPolicy !== undefined) updates.weeklyConflictPolicy = payload.weeklyConflictPolicy;
    if (payload.designPolicy !== undefined) updates.designPolicy = payload.designPolicy;
    updateExamSettings(updates as any);
    if (payload.alerts) updateAlertsSettings(payload.alerts);
    const s = getAppSettings();
    onUpdateRef.current?.({ items: getResolvedExamItems(), title: s.exam.title, alerts: s.alerts });
  }, []);

  const refresh = useCallback(async (force = false) => {
    if (pulling.current) return;
    const pullStartedAt = Date.now();
    if (!force && lastPullAt.current && pullStartedAt - lastPullAt.current < minRefreshMs) return;
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
        // 同步成功，清除去重键以便下次错误重新通知
        lastNotifiedErrorCode.current = '';
      } else if (flushed.kind === 'offline') {
        setSyncState('offline');
        return;
      } else if (flushed.kind === 'max-retries') {
        // 已达最大重试次数或收到不可重试错误，需用户手动干预
        setHasPendingSync(true);
        setSyncState('max-retries');
        const pending = getPendingExamSync();
        setSyncError(pending?.lastError ?? '已达最大自动重试次数，请手动刷新或联系管理员。');
        return;
      } else if (flushed.kind === 'deferred') {
        setHasPendingSync(true);
        setSyncState('pending');
        return;
      } else if (flushed.kind === 'unauthorized') {
        // 登录已失效——设置标志并提示用户重新登录
        setSyncState('auth-required');
        setNeedsRelogin(true);
        if ('auth-required' !== lastNotifiedErrorCode.current) {
          lastNotifiedErrorCode.current = 'auth-required';
          notify('warning', '登录状态已失效，请重新登录后继续操作。', '登录已失效');
        }
        return;
      } else if (flushed.kind === 'error') {
        setHasPendingSync(true);
        setSyncState('error');
        // V3：账号被标记「必须修改密码」时单独暴露状态，供 UI 引导用户完成改密
        if (getLastExamApiError()?.code === 'PASSWORD_CHANGE_REQUIRED') setPasswordChangeRequired(true);
        reportSyncError('待同步数据暂时无法上传，本机数据已保留。');
        return;
      }

      // 本地仍有待办时绝不以云端旧数据覆盖。
      if (getPendingExamSync()) { setHasPendingSync(true); setSyncState('pending'); return; }

      const bootstrapId = bootstrapResolved.current ? undefined : bootstrapInstanceIdRef.current;
      const remote = await fetchExamsFromServer(bootstrapId);
      if (bootstrapId && remote) {
        onBootstrapBindingRef.current?.(remote.binding ?? null);
        bootstrapResolved.current = true;
      }
      if (!remote) {
        setSyncState('error');
        reportSyncError('暂时无法读取云端考试与班级数据。');
        return;
      }
      const localAt = getAppSettings().exam?.updatedAt ?? 0;
      const baseline = Math.max(lastApplied.current, localAt);
      if (remote.updatedAt > baseline) {
        lastApplied.current = remote.updatedAt;
        applyPayload(remote);
      } else if (
        baseline === 0
        && !staleFirstSyncRetryDone.current
        && !(remote.grades?.length)
        && !(remote.classes?.length)
        && !(remote.majors?.length)
      ) {
        // 本次是本会话首次同步，且拿到的数据看起来“还没初始化”（年级/班级/大型考试都是空的），
        // 但服务端自己报的 updatedAt 又没有比本地更新——这通常意味着请求被路由到了服务端某个
        // 刚启动、还未感知到最新写入的实例（例如另一台管理员设备刚创建完班级）。
        // 不要就此断定“确实没有班级”，稍等一下强制重新拉取一次，命中新数据后即可自愈，
        // 不再需要用户手动刷新页面。
        staleFirstSyncRetryDone.current = true;
        window.setTimeout(() => { void refresh(true); }, STALE_FIRST_SYNC_RETRY_MS);
      }
      setHasPendingSync(false);
      setLastSyncAt(Date.now());
      setSyncState('synced');
      setSyncError('');
      // 同步成功，清除错误去重键与账号状态标志
      lastNotifiedErrorCode.current = '';
      setNeedsRelogin(false);
      setPasswordChangeRequired(false);
    } finally {
      pulling.current = false;
    }
  }, [applyLocal, applyPayload, reportSyncError, minRefreshMs]);

  useEffect(() => {
    let cancelled = false;
    const pull = () => { if (!cancelled) void refresh(); };
    pull();
    const id = setInterval(() => { if (document.visibilityState === 'visible') pull(); }, intervalMs);
    const onOnline = () => { void pull(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void pull(); };
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

  return { refresh, reloadLocal: applyLocal, syncState, lastSyncAt, hasPendingSync, syncError, needsRelogin, passwordChangeRequired };
}
