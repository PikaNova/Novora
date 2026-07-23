import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Watermark from '../components/Watermark';
import type { ExamItem, MajorExam, AlertsSettings, AlertState, CustomReminder } from '../types';
import { getAppSettings, updateExamSettings, updateAlertsSettings, genMajorId, genReminderId, DEFAULT_ALERTS, normalizeAlerts } from '../utils/appSettings';
import { fetchExamsFromServer, getCloudSnapshot, hasValidLocalToken, isLoginRequired, saveExamsToServer } from '../services/examService';
import { threeWayMergeExam } from '../utils/examMerge';
import { clearPendingExamSync, getPendingExamSync, queuePendingExamSync } from '../services/examOutbox';
import { normalizeExamItems } from '../utils/examSchedule';
import { recordSyncConflict } from '../services/offlineStore';
import { fetchAnnouncements } from '../services/announcements';
import type { Announcement } from '../services/announcements';
import { renderMarkdown } from '../utils/renderMarkdown';
import AnnouncementList from '../components/AnnouncementList';
import WeeklyPanel from '../components/WeeklyPanel';
import type { AdminTab, ScheduleMode, WeeklyPlan, WeeklyConflictPolicy } from '../types/exam';
import '../styles/admin.css';

function fmtAnnTime(ms: number) {
  if (!ms) return '';
  return new Date(Number(ms)).toLocaleString('zh-CN', { hour12: false });
}

function makeId() { return `exam_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }
function fmtLocal(iso: string) { return iso?.replace('T', ' ')?.slice(0, 16) ?? ''; }
function toISO(value: string) { return value.replace(' ', 'T').trim(); }
function duration(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const minutes = Math.round(ms / 60000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? `${minutes % 60}m` : ''}` : `${minutes}m`;
}
function phase(item: ExamItem): 'waiting' | 'ongoing' | 'ended' {
  const now = Date.now();
  if (now < new Date(item.startTime).getTime()) return 'waiting';
  if (now <= new Date(item.endTime).getTime()) return 'ongoing';
  return 'ended';
}
const STATUS = {
  waiting: { label: '待考', color: '#3498db', bg: 'rgba(52,152,219,.15)' },
  ongoing: { label: '进行中', color: '#27ae60', bg: 'rgba(39,174,96,.15)' },
  ended: { label: '已结束', color: '#6c757d', bg: 'rgba(108,117,125,.15)' },
};

// 云服务同步状态
type SyncState = 'loading' | 'saving' | 'saved' | 'offline' | 'error';
const SYNC_META: Record<SyncState, { label: string; cls: string }> = {
  loading: { label: '正在连接云服务…', cls: 'is-loading' },
  saving: { label: '正在同步到云…', cls: 'is-saving' },
  saved: { label: '已同步到云', cls: 'is-saved' },
  offline: { label: '离线 · 已本地保存', cls: 'is-offline' },
  error: { label: '同步失败 · 已本地保存', cls: 'is-error' },
};

type EditItem = Omit<ExamItem, 'id' | 'order'> & { id?: string };
type MajorModal = { mode: 'add' | 'rename'; name: string } | null;

// 内置提醒状态的展示顺序与触发时机说明
const ALERT_STATE_ORDER: AlertState[] = ['15min', '5min', 'start', 'end15', 'ended', 'next'];
const ALERT_STATE_META: Record<AlertState, { name: string; timing: string }> = {
  '15min': { name: '开考前 15 分钟', timing: '自动于开考前 15 分钟触发' },
  '5min':  { name: '开考前 5 分钟', timing: '自动于开考前 5 分钟触发' },
  'start': { name: '开考时刻', timing: '自动于开考时刻触发' },
  'end15': { name: '结束前 15 分钟', timing: '自动于结束前 15 分钟触发' },
  'ended': { name: '本场结束', timing: '自动于本场结束时触发' },
  'next':  { name: '下一科提示', timing: '本场结束且存在下一场时触发' },
};
const TONE_OPTIONS: Array<{ value: AlertState; label: string }> = [
  { value: '15min', label: '黄橙·准备' },
  { value: '5min', label: '红色·紧急' },
  { value: 'start', label: '绿蓝·开始' },
  { value: 'end15', label: '黄橙·注意' },
  { value: 'ended', label: '冷调·结束' },
  { value: 'next', label: '紫蓝·下一科' },
];
const ANCHOR_OPTIONS: Array<{ value: CustomReminder['anchor']; label: string }> = [
  { value: 'beforeStart', label: '开考前' },
  { value: 'afterStart', label: '开考后' },
  { value: 'beforeEnd', label: '结束前' },
];

