import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Watermark from '../components/Watermark';
import type { ExamItem, MajorExam, AlertsSettings, AlertState, CustomReminder } from '../types';
import { getAppSettings, updateExamSettings, updateAlertsSettings, genMajorId, genReminderId, DEFAULT_ALERTS, normalizeAlerts } from '../utils/appSettings';
import { adminCan, fetchExamsFromServer, getAdminUser, getCloudSnapshot, hasValidLocalToken, isLoginRequired, logoutAdmin, refreshAdminUser, saveExamsToServer, type AdminUserContext } from '../services/examService';
import { threeWayMergeExam } from '../utils/examMerge';
import { clearPendingExamSync, getPendingExamSync, queuePendingExamSync } from '../services/examOutbox';
import { normalizeExamItems } from '../utils/examSchedule';
import { recordSyncConflict } from '../services/offlineStore';
import { fetchAnnouncements } from '../services/announcements';
import type { Announcement } from '../services/announcements';
import { renderMarkdown } from '../utils/renderMarkdown';
import AnnouncementList from '../components/AnnouncementList';
import WeeklyPanel from '../components/WeeklyPanel';
import DeviceStatusPanel from '../components/DeviceStatusPanel';
import ClassManagementPanel from '../components/ClassManagementPanel';
import InitializationWizard from '../components/InitializationWizard';
import UserManagementPanel from '../components/UserManagementPanel';
import HelpTip from '../components/HelpTip';
import ModuleIcon from '../components/ModuleIcon';
import OverviewPanel from '../components/OverviewPanel';
import AiImportGuide from '../components/AiImportGuide';
import AccessDenied from '../components/AccessDenied';
import SchedulePrintPreview from '../components/SchedulePrintPreview';
import { notify } from '../services/notify';
import type { InitializationResult } from '../utils/initializationData';
import { useBackdropDismiss } from '../hooks/useBackdropDismiss';
import { saveDeviceBinding } from '../services/classBinding';
import type { AdminTab, ScheduleMode, WeeklyPlan, WeeklyConflictPolicy } from '../types/exam';
import type { SchoolClass, SchoolGrade } from '../types/school';
import { genClassId, genGradeId } from '../types/school';
import '../styles/admin.css';
import { ArrowLeft, Bell, CalendarDays, CircleHelp, Megaphone } from 'lucide-react';

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
  loading: { label: '连接中', cls: 'is-loading' },
  saving: { label: '同步中', cls: 'is-saving' },
  saved: { label: '已同步', cls: 'is-saved' },
  offline: { label: '离线 · 待同步', cls: 'is-offline' },
  error: { label: '同步失败', cls: 'is-error' },
};

type EditItem = Omit<ExamItem, 'id' | 'order'> & { id?: string };
type MajorModal = { mode: 'add' | 'rename'; name: string; targetGradeIds: string[] } | null;

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
const OPEN_ADMIN: AdminUserContext = { id: 0, username: 'local-admin', displayName: '本地管理员', roleId: 'super_admin', roleName: '超级管理员', permissions: ['*'], scopes: [{ type: 'all', gradeId: '', classId: '' }], mustChangePassword: false };
const ADMIN_NAV: Array<{ id: AdminTab; label: string; mobileLabel: string; permission: string }> = [
  { id: 'overview', label: '运行总览', mobileLabel: '总览', permission: 'overview.read' },
  { id: 'major', label: '大型考试', mobileLabel: '考试', permission: 'major.read' },
  { id: 'weekly', label: '周测计划', mobileLabel: '周测', permission: 'weekly.read' },
  { id: 'classes', label: '年级与班级', mobileLabel: '班级', permission: 'school.read' },
  { id: 'devices', label: '设备管理', mobileLabel: '设备', permission: 'device.read' },
  { id: 'users', label: '用户与权限', mobileLabel: '用户', permission: 'user.read' },
];
const ANCHOR_OPTIONS: Array<{ value: CustomReminder['anchor']; label: string }> = [
  { value: 'beforeStart', label: '开考前' },
  { value: 'afterStart', label: '开考后' },
  { value: 'beforeEnd', label: '结束前' },
];