export default function AdminPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const initial = getAppSettings().exam;

  const [majors, setMajors] = useState<MajorExam[]>(initial.majors);
  const [activeMajorId, setActiveMajorId] = useState<string>(initial.activeMajorId);
  const [adminTab, setAdminTab] = useState<AdminTab>('major');
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(initial.scheduleMode);
  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlan[]>(initial.weeklyPlans);
  const [activeWeeklyPlanId, setActiveWeeklyPlanId] = useState<string | null>(initial.activeWeeklyPlanId);
  const [weeklyConflictPolicy, setWeeklyConflictPolicy] = useState<WeeklyConflictPolicy>(initial.weeklyConflictPolicy);
  // 有本地令牌时初始即就绪，立即渲染后台（本地缓存数据），鉴权与拉取在后台并行进行。
  const [ready, setReady] = useState<boolean>(() => hasValidLocalToken());
  const [editing, setEditing] = useState<EditItem | null>(null);
  const [editError, setEditError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ExamItem | null>(null);
  const [lastDeletedExam, setLastDeletedExam] = useState<{ item: ExamItem; index: number } | null>(null);
  const [collapsedList, setCollapsedList] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [majorModal, setMajorModal] = useState<MajorModal>(null);
  const [majorError, setMajorError] = useState('');
  const [deleteMajorOpen, setDeleteMajorOpen] = useState(false);
  const [sync, setSync] = useState<SyncState>('loading');
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  // 统一提醒管理
  const [alerts, setAlerts] = useState<AlertsSettings>(() => getAppSettings().alerts);
  const [alertsOpen, setAlertsOpen] = useState(false);
  // 公告展示（作者端统一发布，本端只读）
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [anns, setAnns] = useState<Announcement[]>([]);
  const [annLoading, setAnnLoading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreMenuStyle, setMoreMenuStyle] = useState<React.CSSProperties>({});
  const [longDurationConfirmed, setLongDurationConfirmed] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pendingRef = useRef(false); // 是否有尚未推送到服务器的本地变更
  const stateRef = useRef({ majors, activeMajorId });
  stateRef.current = { majors, activeMajorId };
  const weeklySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const weeklyStateRef = useRef({ scheduleMode, weeklyPlans, activeWeeklyPlanId, weeklyConflictPolicy });
  weeklyStateRef.current = { scheduleMode, weeklyPlans, activeWeeklyPlanId, weeklyConflictPolicy };
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  // 从设置页「前往提醒管理」直达：URL 带 ?alerts=1 时自动打开提醒管理弹窗
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('alerts') === '1') setAlertsOpen(true);
    if (params.get('announce') === '1') setAnnounceOpen(true);
  }, [location.search]);

  // 打开公告弹窗时拉取最新公告
  useEffect(() => {
    if (!announceOpen) return;
    let alive = true;
    setAnnLoading(true);
    fetchAnnouncements(true)
      .then(list => { if (alive) setAnns(list); })
      .finally(() => { if (alive) setAnnLoading(false); });
    return () => { alive = false; };
  }, [announceOpen]);

  const activeMajor = majors.find(m => m.id === activeMajorId) ?? majors[0];
  const items = activeMajor?.items ?? [];

  // 构造待推送的完整载荷（items/title 镜像激活大型考试�����
  const buildPayload = (ms: MajorExam[], activeId: string) => {
    const active = ms.find(m => m.id === activeId) ?? ms[0];
    return { items: active?.items ?? [], title: active?.name ?? '', majors: ms, activeMajorId: activeId, alerts: alertsRef.current };
  };

  // 将变更推送到服务器（已先行写入本地）
  const pushToServer = useCallback(async (ms: MajorExam[], activeId: string) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      pendingRef.current = true; setSync('offline'); return;
    }
    setSync('saving');
    // 以持久 outbox 为准，旧防抖请求也不会把较新的本机编辑覆盖成旧载荷。
    const queued = getPendingExamSync();
    const payload = queued?.payload ?? buildPayload(ms, activeId);
    // 必须在请求前读取共同基线；409 返回后云端已是较新版本，不能再拿它当 base。
    const baseSnapshot = getCloudSnapshot();
    const result = await saveExamsToServer({ ...payload, baseUpdatedAt: queued?.baseSnapshot?.updatedAt });
    if (result === 'unauthorized') {
      navigate('/login?next=/admin', { replace: true }); return;
    }
    if (result && typeof result === 'object' && result.kind === 'conflict') {
      if (!result.remote) {
        pendingRef.current = true;
        setSync('error');
        window.alert('云端返回的冲突数据不完整，本机修改已保留；请刷新后台后再保存。');
        return;
      }
      const local = { ...payload, updatedAt: queued?.baseSnapshot?.updatedAt ?? baseSnapshot?.updatedAt ?? 0 };
      const merged = threeWayMergeExam(baseSnapshot ?? result.remote, local, result.remote);
      if (merged.conflictCount) void recordSyncConflict(merged.conflictCount, local, result.remote);
      const { alerts: mergedAlerts, ...mergedExam } = merged.payload;
      // 先把合并结果持久化到本机；同字段并发冲突时自动保留当前操作者的值。
      setMajors(merged.payload.majors);
      setActiveMajorId(merged.payload.activeMajorId);
      const mergedQueuedAt = Date.now();
      queuePendingExamSync({ payload: merged.payload, baseSnapshot: result.remote, savedAt: mergedQueuedAt });
      updateExamSettings({ ...mergedExam, updatedAt: result.remote.updatedAt });
      if (mergedAlerts) {
        updateAlertsSettings({ ...mergedAlerts, updatedAt: result.remote.updatedAt });
        setAlerts(getAppSettings().alerts);
      }
      const retry = await saveExamsToServer({ ...merged.payload, baseUpdatedAt: result.remote.updatedAt });
      if (typeof retry === 'number') {
        pendingRef.current = false;
        clearPendingExamSync(mergedQueuedAt);
        updateExamSettings({ ...mergedExam, updatedAt: retry });
        if (mergedAlerts) updateAlertsSettings({ ...mergedAlerts, updatedAt: retry });
        setSync('saved');
        if (merged.conflictCount) window.alert(`已合并本机与云端修改；其中 ${merged.conflictCount} 个同字段冲突已保留本机值，并已记录到本地冲突历史。`);
        return;
      }
      pendingRef.current = true;
      setSync(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
      window.alert('已自动合并本机与云端数据，但再次保存时云端又发生变化；合并结果已保留在本机，请稍后重新保存。');
      return;
    }
    if (result == null) {
      pendingRef.current = true;
      setSync(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
      return;
    }
    pendingRef.current = false;
    clearPendingExamSync(queued?.savedAt);
    const { alerts: pAlerts, ...examPayload } = payload;
    updateExamSettings({ ...examPayload, updatedAt: result });
    if (pAlerts) updateAlertsSettings({ ...pAlerts, updatedAt: result });
    setSync('saved');
  }, [navigate]);

  // 任何修改：立即写入本地（离线保证）+ 防抖推送云端
  const commit = useCallback((ms: MajorExam[], activeId: string, immediate = false) => {
    setMajors(ms); setActiveMajorId(activeId);
    // 本地先行持久化，即使离线/刷新也不丢数据
    const now = Date.now();
    const { alerts: pAlerts, ...examPayload } = buildPayload(ms, activeId);
    updateExamSettings({ ...examPayload, updatedAt: now });
    if (pAlerts) updateAlertsSettings({ ...pAlerts, updatedAt: now });
    // 本地持久 outbox：后台/PWA 被关闭后仍能在恢复联网时继续推送。
    queuePendingExamSync({
      payload: { ...examPayload, alerts: pAlerts ?? null },
      baseSnapshot: getCloudSnapshot(),
      savedAt: now,
    });
    pendingRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (immediate) { void pushToServer(ms, activeId); return; }
    setSync(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'saving');
    saveTimer.current = setTimeout(() => { void pushToServer(ms, activeId); }, 650);
  }, [pushToServer]);

  // 修改当前大型考试的分考试列表
  const commitItems = useCallback((nextItems: ExamItem[]) => {
    const ms = stateRef.current.majors.map(m => m.id === stateRef.current.activeMajorId ? { ...m, items: nextItems } : m);
    commit(ms, stateRef.current.activeMajorId);
  }, [commit]);

  // ===== 周测：与大型考试独立的推送通道，复用 /api/exams 与其冲突返回结构 =====
  const pushWeeklyToServer = useCallback(async (weekly: { scheduleMode: ScheduleMode; weeklyPlans: WeeklyPlan[]; activeWeeklyPlanId: string | null; weeklyConflictPolicy: WeeklyConflictPolicy }) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) { pendingRef.current = true; setSync('offline'); return; }
    setSync('saving');
    const ms = stateRef.current.majors; const activeId = stateRef.current.activeMajorId;
    const base = buildPayload(ms, activeId);
    const baseUpdatedAt = getCloudSnapshot()?.updatedAt ?? 0;
    const result = await saveExamsToServer({ ...base, baseUpdatedAt, ...weekly });
    if (result === 'unauthorized') { navigate('/login?next=/admin', { replace: true }); return; }
    if (result && typeof result === 'object' && result.kind === 'conflict') {
      if (result.remote) {
        const retryBase = { items: result.remote.items, title: result.remote.title, majors: result.remote.majors, activeMajorId: result.remote.activeMajorId, alerts: result.remote.alerts };
        const retry = await saveExamsToServer({ ...retryBase, baseUpdatedAt: result.remote.updatedAt, ...weekly });
        if (typeof retry === 'number') {
          if (result.remote.majors && result.remote.majors.length) { setMajors(result.remote.majors); setActiveMajorId(result.remote.activeMajorId || result.remote.majors[0].id); }
          updateExamSettings({ majors: result.remote.majors, activeMajorId: result.remote.activeMajorId, title: result.remote.title, items: result.remote.items, ...weekly, updatedAt: retry });
          pendingRef.current = false; setSync('saved'); return;
        }
      }
      pendingRef.current = true; setSync('error');
      window.alert('周测保存时云端数据发生变化，已自动重试一次仍失败；请刷新后台后重新保存。');
      return;
    }
    if (result == null) { pendingRef.current = true; setSync(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error'); return; }
    pendingRef.current = false;
    updateExamSettings({ ...weekly, updatedAt: result });
    setSync('saved');
  }, [navigate]);

  const commitWeekly = useCallback((weekly: Partial<{ scheduleMode: ScheduleMode; weeklyPlans: WeeklyPlan[]; activeWeeklyPlanId: string | null; weeklyConflictPolicy: WeeklyConflictPolicy }>, immediate = false) => {
    const next = { ...weeklyStateRef.current, ...weekly };
    setScheduleMode(next.scheduleMode); setWeeklyPlans(next.weeklyPlans); setActiveWeeklyPlanId(next.activeWeeklyPlanId); setWeeklyConflictPolicy(next.weeklyConflictPolicy);
    weeklyStateRef.current = next;
    updateExamSettings({ ...next, updatedAt: Date.now() });
    pendingRef.current = true;
    if (weeklySaveTimer.current) clearTimeout(weeklySaveTimer.current);
    if (immediate) { void pushWeeklyToServer(next); return; }
    setSync(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'saving');
    weeklySaveTimer.current = setTimeout(() => { void pushWeeklyToServer(next); }, 650);
  }, [pushWeeklyToServer]);

  const handleScheduleModeChange = (mode: ScheduleMode) => commitWeekly({ scheduleMode: mode }, true);
  const handleSaveWeeklyPlans = (plans: WeeklyPlan[], activeId: string | null, immediate = false) => commitWeekly({ weeklyPlans: plans, activeWeeklyPlanId: activeId }, immediate);
  const handleConflictPolicyChange = (policy: WeeklyConflictPolicy, immediate = false) => commitWeekly({ weeklyConflictPolicy: policy }, immediate);

  // 开机：鉴权 + 拉取服务器数据
  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const hasToken = hasValidLocalToken();
      // 并行发起鉴权判断与数据拉取，避免美国↔新加坡跨洲往返串行叠加；
      // 有本地令牌时无需再等 isLoginRequired，可直接进入。
      const requiredP = hasToken ? Promise.resolve(true) : isLoginRequired();
      const remoteP = fetchExamsFromServer();

      const required = await requiredP;
      if (cancelled) return;
      if (required && !hasValidLocalToken()) { navigate('/login?next=/admin', { replace: true }); return; }
      setReady(true);

      const remote = await remoteP;
      if (cancelled) return;
      const localAt = getAppSettings().exam?.updatedAt ?? 0;

      if (remote && remote.updatedAt > localAt) {
        // 服务器更新：应用远端
        const remoteUpdates: Record<string, unknown> = {
          items: remote.items, title: remote.title,
          majors: remote.majors && remote.majors.length ? remote.majors : undefined,
          activeMajorId: remote.activeMajorId || undefined,
          updatedAt: remote.updatedAt,
        };
        // 同步服务端周测字段到本地（仅在返回时写入，避免 undefined 抹除）。
        if (remote.scheduleMode !== undefined) remoteUpdates.scheduleMode = remote.scheduleMode;
        if (remote.weeklyPlans !== undefined) remoteUpdates.weeklyPlans = remote.weeklyPlans;
        if (remote.activeWeeklyPlanId !== undefined) remoteUpdates.activeWeeklyPlanId = remote.activeWeeklyPlanId;
        if (remote.weeklyConflictPolicy !== undefined) remoteUpdates.weeklyConflictPolicy = remote.weeklyConflictPolicy;
        updateExamSettings(remoteUpdates as any);
        if (remote.alerts) { updateAlertsSettings(remote.alerts); setAlerts(getAppSettings().alerts); }
        const merged = getAppSettings().exam;
        setMajors(merged.majors); setActiveMajorId(merged.activeMajorId);
        setScheduleMode(merged.scheduleMode); setWeeklyPlans(merged.weeklyPlans); setActiveWeeklyPlanId(merged.activeWeeklyPlanId); setWeeklyConflictPolicy(merged.weeklyConflictPolicy);
        pendingRef.current = false;
        setSync('saved');
      } else if (localAt > (remote?.updatedAt ?? 0)) {
        // 本地更新（之前离线编辑）：回连后回推
        pendingRef.current = true;
        void pushToServer(getAppSettings().exam.majors, getAppSettings().exam.activeMajorId);
      } else {
        setSync(remote ? 'saved' : 'offline');
      }
    };
    void boot();
    return () => { cancelled = true; if (saveTimer.current) clearTimeout(saveTimer.current); if (weeklySaveTimer.current) clearTimeout(weeklySaveTimer.current); };
  }, [navigate, pushToServer]);

  // 网络状态：回线时自动回推未同步变更
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      if (pendingRef.current) { void pushToServer(stateRef.current.majors, stateRef.current.activeMajorId); void pushWeeklyToServer(weeklyStateRef.current); }
    };
    const goOffline = () => { setOnline(false); setSync('offline'); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, [pushToServer, pushWeeklyToServer]);

  // ===== 大型考试：添加 / 切换 / 重命名 / 删除 =====
  const switchMajor = (id: string) => {
    if (id === activeMajorId) return;
    setEditing(null);
    commit(majors, id, true);
  };
  const commitMajorModal = () => {
    if (!majorModal) return;
    const name = majorModal.name.trim();
    if (!name) { setMajorError('请输入大型考试名称'); return; }
    if (majorModal.mode === 'add') {
      const nm: MajorExam = { id: genMajorId(), name, items: [], order: majors.length };
      const ms = [...majors, nm];
      commit(ms, nm.id, true);
    } else {
      const ms = majors.map(m => m.id === activeMajorId ? { ...m, name } : m);
      commit(ms, activeMajorId, true);
    }
    setMajorModal(null); setMajorError('');
  };
  const removeMajor = () => {
    if (majors.length <= 1) return;
    const ms = majors.filter(m => m.id !== activeMajorId).map((m, i) => ({ ...m, order: i }));
    commit(ms, ms[0].id, true);
    setDeleteMajorOpen(false);
  };

  // ===== 分考试：添加 / 编辑 / 启用 / 删除 / 排序 =====
  const commitEdit = () => {
    if (!editing) return;
    if (!editing.name.trim()) { setEditError('请输入考试名称'); return; }
    if (!editing.startTime || !editing.endTime) { setEditError('请输入开始与结束时间'); return; }
    if (new Date(editing.startTime) >= new Date(editing.endTime)) { setEditError('结束时间必须晚于开始时间'); return; }
    const overlaps = items.some(x => x.id !== editing.id && x.enabled && editing.enabled && new Date(editing.startTime) < new Date(x.endTime) && new Date(editing.endTime) > new Date(x.startTime));
    if (overlaps && !window.confirm('此科目与已启用科目时间重叠，仍要保存吗？')) return;
    if (new Date(editing.endTime).getTime() - new Date(editing.startTime).getTime() > 6 * 60 * 60 * 1000 && !longDurationConfirmed) {
      setEditError('本场时长超过 6 小时，请确认这是跨天或特殊安排。'); return;
    }
    let next: ExamItem[];
    if (editing.id) next = items.map(x => x.id === editing.id ? { ...x, ...editing, id: x.id, order: x.order } : x);
    else next = [...items, { id: makeId(), order: items.length ? Math.max(...items.map(x => x.order)) + 1 : 0, name: editing.name.trim(), startTime: toISO(editing.startTime), endTime: toISO(editing.endTime), enabled: editing.enabled }];
    next = normalizeExamItems(next);
    commitItems(next); setEditing(null); setEditError(''); setLongDurationConfirmed(false);
  };
  /** 按明确的目标状态保存，按钮文案永远表达“下一步操作”，避免“已启用”被误认为点击后启用。 */
  const setExamEnabled = (id: string, enabled: boolean) => commitItems(items.map(x => x.id === id ? { ...x, enabled } : x));
  const remove = (item: ExamItem) => { const index = items.findIndex(x => x.id === item.id); setLastDeletedExam({ item, index }); commitItems(items.filter(x => x.id !== item.id)); setDeleteTarget(null); };
  const restoreExam = () => { if (!lastDeletedExam) return; const next = [...items]; next.splice(Math.min(lastDeletedExam.index, next.length), 0, lastDeletedExam.item); commitItems(next); setLastDeletedExam(null); };

  // ===== 统一提醒管理：保存时同步至云（与考试数据共用一个载荷） =====
  const commitAlerts = useCallback((next: AlertsSettings) => {
    alertsRef.current = next;
    setAlerts(next);
    commit(stateRef.current.majors, stateRef.current.activeMajorId);
  }, [commit]);
  const setAlertsEnabled = (enabled: boolean) => commitAlerts({ ...alertsRef.current, enabled });
  const setAlertsDuration = (durationSec: number) => commitAlerts({ ...alertsRef.current, durationSec });
  const updateStateCfg = (state: AlertState, patch: Partial<AlertsSettings['states'][AlertState]>) =>
    commitAlerts({ ...alertsRef.current, states: { ...alertsRef.current.states, [state]: { ...alertsRef.current.states[state], ...patch } } });
  const addCustomReminder = () => {
    const rmd: CustomReminder = { id: genReminderId(), name: '新提醒', enabled: true, anchor: 'beforeStart', offsetMin: 30, tone: '15min', label: '提醒', title: '距开考��有一段时间', subtext: '请提前做好准备' };
    commitAlerts({ ...alertsRef.current, custom: [...alertsRef.current.custom, rmd] });
  };
  const updateCustomReminder = (id: string, patch: Partial<CustomReminder>) =>
    commitAlerts({ ...alertsRef.current, custom: alertsRef.current.custom.map(c => c.id === id ? { ...c, ...patch } : c) });
  const removeCustomReminder = (id: string) =>
    commitAlerts({ ...alertsRef.current, custom: alertsRef.current.custom.filter(c => c.id !== id) });
  const resetAlerts = () => commitAlerts(normalizeAlerts(DEFAULT_ALERTS));

  const importJson = () => {
    setImportError('');
    try {
      const source = JSON.parse(importText);
      const list = Array.isArray(source) ? source : source.items;
      if (!Array.isArray(list)) throw new Error('JSON 必须是考试数组，或包含 items 数组');
      const next = list.map((raw: unknown, index: number) => {
        const row = raw as Record<string, unknown>;
        if (!row.name || !row.startTime || !row.endTime) throw new Error(`第 ${index + 1} 项缺少 name、startTime 或 endTime`);
        return { id: String(row.id ?? makeId()), name: String(row.name), startTime: String(row.startTime), endTime: String(row.endTime), enabled: row.enabled !== false, order: typeof row.order === 'number' ? row.order : index };
      });
      const chronological = normalizeExamItems(next);
      // 可选：导入文件重命名当前大型考试
      const nextName = typeof source.title === 'string' && source.title.trim() ? source.title.trim() : activeMajor.name;
      const ms = majors.map(m => m.id === activeMajorId ? { ...m, name: nextName, items: chronological } : m);
      commit(ms, activeMajorId);
      setImportText(''); setImportOpen(false);
    } catch (error) { setImportError(error instanceof Error ? error.message : 'JSON 格式错误'); }
  };

  const exportJson = () => {
    const file = new Blob([JSON.stringify({ title: activeMajor.name, items, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(file); const link = document.createElement('a');
    link.href = url; link.download = `${activeMajor.name || 'exam-board'}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };

  if (!ready) return <div className="admin-loading">正在验证管理权限…</div>;

  const syncMeta = SYNC_META[sync];
  const editDurationMs = editing?.startTime && editing?.endTime ? new Date(editing.endTime).getTime() - new Date(editing.startTime).getTime() : 0;
  const isLongEdit = Number.isFinite(editDurationMs) && editDurationMs > 6 * 60 * 60 * 1000;

  return <div className="admin-page">
    <Watermark />
    <header className="admin-header">
      <div className="admin-header__left"><button className="admin-back-btn" onClick={() => navigate('/')}>← 返回</button><h1 className="admin-header__title">考试管理</h1>{activeMajor && <span className="admin-header__major" title="当前大型考试"><span className="admin-header__major-dot" />{activeMajor.name}<span className="admin-header__major-count">{items.length} 科</span></span>}</div>
      <div className="admin-header__right">
        <span className={`admin-cloud ${syncMeta.cls}`} title={online ? '云服务在线' : '当前离线'}>
          <span className="admin-cloud__dot" />{syncMeta.label}
        </span>
        <button className="admin-btn admin-btn--primary" onClick={() => setAlertsOpen(true)}>🔔 提醒管理{alerts.enabled ? '' : '（已停用）'}</button>
        <button className="admin-btn" onClick={() => setAnnounceOpen(true)}>📢 公告</button>
        <div className="admin-header__desktop-data"><button className="admin-btn" onClick={() => setImportOpen(true)}>导入 JSON</button><button className="admin-btn" onClick={exportJson}>导出 JSON</button></div>
        <div className="admin-more"><button ref={moreTriggerRef} className="admin-btn admin-more__trigger" onClick={() => { if (moreOpen) { setMoreOpen(false); return; } const rect = moreTriggerRef.current?.getBoundingClientRect(); if (rect && window.matchMedia('(max-width: 600px)').matches) { const width = Math.min(260, window.innerWidth - 28); setMoreMenuStyle({ position: 'fixed', top: Math.min(rect.bottom + 8, window.innerHeight - 110), left: Math.min(Math.max(14, rect.left), window.innerWidth - width - 14), width }); } else setMoreMenuStyle({}); setMoreOpen(true); }} aria-expanded={moreOpen}>⋯ 更多</button>{moreOpen && <div className="admin-more__menu" style={moreMenuStyle}><button onClick={() => { setImportOpen(true); setMoreOpen(false); }}>导入 JSON</button><button onClick={() => { exportJson(); setMoreOpen(false); }}>导出 JSON</button></div>}</div>
        <button className="admin-btn" onClick={() => navigate('/settings')}>🛠️ 设置</button>
      </div>
    </header>
    <div className="admin-tabbar">
      <div className="admin-tabbar__tabs">
        <button className={`admin-tab${adminTab === 'major' ? ' is-active' : ''}`} onClick={() => setAdminTab('major')}>🏫 大型考试</button>
        <button className={`admin-tab${adminTab === 'weekly' ? ' is-active' : ''}`} onClick={() => setAdminTab('weekly')}>📅 周测{weeklyPlans.length ? `（${weeklyPlans.length}）` : ''}</button>
      </div>
      <label className="admin-tabbar__mode">运行模式
        <select className="admin-input" value={scheduleMode} onChange={e => handleScheduleModeChange(e.target.value as ScheduleMode)}>
          <option value="major-only">仅大型考试</option>
          <option value="weekly-only">仅周测</option>
          <option value="automatic">自动（大型考试优先，自动避让周测）</option>
        </select>
      </label>
    </div>
    <div className="admin-body">
      {adminTab === 'weekly' ? (
        <WeeklyPanel
          weeklyPlans={weeklyPlans}
          activeWeeklyPlanId={activeWeeklyPlanId}
          scheduleMode={scheduleMode}
          weeklyConflictPolicy={weeklyConflictPolicy}
          majorItems={items}
          majorName={activeMajor?.name ?? ''}
          onSavePlans={handleSaveWeeklyPlans}
          onConflictPolicyChange={handleConflictPolicyChange}
        />
      ) : (
      <>
      <aside className="admin-sidebar">
        {/* 大型考试：添加 / 切换 / 重命名 / 删除 */}
        <div className="admin-major-card">
          <div className="admin-major-card__head"><label className="admin-label" style={{ opacity: .9 }}>大型考试</label><span className="admin-major-card__count">共 {majors.length} 场</span></div>
          <div className="admin-major-card__active">
            <span className="admin-major-card__active-name" title={activeMajor?.name}>{activeMajor?.name || '未命名考试'}</span>
            <span className="admin-major-card__active-meta">{items.length} 个分考试 · {items.filter(i => i.enabled).length} 个启用</span>
          </div>
          {majors.length > 1 && (
            <label className="admin-major-card__switch">
              <span className="admin-major-card__switch-k">切换考试</span>
              <select className="admin-input admin-major-select" value={activeMajorId} onChange={e => switchMajor(e.target.value)}>
                {majors.map(m => <option key={m.id} value={m.id}>{m.name}（{m.items.length} 科）</option>)}
              </select>
            </label>
          )}
          <div className="admin-major-card__btns">
            <button className="admin-btn admin-btn--primary" onClick={() => { setMajorModal({ mode: 'add', name: '' }); setMajorError(''); }}>+ 新建</button>
            <button className="admin-btn" onClick={() => { setMajorModal({ mode: 'rename', name: activeMajor.name }); setMajorError(''); }}>重命名</button>
            <button className="admin-btn admin-btn--danger" onClick={() => setDeleteMajorOpen(true)} disabled={majors.length <= 1}>删除</button>
          </div>
          <p className="admin-major-card__hint">切换后大屏与本页均展示该大型考试的分考试。</p>
        </div>

        {editing ? <div className="admin-form-card">
          <h2 className="admin-form-card__title">{editing.id ? '编辑分考试' : '添加分考试'}</h2>
          {editError && <div className="admin-error">{editError}</div>}
          <div className="admin-form">
            <label className="admin-label">科目名称<input className="admin-input" value={editing.name} onChange={e => setEditing(p => p && { ...p, name: e.target.value })} placeholder="如：语文" /></label>
            <label className="admin-label">开始时间<input className="admin-input" type="datetime-local" value={fmtLocal(editing.startTime)} onChange={e => { setLongDurationConfirmed(false); setEditing(p => p && { ...p, startTime: toISO(e.target.value) }); }} /></label>
            <label className="admin-label">结束时间<input className="admin-input" type="datetime-local" value={fmtLocal(editing.endTime)} onChange={e => { setLongDurationConfirmed(false); setEditing(p => p && { ...p, endTime: toISO(e.target.value) }); }} />{editing.startTime && editing.endTime && <span className="admin-duration-hint">历时 {duration(editing.startTime, editing.endTime)}</span>}</label>
            {isLongEdit && <label className="admin-long-duration"><input type="checkbox" checked={longDurationConfirmed} onChange={e => setLongDurationConfirmed(e.target.checked)} />我确认这是超过 6 小时的跨天或特殊考试安排</label>}
            <label className="admin-toggle-label"><input type="checkbox" checked={editing.enabled} onChange={e => setEditing(p => p && { ...p, enabled: e.target.checked })} />启用此科目</label>
            <div className="admin-form-actions"><button className="admin-btn admin-btn--primary" onClick={commitEdit}>确认并保存</button><button className="admin-btn admin-btn--ghost" onClick={() => { setEditing(null); setEditError(''); }}>取消</button></div>
          </div>
        </div> : <button className="admin-btn admin-btn--primary" style={{ width: '100%' }} onClick={() => { setLongDurationConfirmed(false); setEditing({ name: '', startTime: '', endTime: '', enabled: true }); }}>+ 添加分考试</button>}
        <div className="admin-tips"><p className="admin-tips__title">💡 使用说明</p><ul><li>每次修改会自动保存并同步到云（Neon）</li><li>离线时仍可编辑，数据先存本地，联网后自动回推</li><li>不同大型考试各自拥有独立的分考试列表</li><li>大屏每 30 秒自动拉取最新数据</li></ul></div>
      </aside>
      <main className="admin-main">
        <div className="admin-list-header"><h2 className="admin-list-title">{activeMajor.name} · 分考试</h2><span className="admin-list-count">{items.length} 项</span>{items.length > 0 && <button className="admin-btn admin-btn--ghost admin-list-collapse" onClick={() => setCollapsedList(v => !v)} aria-expanded={!collapsedList}>{collapsedList ? "展开列表" : "折叠列表"}</button>}</div>{lastDeletedExam && <div className="admin-undo"><span>已删除「{lastDeletedExam.item.name}」</span><button className="admin-btn admin-btn--ghost" onClick={restoreExam}>撤销删除</button></div>}
        {items.length === 0 ? <div className="admin-empty"><div className="admin-empty__icon">📅</div><p>当前大型考试暂无分考试，点击左侧“添加分考试”开始</p></div> : collapsedList ? <div className="admin-collapsed-hint">列表已折叠（共 {items.length} 项），点击“展开列表”查看</div> : <ul className="admin-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{items.map((item, index) => {
          const status = STATUS[phase(item)];
          return <li className={`admin-item${!item.enabled ? ' admin-item--disabled' : ''}`} key={item.id}>
            <div className="admin-item__order"><span className="admin-item__order-num">#{index + 1}</span></div>
            <div className="admin-item__info"><div className="admin-item__name-row"><span className="admin-item__name">{item.name}</span><span className="admin-item__status" style={{ color: status.color, background: status.bg }}>{status.label}</span>{!item.enabled && <span className="admin-item__status" style={{ color: '#6c757d', background: 'rgba(108,117,125,.1)' }}>已禁用</span>}</div><div className="admin-item__times"><span>{fmtLocal(item.startTime)}</span><span className="admin-item__times-sep">–</span><span>{fmtLocal(item.endTime)}</span><span className="admin-item__duration">{duration(item.startTime, item.endTime)}</span></div></div>
            <div className="admin-item__actions"><button type="button" className={`admin-item-btn admin-item-btn--toggle ${item.enabled ? 'admin-item-btn--disable' : 'admin-item-btn--enable'}`} title={item.enabled ? '停用后不会出现在首页、大屏或提醒中' : '启用后会参与首页、大屏和提醒计算'} aria-label={`${item.enabled ? '停用' : '启用'}${item.name}`} onClick={() => setExamEnabled(item.id, !item.enabled)}>{item.enabled ? '停用' : '启用'}</button><button className="admin-item-btn" onClick={() => { setLongDurationConfirmed(false); setEditing({ ...item }); }}>编辑</button><button className="admin-item-btn admin-item-btn--delete" onClick={() => setDeleteTarget(item)}>删除</button></div>
          </li>;
        })}</ul>}
      </main>
      </>
      )}
    </div>
    {majorModal && <div className="admin-modal-overlay" onClick={() => setMajorModal(null)}><div className="admin-modal" onClick={e => e.stopPropagation()}><h2 className="admin-modal__title">{majorModal.mode === 'add' ? '新建大型考试' : '重命名大型考试'}</h2>{majorError && <div className="admin-error">{majorError}</div>}<label className="admin-label">名称<input className="admin-input" autoFocus value={majorModal.name} onChange={e => setMajorModal(p => p && { ...p, name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') commitMajorModal(); }} placeholder="如：2026年高考 / 高三一模" /></label><div className="admin-modal__actions"><button className="admin-btn admin-btn--primary" onClick={commitMajorModal}>确认</button><button className="admin-btn" onClick={() => { setMajorModal(null); setMajorError(''); }}>取消</button></div></div></div>}
    {deleteMajorOpen && <div className="admin-modal-overlay" onClick={() => setDeleteMajorOpen(false)}><div className="admin-modal" onClick={e => e.stopPropagation()}><h2 className="admin-modal__title">删除大型考试</h2><p className="admin-modal__body">确定删除「{activeMajor.name}」及其全部 {items.length} 项分考试？此操作无法撤销。</p><div className="admin-modal__actions"><button className="admin-btn admin-btn--danger" onClick={removeMajor}>删除</button><button className="admin-btn" onClick={() => setDeleteMajorOpen(false)}>取消</button></div></div></div>}
    {deleteTarget && <div className="admin-modal-overlay" onClick={() => setDeleteTarget(null)}><div className="admin-modal" onClick={e => e.stopPropagation()}><h2 className="admin-modal__title">确认删除</h2><p className="admin-modal__body">确定删除「{deleteTarget.name}」？此操作无法撤销。</p><div className="admin-modal__actions"><button className="admin-btn admin-btn--danger" onClick={() => remove(deleteTarget)}>删除</button><button className="admin-btn" onClick={() => setDeleteTarget(null)}>取消</button></div></div></div>}
    {alertsOpen && <div className="admin-modal-overlay" onClick={() => setAlertsOpen(false)}>
      <div className="admin-modal admin-modal--wide admin-alerts" onClick={e => e.stopPropagation()}>
        <div className="admin-alerts__head">
          <h2 className="admin-modal__title" style={{ margin: 0 }}>🔔 统一提醒管理</h2>
          <button className="admin-btn admin-btn--ghost" onClick={() => setAlertsOpen(false)}>关闭</button>
        </div>
        <p className="admin-alerts__lead">开考各阶段自动弹出<strong>全屏提醒浮层</strong>；浮层风格<strong>自动跟随大屏当前设计</strong>（共 5 套：深色指挥舱 / 清爽聚焦 / 校园黑板 / 高对比应急 / 编辑排版），无需单独配置。文案支持占位符 <code>{'{subject}'}</code>、<code>{'{start}'}</code>、<code>{'{end}'}</code>、<code>{'{next}'}</code>、<code>{'{nextTime}'}</code>。</p>

        <div className="admin-alerts__bar">
          <label className="admin-toggle-label"><input type="checkbox" checked={alerts.enabled} onChange={e => setAlertsEnabled(e.target.checked)} />启用全屏提醒浮层</label>
          <label className="admin-alerts__dur">默认停留时长
            <input className="admin-input" type="number" min={4} max={15} value={alerts.durationSec} onChange={e => setAlertsDuration(Math.min(15, Math.max(4, Number(e.target.value) || 8)))} />
            <span>秒</span>
          </label>
          <button className="admin-btn admin-btn--ghost" onClick={resetAlerts}>恢复默认文案</button>
        </div>

        <div className={`admin-alerts__section${alerts.enabled ? '' : ' is-dim'}`}>
          <h3 className="admin-alerts__subtitle">内置阶段提醒（6 项）</h3>
          <div className="admin-alerts__grid">
            {ALERT_STATE_ORDER.map(st => {
              const cfg = alerts.states[st]; const meta = ALERT_STATE_META[st];
              return <div className={`admin-alert-card${cfg.enabled ? '' : ' is-off'}`} key={st}>
                <div className="admin-alert-card__head">
                  <div><span className="admin-alert-card__name">{meta.name}</span><span className="admin-alert-card__timing">{meta.timing}</span></div>
                  <label className="admin-switch"><input type="checkbox" checked={cfg.enabled} onChange={e => updateStateCfg(st, { enabled: e.target.checked })} /><span /></label>
                </div>
                <div className="admin-alert-card__fields">
                  <label>状态标签<input className="admin-input" value={cfg.label} onChange={e => updateStateCfg(st, { label: e.target.value })} /></label>
                  <label>主文案<input className="admin-input" value={cfg.title} onChange={e => updateStateCfg(st, { title: e.target.value })} /></label>
                  <label>副提示<input className="admin-input" value={cfg.subtext} onChange={e => updateStateCfg(st, { subtext: e.target.value })} /></label>
                  {(st === 'start' || st === 'ended') && <label>主视觉文字<input className="admin-input" value={cfg.hero ?? ''} onChange={e => updateStateCfg(st, { hero: e.target.value })} /></label>}
                </div>
              </div>;
            })}
          </div>
        </div>

        <div className={`admin-alerts__section${alerts.enabled ? '' : ' is-dim'}`}>
          <div className="admin-alerts__section-head">
            <h3 className="admin-alerts__subtitle">自定义提醒（{alerts.custom.length}）</h3>
            <button className="admin-btn admin-btn--primary" onClick={addCustomReminder}>+ 添加提醒</button>
          </div>
          {alerts.custom.length === 0 ? <p className="admin-alerts__empty">暂无自定义提醒。可添加如「开考前 30 分钟入场」「结束前 5 分钟」等提示。</p> :
            <div className="admin-alerts__custom">{alerts.custom.map(c => (
              <div className={`admin-alert-card${c.enabled ? '' : ' is-off'}`} key={c.id}>
                <div className="admin-alert-card__head">
                  <input className="admin-input admin-alert-card__title-input" value={c.name} onChange={e => updateCustomReminder(c.id, { name: e.target.value })} placeholder="提醒名称" />
                  <div className="admin-alert-card__head-actions">
                    <label className="admin-switch"><input type="checkbox" checked={c.enabled} onChange={e => updateCustomReminder(c.id, { enabled: e.target.checked })} /><span /></label>
                    <button className="admin-item-btn admin-item-btn--delete" onClick={() => removeCustomReminder(c.id)}>删除</button>
                  </div>
                </div>
                <div className="admin-alert-card__row">
                  <label>触发
                    <select className="admin-input" value={c.anchor} onChange={e => updateCustomReminder(c.id, { anchor: e.target.value as CustomReminder['anchor'] })}>
                      {ANCHOR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                  <label>分钟
                    <input className="admin-input" type="number" min={0} max={600} value={c.offsetMin} onChange={e => updateCustomReminder(c.id, { offsetMin: Math.max(0, Number(e.target.value) || 0) })} />
                  </label>
                  <label>配色
                    <select className="admin-input" value={c.tone} onChange={e => updateCustomReminder(c.id, { tone: e.target.value as AlertState })}>
                      {TONE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="admin-alert-card__fields">
                  <label>状态标签<input className="admin-input" value={c.label} onChange={e => updateCustomReminder(c.id, { label: e.target.value })} /></label>
                  <label>主文案<input className="admin-input" value={c.title} onChange={e => updateCustomReminder(c.id, { title: e.target.value })} /></label>
                  <label>副提示<input className="admin-input" value={c.subtext} onChange={e => updateCustomReminder(c.id, { subtext: e.target.value })} /></label>
                </div>
              </div>
            ))}</div>}
        </div>
      </div>
    </div>}
    {announceOpen && <div className="admin-modal-overlay" onClick={() => setAnnounceOpen(false)}>
      <div className="admin-modal admin-modal--wide admin-announce" onClick={e => e.stopPropagation()}>
        <div className="admin-alerts__head">
          <h2 className="admin-modal__title" style={{ margin: 0 }}>📢 公告</h2>
          <button className="admin-btn admin-btn--ghost" onClick={() => setAnnounceOpen(false)}>关闭</button>
        </div>
        <p className="admin-alerts__lead">公告由作者端统一发布，内容以 Markdown 渲染；本页仅供查看。</p>
        {annLoading ? (
          <div className="admin-announce__empty">公告加载中…</div>
        ) : anns.length === 0 ? (
          <div className="admin-announce__empty">暂无公告。</div>
        ) : (
          <AnnouncementList announcements={anns} formatTime={fmtAnnTime} />
        )}
      </div>
    </div>}
    {importOpen && <div className="admin-modal-overlay" onClick={() => setImportOpen(false)}><div className="admin-modal admin-modal--wide" onClick={e => e.stopPropagation()}><h2 className="admin-modal__title">导入分考试 JSON</h2><p className="admin-modal__body">导入到当前大型考试「{activeMajor.name}」，导入后自动保存到云。支持纯数组，或含 <code>title</code> 与 <code>items</code> 的备份文件。</p>{importError && <div className="admin-error">{importError}</div>}<textarea className="admin-textarea" rows={11} value={importText} onChange={e => setImportText(e.target.value)} placeholder='{"title":"2026年高考","items":[{"name":"语文","startTime":"2026-06-07T09:00:00","endTime":"2026-06-07T11:30:00","enabled":true}]}' /><div className="admin-modal__actions"><button className="admin-btn admin-btn--primary" onClick={importJson}>导入并自动保存</button><button className="admin-btn" onClick={() => { setImportOpen(false); setImportError(''); }}>取消</button></div></div></div>}
  </div>;
}