export default function AdminPage() {
  const backdropProps = useBackdropDismiss();
  const navigate = useNavigate();
  const location = useLocation();
  const initial = getAppSettings().exam;

  const [majors, setMajors] = useState<MajorExam[]>(initial.majors);
  const [activeMajorId, setActiveMajorId] = useState<string>(initial.activeMajorId);
  const [editingMajorId, setEditingMajorId] = useState<string>(initial.activeMajorId);
  const [adminTab, setAdminTab] = useState<AdminTab>(initial.grades.length === 0 || initial.classes.length === 0 ? 'classes' : 'overview');
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(initial.scheduleMode);
  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlan[]>(initial.weeklyPlans);
  const [activeWeeklyPlanId, setActiveWeeklyPlanId] = useState<string | null>(initial.activeWeeklyPlanId);
  const [activeWeeklyPlanIdByClassId, setActiveWeeklyPlanIdByClassId] = useState<Record<string, string | null>>(initial.activeWeeklyPlanIdByClassId);
  const [grades, setGrades] = useState<SchoolGrade[]>(initial.grades);
  const [classes, setClasses] = useState<SchoolClass[]>(initial.classes);
  const [selectedGradeId, setSelectedGradeId] = useState(initial.selectedGradeId || initial.grades[0]?.id || '');
  const [selectedClassId, setSelectedClassId] = useState(initial.selectedClassId);
  const [weeklyConflictPolicy, setWeeklyConflictPolicy] = useState<WeeklyConflictPolicy>(initial.weeklyConflictPolicy);
  const [initialization, setInitialization] = useState(initial.initialization);
  const [wizardOpen, setWizardOpen] = useState(() => !initial.initialization.completedAt || initial.grades.length === 0 || initial.classes.length === 0);
  // 有本地令牌时初始即就绪，立即渲染后台（本地缓存数据），鉴权与拉取在后台并行进行。
  const [ready, setReady] = useState<boolean>(() => hasValidLocalToken());
  const [adminUser, setAdminUser] = useState<AdminUserContext | null>(() => getAdminUser());
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
  const [majorPrintOpen, setMajorPrintOpen] = useState(false);
  const [editingMajorIdByGrade, setEditingMajorIdByGrade] = useState<Record<string, string>>({});
  const [sync, setSync] = useState<SyncState>('loading');
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  // 统一提醒管理
  const [alerts, setAlerts] = useState<AlertsSettings>(() => getAppSettings().alerts);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertsSection, setAlertsSection] = useState<'builtin' | 'custom'>('builtin');
  // 公告展示（作者端统一发布，本端只读）
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [anns, setAnns] = useState<Announcement[]>([]);
  const [annLoading, setAnnLoading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreMenuStyle, setMoreMenuStyle] = useState<React.CSSProperties>({});
  const [longDurationConfirmed, setLongDurationConfirmed] = useState(false);
  const [deniedModule, setDeniedModule] = useState('');

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pendingRef = useRef(false); // 是否有尚未推送到服务器的本地变更
  const stateRef = useRef({ majors, activeMajorId });
  stateRef.current = { majors, activeMajorId };
  const weeklySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const weeklyStateRef = useRef({ scheduleMode, weeklyPlans, activeWeeklyPlanId, activeWeeklyPlanIdByClassId, grades, classes, weeklyConflictPolicy });
  weeklyStateRef.current = { scheduleMode, weeklyPlans, activeWeeklyPlanId, activeWeeklyPlanIdByClassId, grades, classes, weeklyConflictPolicy };
  const initializationRef = useRef(initialization);
  initializationRef.current = initialization;
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  // 从设置页「前往提醒管理」直达：URL 带 ?alerts=1 时自动打开提醒管理弹窗
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedTab = params.get('tab') as AdminTab | null;
    if (requestedTab && ADMIN_NAV.some(item => item.id === requestedTab)) {
      const item = ADMIN_NAV.find(value => value.id === requestedTab)!;
      if (requestedTab === 'users' || adminCan(item.permission, adminUser)) { setAdminTab(requestedTab); setDeniedModule(''); }
      else setDeniedModule(item.label);
    }
    if (params.get('alerts') === '1' && adminCan('alerts.read', adminUser)) setAlertsOpen(true);
    if (params.get('announce') === '1') setAnnounceOpen(true);
  }, [adminUser, location.search]);

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

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.admin-more')) setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOnOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, [moreOpen]);

  const scopedMajors = selectedGradeId
    ? majors.filter(major => !major.targetGradeIds?.length || major.targetGradeIds.includes(selectedGradeId))
    : [];
  const orderedScopedMajors = [...scopedMajors].sort((a, b) => {
    const aSpecific = a.targetGradeIds?.includes(selectedGradeId) ? 0 : 1;
    const bSpecific = b.targetGradeIds?.includes(selectedGradeId) ? 0 : 1;
    if (aSpecific !== bSpecific) return aSpecific - bSpecific;
    const now = Date.now();
    const score = (major: MajorExam) => {
      const enabled = major.items.filter(item => item.enabled);
      const start = Math.min(...enabled.map(item => new Date(item.startTime).getTime()));
      const end = Math.max(...enabled.map(item => new Date(item.endTime).getTime()));
      if (Number.isFinite(start) && now >= start && now <= end) return 0;
      if (Number.isFinite(start) && start > now) return 1;
      return 2;
    };
    const phaseDiff = score(a) - score(b);
    if (phaseDiff) return phaseDiff;
    const aStart = Math.min(...a.items.map(item => new Date(item.startTime).getTime()).filter(Number.isFinite));
    const bStart = Math.min(...b.items.map(item => new Date(item.startTime).getTime()).filter(Number.isFinite));
    return (Number.isFinite(aStart) ? aStart : Number.MAX_SAFE_INTEGER) - (Number.isFinite(bStart) ? bStart : Number.MAX_SAFE_INTEGER) || a.order - b.order;
  });
  const hasScopedMajor = orderedScopedMajors.length > 0;
  const activeMajor: MajorExam = orderedScopedMajors.find(m => m.id === editingMajorId) ?? orderedScopedMajors[0] ?? { id: '', name: '当前年级暂无大型考试', items: [], order: -1, targetGradeIds: selectedGradeId ? [selectedGradeId] : [] };
  const items = activeMajor?.items ?? [];
  const activeMajorApplies = !activeMajor?.targetGradeIds?.length || (!!selectedGradeId && activeMajor.targetGradeIds.includes(selectedGradeId));

  const changeSelectedGrade = (gradeId: string) => {
    setSelectedGradeId(gradeId); setSelectedClassId('');
    const candidates = majors.filter(major => !major.targetGradeIds?.length || major.targetGradeIds.includes(gradeId));
    const remembered = editingMajorIdByGrade[gradeId];
    const nextMajor = candidates.find(major => major.id === remembered)
      ?? candidates.find(major => major.targetGradeIds?.includes(gradeId))
      ?? candidates[0];
    if (nextMajor) setEditingMajorId(nextMajor.id);
    updateExamSettings({ selectedGradeId: gradeId, selectedClassId: '' });
  };
  const changeSelectedClass = (classId: string) => {
    setSelectedClassId(classId);
    updateExamSettings({ selectedGradeId, selectedClassId: classId });
    if (selectedGradeId && classId) void saveDeviceBinding(selectedGradeId, classId);
  };

  // 构造待推送的完整载荷（items/title 镜像激活大型考试）
  const buildPayload = (ms: MajorExam[], activeId: string) => {
    const active = ms.find(m => m.id === activeId) ?? ms[0];
    return { items: active?.items ?? [], title: active?.name ?? '', majors: ms, activeMajorId: activeId, alerts: alertsRef.current, ...weeklyStateRef.current, initialization: initializationRef.current };
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
        notify('error', '云端冲突数据不完整，本机修改已保留；请刷新后台后再保存。', '同步失败');
        return;
      }
      const local = { ...payload, updatedAt: queued?.baseSnapshot?.updatedAt ?? baseSnapshot?.updatedAt ?? 0 };
      const merged = threeWayMergeExam(baseSnapshot ?? result.remote, local, result.remote);
      if (merged.conflictCount) void recordSyncConflict(merged.conflictCount, local, result.remote);
      const { alerts: mergedAlerts, ...mergedExam } = merged.payload;
      const normalizedMergedExam = {
        ...mergedExam,
        weeklyConflictPolicy: mergedExam.weeklyConflictPolicy ?? weeklyStateRef.current.weeklyConflictPolicy,
      };
      // 先把合并结果持久化到本机；同字段并发冲突时自动保留当前操作者的值。
      setMajors(merged.payload.majors);
      setActiveMajorId(merged.payload.activeMajorId);
      const mergedQueuedAt = Date.now();
      queuePendingExamSync({ payload: merged.payload, baseSnapshot: result.remote, savedAt: mergedQueuedAt });
      updateExamSettings({ ...normalizedMergedExam, updatedAt: result.remote.updatedAt });
      if (mergedAlerts) {
        updateAlertsSettings({ ...mergedAlerts, updatedAt: result.remote.updatedAt });
        setAlerts(getAppSettings().alerts);
      }
      const retry = await saveExamsToServer({ ...merged.payload, baseUpdatedAt: result.remote.updatedAt });
      if (typeof retry === 'number') {
        pendingRef.current = false;
        clearPendingExamSync(mergedQueuedAt);
        updateExamSettings({ ...normalizedMergedExam, updatedAt: retry });
        if (mergedAlerts) updateAlertsSettings({ ...mergedAlerts, updatedAt: retry });
        setSync('saved');
        if (merged.conflictCount) notify('warning', `已合并本机与云端修改；${merged.conflictCount} 个同字段冲突保留本机值。`, '数据冲突已处理');
        return;
      }
      pendingRef.current = true;
      setSync(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
      notify('error', '自动合并后云端再次发生变化，结果已保留在本机，请稍后重新保存。', '同步失败');
      return;
    }
    if (typeof result !== 'number') {
      pendingRef.current = true;
      setSync(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
      return;
    }
    pendingRef.current = false;
    clearPendingExamSync(queued?.savedAt);
    const { alerts: pAlerts, ...examPayload } = payload;
    updateExamSettings({
      ...examPayload,
      weeklyConflictPolicy: queued?.payload.weeklyConflictPolicy ?? weeklyStateRef.current.weeklyConflictPolicy,
      updatedAt: result,
    });
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
    const ms = stateRef.current.majors.map(m => m.id === editingMajorId ? { ...m, items: nextItems } : m);
    commit(ms, stateRef.current.activeMajorId);
  }, [commit, editingMajorId]);

  // ===== 周测：与大型考试独立的推送通道，复用 /api/exams 与其冲突返回结构 =====
  const pushWeeklyToServer = useCallback(async (weekly: { scheduleMode: ScheduleMode; weeklyPlans: WeeklyPlan[]; activeWeeklyPlanId: string | null; activeWeeklyPlanIdByClassId: Record<string, string | null>; grades: SchoolGrade[]; classes: SchoolClass[]; weeklyConflictPolicy: WeeklyConflictPolicy }) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      pendingRef.current = true; setSync('offline');
      // 持久化到本地 outbox，确保离线时的周测编辑在应用重启后仍能在恢复联网时推送。
      const queued = getPendingExamSync();
      const basePayload = queued?.payload ?? buildPayload(stateRef.current.majors, stateRef.current.activeMajorId);
      queuePendingExamSync({ payload: { ...basePayload, ...weekly }, baseSnapshot: queued?.baseSnapshot ?? getCloudSnapshot(), savedAt: Date.now() });
      return;
    }
    setSync('saving');
    const ms = stateRef.current.majors; const activeId = stateRef.current.activeMajorId;
    const base = buildPayload(ms, activeId);
    const baseUpdatedAt = getCloudSnapshot()?.updatedAt ?? 0;
    const result = await saveExamsToServer({ ...base, baseUpdatedAt, ...weekly });
    if (result === 'unauthorized') { navigate('/login?next=/admin', { replace: true }); return; }
    if (result && typeof result === 'object' && result.kind === 'conflict') {
      if (result.remote) {
        const baseline = getCloudSnapshot() ?? { ...result.remote, updatedAt: baseUpdatedAt };
        const merged = threeWayMergeExam(baseline, { ...base, ...weekly, updatedAt: baseUpdatedAt }, result.remote);
        const retry = await saveExamsToServer({ ...merged.payload, baseUpdatedAt: result.remote.updatedAt });
        if (typeof retry === 'number') {
          const mergedWeekly = { scheduleMode: merged.payload.scheduleMode ?? weekly.scheduleMode, weeklyPlans: merged.payload.weeklyPlans ?? weekly.weeklyPlans, activeWeeklyPlanId: merged.payload.activeWeeklyPlanId ?? null, activeWeeklyPlanIdByClassId: merged.payload.activeWeeklyPlanIdByClassId ?? {}, grades: merged.payload.grades ?? weekly.grades, classes: merged.payload.classes ?? weekly.classes, weeklyConflictPolicy: merged.payload.weeklyConflictPolicy ?? weekly.weeklyConflictPolicy };
          if (merged.payload.majors.length) { setMajors(merged.payload.majors); setActiveMajorId(merged.payload.activeMajorId || merged.payload.majors[0].id); }
          setScheduleMode(mergedWeekly.scheduleMode); setWeeklyPlans(mergedWeekly.weeklyPlans); setActiveWeeklyPlanId(mergedWeekly.activeWeeklyPlanId); setActiveWeeklyPlanIdByClassId(mergedWeekly.activeWeeklyPlanIdByClassId); setGrades(mergedWeekly.grades); setClasses(mergedWeekly.classes); setWeeklyConflictPolicy(mergedWeekly.weeklyConflictPolicy);
          weeklyStateRef.current = mergedWeekly;
          updateExamSettings({ ...merged.payload, ...mergedWeekly, updatedAt: retry });
          pendingRef.current = false; setSync('saved'); return;
        }
      }
      pendingRef.current = true; setSync('error');
      notify('error', '周测保存遇到云端变化，自动重试仍失败；请刷新后台后重新保存。', '同步失败');
      return;
    }
    if (typeof result !== 'number') { pendingRef.current = true; setSync(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error'); return; }
    pendingRef.current = false;
    updateExamSettings({ ...weekly, updatedAt: result });
    setSync('saved');
  }, [navigate]);

  const commitWeekly = useCallback((weekly: Partial<{ scheduleMode: ScheduleMode; weeklyPlans: WeeklyPlan[]; activeWeeklyPlanId: string | null; activeWeeklyPlanIdByClassId: Record<string, string | null>; grades: SchoolGrade[]; classes: SchoolClass[]; weeklyConflictPolicy: WeeklyConflictPolicy }>, immediate = false) => {
    const next = { ...weeklyStateRef.current, ...weekly };
    setScheduleMode(next.scheduleMode); setWeeklyPlans(next.weeklyPlans); setActiveWeeklyPlanId(next.activeWeeklyPlanId); setActiveWeeklyPlanIdByClassId(next.activeWeeklyPlanIdByClassId); setGrades(next.grades); setClasses(next.classes); setWeeklyConflictPolicy(next.weeklyConflictPolicy);
    weeklyStateRef.current = next;
    updateExamSettings({ ...next, updatedAt: Date.now() });
    pendingRef.current = true;
    if (weeklySaveTimer.current) clearTimeout(weeklySaveTimer.current);
    if (immediate) { void pushWeeklyToServer(next); return; }
    setSync(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'saving');
    weeklySaveTimer.current = setTimeout(() => { void pushWeeklyToServer(next); }, 650);
  }, [pushWeeklyToServer]);

  const handleScheduleModeChange = (mode: ScheduleMode) => commitWeekly({ scheduleMode: mode }, true);
  const handleSaveWeeklyPlans = (plans: WeeklyPlan[], activeId: string | null, classId: string, immediate = false) => {
    const nextByClass = { ...weeklyStateRef.current.activeWeeklyPlanIdByClassId, [classId]: activeId };
    commitWeekly({ weeklyPlans: plans, activeWeeklyPlanId: classId ? weeklyStateRef.current.activeWeeklyPlanId : activeId, activeWeeklyPlanIdByClassId: nextByClass }, immediate);
  };
  const handleConflictPolicyChange = (policy: WeeklyConflictPolicy, immediate = false) => commitWeekly({ weeklyConflictPolicy: policy }, immediate);
  const completeInitialization = (result: InitializationResult) => {
    const nextWeekly = {
      scheduleMode: result.scheduleMode,
      weeklyPlans: result.weeklyPlans,
      activeWeeklyPlanId: result.activeWeeklyPlanId,
      activeWeeklyPlanIdByClassId: result.activeWeeklyPlanIdByClassId,
      grades: result.grades,
      classes: result.classes,
      weeklyConflictPolicy,
    };
    const active = result.majors.find(item => item.id === result.activeMajorId) ?? result.majors[0];
    const now = Date.now();
    setMajors(result.majors); setActiveMajorId(result.activeMajorId); setEditingMajorId(result.activeMajorId);
    setScheduleMode(result.scheduleMode); setWeeklyPlans(result.weeklyPlans); setActiveWeeklyPlanId(result.activeWeeklyPlanId); setActiveWeeklyPlanIdByClassId(result.activeWeeklyPlanIdByClassId);
    setGrades(result.grades); setClasses(result.classes); setSelectedGradeId(''); setSelectedClassId(''); setInitialization(result.initialization);
    stateRef.current = { majors: result.majors, activeMajorId: result.activeMajorId };
    weeklyStateRef.current = nextWeekly;
    initializationRef.current = result.initialization;
    const payload = { items: active?.items ?? [], title: active?.name ?? '', majors: result.majors, activeMajorId: result.activeMajorId, alerts: alertsRef.current, ...nextWeekly, initialization: result.initialization };
    updateExamSettings({ ...payload, selectedGradeId: '', selectedClassId: '', updatedAt: now });
    clearPendingExamSync();
    queuePendingExamSync({ payload, baseSnapshot: getCloudSnapshot(), savedAt: now });
    pendingRef.current = true;
    setWizardOpen(false); setAdminTab('classes');
    void pushToServer(result.majors, result.activeMajorId);
  };
  const addGrade = (name: string) => { const item = { id: genGradeId(), name, order: grades.length, enabled: true }; commitWeekly({ grades: [...grades, item] }, true); if (!selectedGradeId) changeSelectedGrade(item.id); };
  const addClass = (gradeId: string, name: string) => { const item = { id: genClassId(), gradeId, name, order: classes.filter(value => value.gradeId === gradeId).length, enabled: true }; commitWeekly({ classes: [...classes, item], activeWeeklyPlanIdByClassId: { ...weeklyStateRef.current.activeWeeklyPlanIdByClassId, [item.id]: null } }, true); };
  const addClasses = (gradeId: string, names: string[]) => { if (!names.length) return; const start=classes.filter(value=>value.gradeId===gradeId).length; const created=names.map((name,index)=>({id:genClassId(),gradeId,name,order:start+index,enabled:true})); const nextActive={...weeklyStateRef.current.activeWeeklyPlanIdByClassId,...Object.fromEntries(created.map(item=>[item.id,null]))}; commitWeekly({classes:[...classes,...created],activeWeeklyPlanIdByClassId:nextActive},true); notify('success',`已创建 ${created.length} 个班级。`); };
  const removeClass = (classId: string) => {
    const nextMap = { ...weeklyStateRef.current.activeWeeklyPlanIdByClassId }; delete nextMap[classId];
    const nextPlans = weeklyPlans.filter(plan => plan.classId !== classId);
    const nextMajors = majors.map(major => ({ ...major, targetClassIds: major.targetClassIds?.filter(id => id !== classId) }));
    if (selectedClassId === classId) changeSelectedClass('');
    setMajors(nextMajors); stateRef.current = { majors: nextMajors, activeMajorId };
    updateExamSettings({ majors: nextMajors });
    commitWeekly({ classes: classes.filter(item => item.id !== classId), weeklyPlans: nextPlans, activeWeeklyPlanIdByClassId: nextMap }, true);
  };
  const removeGrade = (gradeId: string) => {
    const classIds = new Set(classes.filter(item => item.gradeId === gradeId).map(item => item.id));
    const nextMap = { ...weeklyStateRef.current.activeWeeklyPlanIdByClassId }; classIds.forEach(id => delete nextMap[id]);
    const nextMajors = majors.map(major => ({ ...major, targetGradeIds: major.targetGradeIds?.filter(id => id !== gradeId), targetClassIds: major.targetClassIds?.filter(id => !classIds.has(id)) }));
    if (selectedGradeId === gradeId) changeSelectedGrade('');
    setMajors(nextMajors); stateRef.current = { majors: nextMajors, activeMajorId };
    updateExamSettings({ majors: nextMajors });
    commitWeekly({ grades: grades.filter(item => item.id !== gradeId), classes: classes.filter(item => item.gradeId !== gradeId), weeklyPlans: weeklyPlans.filter(plan => !classIds.has(plan.classId)), activeWeeklyPlanIdByClassId: nextMap }, true);
  };

  // 开机：鉴权 + 拉取服务器数据
  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const hasToken = hasValidLocalToken();
      // 并行发起鉴权判断与数据拉取，避免美国↔新加坡跨洲往返串行叠加；
      // 有本地令牌时无需再等 isLoginRequired，可直接进入。
      const requiredP = hasToken ? Promise.resolve(true) : isLoginRequired();
      const remoteP = fetchExamsFromServer();
      const userP = hasToken ? refreshAdminUser() : Promise.resolve(null);

      const required = await requiredP;
      if (cancelled) return;
      if (required && !hasValidLocalToken()) { navigate('/login?next=/admin', { replace: true }); return; }
      const verifiedUser = await userP;
      if (cancelled) return;
      if (required && !verifiedUser) { navigate('/login?next=/admin', { replace: true }); return; }
      if (verifiedUser?.mustChangePassword) {
        setAdminUser(verifiedUser); setAdminTab('users'); setReady(true);
        if (location.search !== '?tab=users&password=1') navigate('/admin?tab=users&password=1', { replace: true });
        return;
      }
      setAdminUser(verifiedUser ?? OPEN_ADMIN);
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
        if (remote.activeWeeklyPlanIdByClassId !== undefined) remoteUpdates.activeWeeklyPlanIdByClassId = remote.activeWeeklyPlanIdByClassId;
        if (remote.grades !== undefined) remoteUpdates.grades = remote.grades;
        if (remote.classes !== undefined) remoteUpdates.classes = remote.classes;
        if (remote.initialization !== undefined) remoteUpdates.initialization = remote.initialization;
        if (remote.weeklyConflictPolicy !== undefined) remoteUpdates.weeklyConflictPolicy = remote.weeklyConflictPolicy;
        updateExamSettings(remoteUpdates as any);
        if (remote.alerts) { updateAlertsSettings(remote.alerts); setAlerts(getAppSettings().alerts); }
        const merged = getAppSettings().exam;
        setMajors(merged.majors); setActiveMajorId(merged.activeMajorId); setEditingMajorId(current => merged.majors.some(item => item.id === current) ? current : merged.activeMajorId);
        setScheduleMode(merged.scheduleMode); setWeeklyPlans(merged.weeklyPlans); setActiveWeeklyPlanId(merged.activeWeeklyPlanId); setActiveWeeklyPlanIdByClassId(merged.activeWeeklyPlanIdByClassId); setGrades(merged.grades); setClasses(merged.classes); setSelectedGradeId(merged.selectedGradeId); setSelectedClassId(merged.selectedClassId); setWeeklyConflictPolicy(merged.weeklyConflictPolicy); setInitialization(merged.initialization);
        pendingRef.current = false;
        setSync('saved');
      } else if (localAt > (remote?.updatedAt ?? 0)) {
        // 本地更新（之前离线编辑）：回连后回推（大型考试 + 周测，此前周测字段遗漏，现已补齐）
        pendingRef.current = true;
        const localExam = getAppSettings().exam;
        void pushToServer(localExam.majors, localExam.activeMajorId);
        void pushWeeklyToServer({ scheduleMode: localExam.scheduleMode, weeklyPlans: localExam.weeklyPlans, activeWeeklyPlanId: localExam.activeWeeklyPlanId, activeWeeklyPlanIdByClassId: localExam.activeWeeklyPlanIdByClassId, grades: localExam.grades, classes: localExam.classes, weeklyConflictPolicy: localExam.weeklyConflictPolicy });
      } else {
        setSync(remote ? 'saved' : 'offline');
      }
    };
    void boot();
    return () => { cancelled = true; if (saveTimer.current) clearTimeout(saveTimer.current); if (weeklySaveTimer.current) clearTimeout(weeklySaveTimer.current); };
  }, [location.search, navigate, pushToServer, pushWeeklyToServer]);

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

  useEffect(() => {
    if (!adminUser) return;
    if (adminUser.mustChangePassword) { if (adminTab !== 'users') setAdminTab('users'); return; }
    const permissionByTab: Record<AdminTab, string> = { overview: 'overview.read', major: 'major.read', weekly: 'weekly.read', classes: 'school.read', devices: 'device.read', users: 'user.read' };
    if (adminCan(permissionByTab[adminTab], adminUser)) return;
    const next = (Object.keys(permissionByTab) as AdminTab[]).find(tab => adminCan(permissionByTab[tab], adminUser));
    if (next) setAdminTab(next);
  }, [adminTab, adminUser]);

  // ===== 大型考试：添加 / 切换 / 重命名 / 删除 =====
  const switchMajor = (id: string) => {
    if (id === editingMajorId) return;
    setEditing(null);
    setEditingMajorId(id);
    if (selectedGradeId) setEditingMajorIdByGrade(value => ({ ...value, [selectedGradeId]: id }));
  };
  const commitMajorModal = () => {
    if (!majorModal) return;
    const name = majorModal.name.trim();
    if (!name) { setMajorError('请输入大型考试名称'); return; }
    if (majorModal.mode === 'add') {
      const nm: MajorExam = { id: genMajorId(), name, items: [], order: majors.length, targetGradeIds: majorModal.targetGradeIds };
      const ms = [...majors, nm];
      setEditingMajorId(nm.id);
      if (selectedGradeId) setEditingMajorIdByGrade(value => ({ ...value, [selectedGradeId]: nm.id }));
      commit(ms, activeMajorId, true);
    } else {
      const ms = majors.map(m => m.id === activeMajor.id ? { ...m, name, targetGradeIds: majorModal.targetGradeIds } : m);
      commit(ms, activeMajorId, true);
    }
    setMajorModal(null); setMajorError('');
  };
  const removeMajor = () => {
    if (majors.length <= 1) return;
    const removedId = activeMajor.id;
    const ms = majors.filter(m => m.id !== removedId).map((m, i) => ({ ...m, order: i }));
    const nextActiveId = removedId === activeMajorId ? ms[0].id : activeMajorId;
    setEditingMajorId(ms[0].id);
    commit(ms, nextActiveId, true);
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
    const rmd: CustomReminder = { id: genReminderId(), name: '新提醒', enabled: true, anchor: 'beforeStart', offsetMin: 30, tone: '15min', label: '提醒', title: '距开考还有一段时间', subtext: '请提前做好准备' };
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
      const ms = majors.map(m => m.id === activeMajor.id ? { ...m, name: nextName, items: chronological } : m);
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

  if (!ready || !adminUser) return <div className="admin-loading">正在验证管理权限…</div>;
  if (deniedModule) return <AccessDenied moduleName={deniedModule} onBack={() => { setDeniedModule(''); navigate('/admin', { replace: true }); }} />;

  const syncMeta = SYNC_META[sync];
  const can = (permission: string) => adminCan(permission, adminUser);
  const editDurationMs = editing?.startTime && editing?.endTime ? new Date(editing.endTime).getTime() - new Date(editing.startTime).getTime() : 0;
  const isLongEdit = Number.isFinite(editDurationMs) && editDurationMs > 6 * 60 * 60 * 1000;
  const activeMajorScopeLabel = activeMajor.targetClassIds?.length
    ? `指定 ${activeMajor.targetClassIds.length} 个班级`
    : activeMajor.targetGradeIds?.length
      ? activeMajor.targetGradeIds.map(id => grades.find(grade => grade.id === id)?.name || id).join('、')
      : '全校';

  return <div className="admin-page">
    <Watermark />
    <header className="admin-header">
      <div className="admin-header__left"><button className="admin-back-btn admin-back-btn--icon" onClick={() => navigate('/')} aria-label="返回首页" title="返回首页"><ArrowLeft /></button><div className="admin-header__identity"><h1 className="admin-header__title">考试管理</h1><span>{ADMIN_NAV.find(item => item.id === adminTab)?.label}</span></div>{hasScopedMajor && adminTab === 'major' && <span className="admin-header__major" title={`适用范围：${activeMajorScopeLabel}`}><span className="admin-header__major-dot" />{activeMajorScopeLabel} · {activeMajor.name}<span className="admin-header__major-count">{items.length} 科</span></span>}</div>
      <div className="admin-header__right">
        <span className="admin-user-chip" title={`登录账号：${adminUser.username}`}><strong>{adminUser.displayName}</strong><small>{adminUser.roleName}</small></span>
        <span className={`admin-cloud ${syncMeta.cls}`} title={online ? '云服务在线' : '当前离线'}>
          <span className="admin-cloud__dot" />{syncMeta.label}
        </span>
        <div className="admin-header__quick-actions">{can('alerts.read') && <button className="admin-btn admin-btn--primary" onClick={() => setAlertsOpen(true)}>提醒{alerts.enabled ? '' : '（停用）'}</button>}{can('settings.read') && <button className="admin-btn" onClick={() => navigate('/settings')}>系统设置</button>}</div>
        <div className="admin-more"><button ref={moreTriggerRef} className="admin-btn admin-more__trigger" onClick={() => { if (moreOpen) { setMoreOpen(false); return; } const rect = moreTriggerRef.current?.getBoundingClientRect(); if (rect && window.matchMedia('(max-width: 700px)').matches) { const width = Math.min(280, window.innerWidth - 28); setMoreMenuStyle({ position: 'fixed', top: rect.bottom + 8, left: window.innerWidth - width - 14, width, maxHeight: `calc(100dvh - ${rect.bottom + 24}px)` }); } else setMoreMenuStyle({}); setMoreOpen(true); }} aria-expanded={moreOpen} aria-haspopup="menu">更多</button>{moreOpen && <div className="admin-more__menu" style={moreMenuStyle} role="menu"><button onClick={() => { setAnnounceOpen(true); setMoreOpen(false); }}>查看公告</button>{can('alerts.read') && <button className="admin-more__mobile-only" onClick={() => { setAlertsOpen(true); setMoreOpen(false); }}>提醒管理{alerts.enabled ? '' : '（已停用）'}</button>}{can('settings.read') && <button className="admin-more__mobile-only" onClick={() => { navigate('/settings'); setMoreOpen(false); }}>系统设置</button>}{can('initialization.run') && <button onClick={() => { setWizardOpen(true); setMoreOpen(false); }}>初始化向导</button>}{adminTab === 'major' && can('major.import') && <button onClick={() => { setImportOpen(true); setMoreOpen(false); }}>导入大型考试 JSON</button>}{adminTab === 'major' && can('major.export') && <button onClick={() => { exportJson(); setMoreOpen(false); }}>导出大型考试 JSON</button>}<button className="is-danger" onClick={() => { logoutAdmin(); navigate('/login?next=/admin', { replace: true }); }}>退出登录</button></div>}</div>
      </div>
    </header>
    <div className={`admin-tabbar${adminTab === 'major' || adminTab === 'weekly' ? ' has-context' : ''}`}>
      <div className="admin-tabbar__tabs">
        {ADMIN_NAV.filter(item => item.id === 'users' || can(item.permission)).map(item => <button key={item.id} className={`admin-tab${adminTab === item.id ? ' is-active' : ''}`} onClick={() => setAdminTab(item.id)} aria-current={adminTab === item.id ? 'page' : undefined}><span><ModuleIcon module={item.id} size={16} /></span>{item.label}{item.id === 'weekly' && weeklyPlans.length ? `（${weeklyPlans.length}）` : ''}</button>)}
      </div>
      {adminTab !== 'overview' && adminTab !== 'devices' && adminTab !== 'classes' && adminTab !== 'users' && <>
      <label className="admin-tabbar__mode"><span>运行模式 <HelpTip title="运行模式">仅大型考试或仅周测会隐藏另一类安排；自动模式会同时调度，并按冲突规则让周测避开大型考试。</HelpTip></span>
        <select className="admin-input" value={scheduleMode} onChange={e => handleScheduleModeChange(e.target.value as ScheduleMode)} disabled={!can('schedule.mode_edit')}>
          <option value="major-only">仅大型考试</option>
          <option value="weekly-only">仅周测</option>
          <option value="automatic">自动（大型考试优先，自动避让周测）</option>
        </select>
      </label>
      <label className="admin-tabbar__mode">年级
        <select className="admin-input" value={selectedGradeId} onChange={e => changeSelectedGrade(e.target.value)}>
          <option value="">请选择年级</option>{grades.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {adminTab === 'weekly' && <label className="admin-tabbar__mode">班级
        <select className="admin-input" value={selectedClassId} onChange={e => changeSelectedClass(e.target.value)} disabled={!selectedGradeId}>
          <option value="">请选择班级</option>{classes.filter(item => item.gradeId === selectedGradeId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>}
      </>}
    </div>
    <div className={`admin-body${(['overview', 'classes', 'devices', 'users'] as AdminTab[]).includes(adminTab) ? ' admin-body--wide' : ''}`}>
      {adminTab === 'overview' ? (
        <OverviewPanel user={adminUser} grades={grades} classes={classes} majors={majors} weeklyPlans={weeklyPlans} syncLabel={syncMeta.label} online={online} />
      ) : adminTab === 'weekly' ? (
        <fieldset className="admin-permission-fieldset" disabled={!can('weekly.edit')}><WeeklyPanel
          weeklyPlans={weeklyPlans}
          activeWeeklyPlanId={activeWeeklyPlanId}
          activeWeeklyPlanIdByClassId={activeWeeklyPlanIdByClassId}
          selectedGradeId={selectedGradeId}
          selectedClassId={selectedClassId}
          selectedClassName={classes.find(item => item.id === selectedClassId)?.name ?? '当前班级'}
          classOptions={classes.map(item => ({ id: item.id, gradeId: item.gradeId, label: `${grades.find(grade => grade.id === item.gradeId)?.name ?? '未知年级'} · ${item.name}` }))}
          scheduleMode={scheduleMode}
          weeklyConflictPolicy={weeklyConflictPolicy}
          majorItems={orderedScopedMajors.flatMap(major => major.items)}
          majorName={orderedScopedMajors.map(major => major.name).join('、')}
          onSavePlans={handleSaveWeeklyPlans}
          onConflictPolicyChange={handleConflictPolicyChange}
          onSelectScope={(gradeId, classId) => { setSelectedGradeId(gradeId); setSelectedClassId(classId); }}
        /></fieldset>
      ) : adminTab === 'classes' ? (
        <ClassManagementPanel grades={grades} classes={classes} weeklyPlans={weeklyPlans} majors={majors} onAddGrade={addGrade} onRemoveGrade={removeGrade} onAddClass={addClass} onAddClasses={addClasses} onRemoveClass={removeClass} readOnly={!can('school.class_manage') && !can('school.grade_manage')} />
      ) : adminTab === 'devices' ? (
        <DeviceStatusPanel canRevoke={can('device.revoke')} />
      ) : adminTab === 'users' ? (
        <UserManagementPanel grades={grades} classes={classes} currentUser={adminUser} forcePasswordChange={adminUser.mustChangePassword || new URLSearchParams(location.search).get('password') === '1'} />
      ) : (
      <>
      <aside className="admin-sidebar">
        {/* 大型考试：添加 / 切换 / 重命名 / 删除 */}
        <div className="admin-major-card">
          <div className="admin-major-card__head"><label className="admin-label" style={{ opacity: .9 }}>{grades.find(grade => grade.id === selectedGradeId)?.name || '当前年级'} · 大型考试</label><span className="admin-major-card__count">共 {orderedScopedMajors.length} 场</span></div>
          <div className="admin-major-card__active">
            <span className="admin-major-card__active-name" title={activeMajor?.name}>{activeMajor?.name || '未命名考试'}</span>
            <span className="admin-major-card__active-meta">{items.length} 个分考试 · {items.filter(i => i.enabled).length} 个启用</span>
          </div>
          {orderedScopedMajors.length > 1 && (
            <label className="admin-major-card__switch">
              <span className="admin-major-card__switch-k">切换考试</span>
              <select className="admin-input admin-major-select" value={activeMajor.id} onChange={e => switchMajor(e.target.value)}>
                {orderedScopedMajors.map(m => <option key={m.id} value={m.id}>{m.name}（{m.items.length} 科）{!m.targetGradeIds?.length ? ' · 全校统一' : ''}</option>)}
              </select>
            </label>
          )}
          <div className="admin-major-card__btns">
            {can('major.create') && <button className="admin-btn admin-btn--primary" onClick={() => { setMajorModal({ mode: 'add', name: '', targetGradeIds: selectedGradeId ? [selectedGradeId] : [] }); setMajorError(''); }}>+ 新建</button>}
            {hasScopedMajor && can('major.edit') && <button className="admin-btn" onClick={() => { setMajorModal({ mode: 'rename', name: activeMajor.name, targetGradeIds: activeMajor.targetGradeIds || [] }); setMajorError(''); }}>设置</button>}
            {hasScopedMajor && can('major.delete') && <button className="admin-btn admin-btn--danger" onClick={() => setDeleteMajorOpen(true)} disabled={majors.length <= 1}>删除</button>}
          </div>
          <p className="admin-major-card__hint">切换年级只改变后台管理内容；大屏始终按设备绑定班级所属年级自动匹配适用考试。</p>
        </div>

        {hasScopedMajor && can('major.edit') && (editing ? <div className="admin-form-card">
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
        </div> : <button className="admin-btn admin-btn--primary" style={{ width: '100%' }} onClick={() => { setLongDurationConfirmed(false); setEditing({ name: '', startTime: '', endTime: '', enabled: true }); }}>+ 添加分考试</button>)}
        <div className="admin-tips"><p className="admin-tips__title"><CircleHelp size={16} />使用说明</p><ul><li>每次修改会自动保存并同步到云（Neon）</li><li>离线时仍可编辑，数据先存本地，联网后自动回推</li><li>不同大型考试各自拥有独立的分考试列表</li><li>大屏每 30 秒自动拉取最新数据</li></ul></div>
      </aside>
      <main className="admin-main">
        <div className="admin-list-header"><h2 className="admin-list-title">{activeMajor.name} · 考试安排</h2><span className="admin-list-count">{items.length} 项</span>{items.length > 0 && <><button className="admin-btn" onClick={() => setMajorPrintOpen(true)}>预览与导出 PDF</button><button className="admin-btn admin-btn--ghost admin-list-collapse" onClick={() => setCollapsedList(v => !v)} aria-expanded={!collapsedList}>{collapsedList ? "展开列表" : "折叠列表"}</button></>}</div>{lastDeletedExam && <div className="admin-undo"><span>已删除「{lastDeletedExam.item.name}」</span><button className="admin-btn admin-btn--ghost" onClick={restoreExam}>撤销删除</button></div>}
        {items.length === 0 ? <div className="admin-empty"><div className="admin-empty__icon"><CalendarDays /></div><p>当前大型考试暂无分考试，点击左侧“添加分考试”开始</p></div> : collapsedList ? <div className="admin-collapsed-hint">列表已折叠（共 {items.length} 项），点击“展开列表”查看</div> : <ul className="admin-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{items.map((item, index) => {
          const status = STATUS[phase(item)];
          return <li className={`admin-item${!item.enabled ? ' admin-item--disabled' : ''}`} key={item.id}>
            <div className="admin-item__order"><span className="admin-item__order-num">#{index + 1}</span></div>
            <div className="admin-item__info"><div className="admin-item__name-row"><span className="admin-item__name">{item.name}</span><span className="admin-item__status" style={{ color: status.color, background: status.bg }}>{status.label}</span>{!item.enabled && <span className="admin-item__status" style={{ color: '#6c757d', background: 'rgba(108,117,125,.1)' }}>已禁用</span>}</div><div className="admin-item__times"><span>{fmtLocal(item.startTime)}</span><span className="admin-item__times-sep">–</span><span>{fmtLocal(item.endTime)}</span><span className="admin-item__duration">{duration(item.startTime, item.endTime)}</span></div></div>
            {can('major.edit') && <div className="admin-item__actions"><button type="button" className={`admin-item-btn admin-item-btn--toggle ${item.enabled ? 'admin-item-btn--disable' : 'admin-item-btn--enable'}`} title={item.enabled ? '停用后不会出现在首页、大屏或提醒中' : '启用后会参与首页、大屏和提醒计算'} aria-label={`${item.enabled ? '停用' : '启用'}${item.name}`} onClick={() => setExamEnabled(item.id, !item.enabled)}>{item.enabled ? '停用' : '启用'}</button><button className="admin-item-btn" onClick={() => { setLongDurationConfirmed(false); setEditing({ ...item }); }}>编辑</button>{can('major.delete') && <button className="admin-item-btn admin-item-btn--delete" onClick={() => setDeleteTarget(item)}>删除</button>}</div>}
          </li>;
        })}</ul>}
      </main>
      </>
      )}
    </div>
    <nav className="admin-mobile-nav" aria-label="管理功能">
      {ADMIN_NAV.filter(item => item.id === 'users' || can(item.permission)).map(item => <button key={item.id} className={adminTab === item.id ? 'is-active' : ''} onClick={() => setAdminTab(item.id)} aria-current={adminTab === item.id ? 'page' : undefined}><span aria-hidden="true"><ModuleIcon module={item.id} size={18} /></span><small>{item.mobileLabel}</small></button>)}
    </nav>
    {majorModal && <div className="admin-modal-overlay" {...backdropProps(() => setMajorModal(null))}><div className="admin-modal" onClick={e => e.stopPropagation()}><h2 className="admin-modal__title">{majorModal.mode === 'add' ? '新建大型考试' : '大型考试设置'}</h2>{majorError && <div className="admin-error">{majorError}</div>}<label className="admin-label">名称<input className="admin-input" autoFocus value={majorModal.name} onChange={e => setMajorModal(p => p && { ...p, name: e.target.value })} placeholder="如：2026年高考 / 高三一模" /></label><label className="admin-label">适用范围 <HelpTip title="适用范围">默认归属当前年级；全校统一考试会出现在所有年级绑定设备上。</HelpTip><select className="admin-input" value={majorModal.targetGradeIds.length ? majorModal.targetGradeIds[0] : 'all'} onChange={e => setMajorModal(p => p && ({ ...p, targetGradeIds: e.target.value === 'all' ? [] : [e.target.value] }))}><option value="all">全校统一</option>{grades.map(grade => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</select></label><p className="admin-major-card__hint">后台切换考试只改变编辑对象，不会覆盖大屏；客户端按绑定年级自动匹配。</p><div className="admin-modal__actions"><button className="admin-btn admin-btn--primary" onClick={commitMajorModal}>确认</button><button className="admin-btn" onClick={() => { setMajorModal(null); setMajorError(''); }}>取消</button></div></div></div>}
    {majorPrintOpen && <SchedulePrintPreview mode="major" title={activeMajor.name} entries={items.filter(item => item.enabled).map(item => ({ date: item.startTime.slice(0, 10), name: item.name, startTime: item.startTime.slice(11, 16), endTime: item.endTime.slice(11, 16), note: STATUS[phase(item)].label }))} gradeName={grades.find(grade => grade.id === selectedGradeId)?.name || activeMajorScopeLabel} className="全年级" onClose={() => setMajorPrintOpen(false)} />}
    {deleteMajorOpen && <div className="admin-modal-overlay" {...backdropProps(() => setDeleteMajorOpen(false))}><div className="admin-modal" onClick={e => e.stopPropagation()}><h2 className="admin-modal__title">删除大型考试</h2><p className="admin-modal__body">确定删除「{activeMajor.name}」及其全部 {items.length} 项分考试？此操作无法撤销。</p><div className="admin-modal__actions"><button className="admin-btn admin-btn--danger" onClick={removeMajor}>删除</button><button className="admin-btn" onClick={() => setDeleteMajorOpen(false)}>取消</button></div></div></div>}
    {deleteTarget && <div className="admin-modal-overlay" {...backdropProps(() => setDeleteTarget(null))}><div className="admin-modal" onClick={e => e.stopPropagation()}><h2 className="admin-modal__title">确认删除</h2><p className="admin-modal__body">确定删除「{deleteTarget.name}」？此操作无法撤销。</p><div className="admin-modal__actions"><button className="admin-btn admin-btn--danger" onClick={() => remove(deleteTarget)}>删除</button><button className="admin-btn" onClick={() => setDeleteTarget(null)}>取消</button></div></div></div>}
    {alertsOpen && can('alerts.read') && <div className="admin-modal-overlay" {...backdropProps(() => setAlertsOpen(false))}>
      <div className="admin-modal admin-modal--wide admin-alerts" onClick={e => e.stopPropagation()}>
        <div className="admin-alerts__head">
          <h2 className="admin-modal__title" style={{ margin: 0 }}><Bell size={19} />统一提醒管理</h2>
          <button className="admin-btn admin-btn--ghost" onClick={() => setAlertsOpen(false)}>关闭</button>
        </div>
        {!can('alerts.edit') && <div className="admin-info-banner">当前账号只有查看权限，提醒设置不可修改。</div>}
        <p className="admin-alerts__lead">开考各阶段自动弹出<strong>全屏提醒浮层</strong>；浮层风格<strong>自动跟随大屏当前设计</strong>（共 5 套：深色指挥舱 / 清爽聚焦 / 校园黑板 / 高对比应急 / 编辑排版），无需单独配置。文案支持占位符 <code>{'{subject}'}</code>、<code>{'{start}'}</code>、<code>{'{end}'}</code>、<code>{'{next}'}</code>、<code>{'{nextTime}'}</code>。</p>
        <fieldset className="admin-permission-modal" disabled={!can('alerts.edit')}>
        <div className="admin-alerts__bar">
          <label className="admin-toggle-label"><input type="checkbox" checked={alerts.enabled} onChange={e => setAlertsEnabled(e.target.checked)} />启用全屏提醒浮层</label>
          <label className="admin-alerts__dur">默认停留时长
            <input className="admin-input" type="number" min={4} max={15} value={alerts.durationSec} onChange={e => setAlertsDuration(Math.min(15, Math.max(4, Number(e.target.value) || 8)))} />
            <span>秒</span>
          </label>
          <button className="admin-btn admin-btn--ghost" onClick={resetAlerts}>恢复默认文案</button>
        </div>
        <div className="admin-alerts__tabs"><button type="button" className={alertsSection === 'builtin' ? 'is-active' : ''} onClick={() => setAlertsSection('builtin')}>内置阶段提醒</button><button type="button" className={alertsSection === 'custom' ? 'is-active' : ''} onClick={() => setAlertsSection('custom')}>自定义提醒（{alerts.custom.length}）</button></div>

        {alertsSection === 'builtin' && <div className={`admin-alerts__section${alerts.enabled ? '' : ' is-dim'}`}>
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
        </div>}

        {alertsSection === 'custom' && <div className={`admin-alerts__section${alerts.enabled ? '' : ' is-dim'}`}>
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
        </div>}
        </fieldset>
      </div>
    </div>}
    {announceOpen && <div className="admin-modal-overlay" {...backdropProps(() => setAnnounceOpen(false))}>
      <div className="admin-modal admin-modal--wide admin-announce" onClick={e => e.stopPropagation()}>
        <div className="admin-alerts__head">
          <h2 className="admin-modal__title" style={{ margin: 0 }}><Megaphone size={19} />公告</h2>
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
    {importOpen && <div className="admin-modal-overlay" {...backdropProps(() => setImportOpen(false))}><div className="admin-modal admin-modal--wide" onClick={e => e.stopPropagation()}><h2 className="admin-modal__title">导入分考试 JSON</h2><p className="admin-modal__body">导入到当前大型考试「{activeMajor.name}」，导入前会校验必填字段并按开始时间排序。支持纯数组，或含 <code>title</code> 与 <code>items</code> 的对象。</p><AiImportGuide kind="major" context={`${initialization.schoolFullName || '当前学校'}，${activeMajorScopeLabel}，大型考试“${activeMajor.name}”`} />{importError && <div className="admin-error">{importError}</div>}<textarea className="admin-textarea" rows={11} value={importText} onChange={e => setImportText(e.target.value)} placeholder='{"title":"2026年高考","items":[{"name":"语文","startTime":"2026-06-07T09:00:00","endTime":"2026-06-07T11:30:00","enabled":true}]}' /><div className="admin-modal__actions"><button className="admin-btn admin-btn--primary" onClick={importJson}>校验并导入</button><button className="admin-btn" onClick={() => { setImportOpen(false); setImportError(''); }}>取消</button></div></div></div>}
    {can('initialization.run') && <InitializationWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onComplete={completeInitialization} />}
  </div>;
}
