import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { ExamItem, AlertsSettings } from '../types';
import { getAppSettings } from '../utils/appSettings';
import { getResolvedExamItems } from '../utils/appSchedule';
import { examSyncIntervalMs } from '../utils/examPolling';
import {
  nowMs,
  formatClockInZone,
  getZonedParts,
  parseZonedTime,
  DISPLAY_TIME_ZONE,
  isTimeSyncReady,
} from '../utils/timeSource';
import { useExamNotify } from '../hooks/useExamNotify';
import { useExamSync } from '../hooks/useExamSync';
import { useAlertOverlay } from '../hooks/useAlertOverlay';
import { useFullscreen } from '../hooks/useFullscreen';
import { useIsMobile } from '../hooks/useIsMobile';
import ExamAlertOverlay from '../components/ExamAlertOverlay';
import ExamSyncAction from '../components/ExamSyncAction';
import Watermark from '../components/Watermark';
import BrandMark from '../components/BrandMark';
import SubjectIcon from '../components/SubjectIcon';
import { getDesign, isMobileReadyDesign } from '../designs/registry';
import { getDesignId, resolveManagedDesign, setDesignId } from '../utils/designPref';
import { getCachedDeviceBinding, getClassBindingInstanceId } from '../services/classBinding';
import DesignSwitcher from '../components/DesignSwitcher';
import ExamAnnouncementOverlay from '../components/ExamAnnouncementOverlay';
import SchoolAnnouncementOverlay from '../components/SchoolAnnouncementOverlay';
import LoadingState from '../components/LoadingState';
import { fetchAnnouncements } from '../services/announcements';
import type { Announcement } from '../services/announcements';
import { fetchDeviceExamAnnouncements, type SchoolExamAnnouncement } from '../services/examAnnouncements';
import { flushAnnouncementAcks, queueAnnouncementSeen } from '../services/announcementAcks';
import {
  markAnnouncementsShown,
  markAnnouncementsSeenLocally,
  markRemindersHandled,
  pickUnshownAnnouncements,
  readLocallySeenIds,
  readReminderMarks,
  readShownAnnouncementIds,
} from '../utils/schoolAnnouncementState';
import {
  pickRemindableAnnouncements,
  shouldAutoOpenAnnouncement,
  type AnnouncementSeenItem,
} from '../shared/examAnnouncementContracts.js';
import type { ExamViewModel, ExamPhaseVM, Urgency } from '../designs/types';
import { sortExamItemsByTime } from '../utils/examSchedule';
import '../styles/exam.css';
import TemporaryExamLauncher from '../components/TemporaryExamLauncher';
import ExamQuickMenu from '../components/ExamQuickMenu';
import { TEMPORARY_EXAM_EVENT } from '../services/temporaryExam';
import { getResolvedSchedule } from '../utils/appSchedule';
import { arrowLine, placeBubble, ringRect, type Point, type Rect } from '../utils/fullscreenGuide';
import { AlertTriangle, Expand, LogOut, School, X } from 'lucide-react';

interface RawState {
  currentExam: ExamItem | null;
  phase: ExamPhaseVM;
  remainingMs: number;
  elapsedMs: number;
  durationMs: number;
  startToNowMs: number; // 距开考倒计时（before）/ 距下一场（ended）
  nextExam: ExamItem | null;
}

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];
const ANNOUNCEMENT_SEEN_KEY = 'exam_board_seen_announcement_version';
const ANNOUNCEMENT_POLL_MS = 60 * 1000;
const AUTO_FULLSCREEN_IDLE_MS = 60 * 1000; // 大屏无操作 1 分钟后给出“建议全屏”提示条
const FS_HINT_AUTO_HIDE_MS = 20 * 1000; // 提示条无人操作 20 秒后自动收起
const FS_HINT_SNOOZE_MS = 10 * 60 * 1000; // “稍后”本次静默 10 分钟
const FS_HINT_DISABLED_KEY = 'novora_fs_hint_disabled';
const FS_HINT_SNOOZE_KEY = 'novora_fs_hint_snooze_until';
const ENDED_DIALOG_MS = 6 * 1000; // 结束弹窗数秒后收缩为常驻提醒条
const DOUBLE_TAP_WINDOW_MS = 320;
const DOUBLE_TAP_DISTANCE_PX = 40;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 「不再提示」永久静默 + 「稍后」10 分钟静默，两者都用 localStorage 记录。 */
function isFsHintSuppressed(): boolean {
  try {
    if (localStorage.getItem(FS_HINT_DISABLED_KEY) === '1') return true;
    const until = Number(localStorage.getItem(FS_HINT_SNOOZE_KEY) || 0);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

/**
 * 决定这次轮询是否要自动弹学校公告窗口（用户口径 2026-09-25 二期）。
 *
 * 候选有两类：本机没弹过的新公告，以及管理端在回执里发的"未读强提醒"（提醒时间比本地记录新，
 * 且（scope=unseen 时）本机还没上报过已读）。之后按展示策略过滤：
 * - 显式静默（发布时选了"只进列表"）→ 直接标记掉，不再等；
 * - 夜间静默（22:00–06:00）只挡普通公告，不标记，等过了时段再弹；紧急公告照弹。
 */
function pickAutoOpenSchoolAnnouncements(list: SchoolExamAnnouncement[]): SchoolExamAnnouncement[] {
  const shown = readShownAnnouncementIds();
  const seenLocally = readLocallySeenIds();
  const reminders = pickRemindableAnnouncements(list, readReminderMarks()).filter(
    (item) => item.remindScope === 'all' || !seenLocally.has(item.id),
  );
  const candidates: SchoolExamAnnouncement[] = [];
  const seen = new Set<string>();
  for (const item of [...reminders, ...pickUnshownAnnouncements(list, shown)]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    candidates.push(item);
  }
  const silent = candidates.filter((item) => item.silent);
  if (silent.length) markAnnouncementsShown(silent.map((item) => item.id));
  const now = new Date();
  return candidates.filter((item) => shouldAutoOpenAnnouncement(item, now));
}

function announcementVersion(list: Announcement[]): string {
  // updated_at 随编辑/置顶状态变更而更新；仅保存版本标识，不保存公告正文。
  return list.map((item) => `${item.id}:${item.updated_at}:${item.pinned ? 1 : 0}`).join('|');
}

function getActiveExams(items: ExamItem[]): ExamItem[] {
  return sortExamItemsByTime(items.filter((x) => x.enabled));
}

function computeRawState(items: ExamItem[], nowTs: number): RawState {
  const active = getActiveExams(items);
  // 后台「暂停考试」要立刻在教室端生效：暂停期间把"现在"钉在暂停那一刻，
  // 倒计时/用时因此冻结（继续考试时后台会把 endAt 顺延、并把 pausedMs 记进快照）。
  const pausedAt = active
    .map((exam) => (exam as ExamItem & { pausedAt?: number | null }).pausedAt)
    .find((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (pausedAt != null && pausedAt < nowTs) nowTs = pausedAt;
  if (active.length === 0) {
    return {
      currentExam: null,
      phase: 'empty',
      remainingMs: 0,
      elapsedMs: 0,
      durationMs: 0,
      startToNowMs: 0,
      nextExam: null,
    };
  }
  for (let i = 0; i < active.length; i++) {
    const exam = active[i];
    const start = parseZonedTime(exam.startTime);
    const end = parseZonedTime(exam.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (nowTs < start) {
      return {
        currentExam: exam,
        phase: 'before',
        remainingMs: 0,
        elapsedMs: 0,
        durationMs: end - start,
        startToNowMs: start - nowTs,
        nextExam: active[i + 1] ?? null,
      };
    }
    if (nowTs >= start && nowTs <= end) {
      return {
        currentExam: exam,
        phase: 'live',
        remainingMs: end - nowTs,
        elapsedMs: nowTs - start,
        durationMs: end - start,
        startToNowMs: 0,
        nextExam: active[i + 1] ?? null,
      };
    }
  }
  const last = active[active.length - 1];
  return {
    currentExam: last ?? null,
    phase: 'ended',
    remainingMs: 0,
    elapsedMs: 0,
    durationMs: 0,
    startToNowMs: 0,
    nextExam: null,
  };
}

function fmtHMS(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

// 倒计时格式：跨天时显示“N天 HH:mm:ss”，当天内保持 HH:mm:ss。
// 用于“距开考 / 下一场”这类可能跨多天的长倒计时，避免把天数折算成上百小时（例如把 108 天显示成 2606:16:10）。
function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}天 ${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function fmtHM(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const p = getZonedParts(ms, DISPLAY_TIME_ZONE);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

function fmtDateText(ms: number): string {
  const p = getZonedParts(ms, DISPLAY_TIME_ZONE);
  return `北京时间 · 星期${WEEKDAY_CN[p.weekday]} · ${p.year}.${pad2(p.month)}.${pad2(p.day)}`;
}

function computeUrgency(phase: ExamPhaseVM, remainingMs: number): Urgency {
  if (phase !== 'live') return 'normal';
  if (remainingMs <= 5 * 60000) return 'critical';
  if (remainingMs <= 15 * 60000) return 'warn';
  return 'normal';
}

export default function ExamPage() {
  const exam = getAppSettings().exam;
  const selectedClass = exam.classes.find((item) => item.id === exam.selectedClassId);
  const bindingValid = Boolean(exam.selectedGradeId && selectedClass && selectedClass.gradeId === exam.selectedGradeId);
  return bindingValid ? (
    <BoundExamPage />
  ) : (
    <Navigate to={getCachedDeviceBinding()?.isManagement ? '/' : '/?selectClass=1'} replace />
  );
}

function BoundExamPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ExamItem[]>(() => getResolvedExamItems());
  const [title, setTitle] = useState<string>(() => getAppSettings().exam?.title ?? '');
  const [now, setNow] = useState<number>(() => nowMs());
  const [designId, setDesign] = useState<string>(() => {
    const current = getAppSettings().exam;
    return (
      resolveManagedDesign(
        current.designPolicy,
        current.selectedGradeId,
        current.selectedClassId,
        getClassBindingInstanceId(),
      ) || getDesignId()
    );
  });
  const [managedDesign, setManagedDesign] = useState(() => {
    const current = getAppSettings().exam;
    return Boolean(
      resolveManagedDesign(
        current.designPolicy,
        current.selectedGradeId,
        current.selectedClassId,
        getClassBindingInstanceId(),
      ),
    );
  });
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [alerts, setAlerts] = useState<AlertsSettings>(() => getAppSettings().alerts);
  const [schoolName, setSchoolName] = useState<string>(() => {
    const initialization = getAppSettings().exam.initialization;
    return initialization.schoolFullName || initialization.schoolName || '';
  });
  const [schoolLogo, setSchoolLogo] = useState<string>(() => getAppSettings().exam.initialization.schoolLogo ?? '');
  const [switcherOpen, setSwitcherOpen] = useState(false);
  /** 作者端系统公告窗口。 */
  const [announcementsOpen, setAnnouncementsOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(true);
  /**
   * 学校侧考试公告（T-286-03）：与作者端公告分开拉，走另一扇更大的窗口。
   * 紧急公告立刻弹出、置顶且不可关闭；系统公告窗口在它打开期间让位（避免两扇窗口叠在一起）。
   */
  const [schoolAnnouncements, setSchoolAnnouncements] = useState<SchoolExamAnnouncement[]>([]);
  const [schoolAnnouncementsOpen, setSchoolAnnouncementsOpen] = useState(false);
  /** 历史公告（已过期 / 已撤回）：只在教室端点左右「历史」分页时按需拉取。 */
  const [schoolAnnouncementHistory, setSchoolAnnouncementHistory] = useState<SchoolExamAnnouncement[]>([]);
  const [schoolHistoryLoading, setSchoolHistoryLoading] = useState(false);
  const [temporaryOpen, setTemporaryOpen] = useState(false);
  const examLiveRef = useRef(false);
  /** 考试期间不打断考场：待弹的公告先记下来，考完再弹。 */
  const deferredSchoolAnnouncementsRef = useRef<SchoolExamAnnouncement[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const examSyncInterval = useMemo(() => examSyncIntervalMs(items, nowMs()), [items]);

  // 数据链接：考试前端保持快速同步，后台切换分科模式后无需手动刷新。
  const {
    refresh: refreshExamData,
    syncState: examDataSyncState,
    lastSyncAt: examDataLastSyncAt,
    hasPendingSync,
    syncError,
  } = useExamSync({
    intervalMs: examSyncInterval,
    minRefreshMs: 10_000,
    onUpdate: ({ title: newTitle, alerts: newAlerts }) => {
      setItems(getResolvedExamItems());
      if (newTitle) setTitle(newTitle);
      if (newAlerts) setAlerts(newAlerts);
      const initialization = getAppSettings().exam.initialization;
      setSchoolName(initialization.schoolFullName || initialization.schoolName || '');
      setSchoolLogo(initialization.schoolLogo ?? '');
      const current = getAppSettings().exam;
      const assigned = resolveManagedDesign(
        current.designPolicy,
        current.selectedGradeId,
        current.selectedClassId,
        getClassBindingInstanceId(),
      );
      setManagedDesign(Boolean(assigned));
      if (assigned) setDesign(assigned);
    },
  });
  useEffect(() => {
    const refresh = () => setItems(getResolvedExamItems());
    window.addEventListener(TEMPORARY_EXAM_EVENT, refresh);
    const interval = window.setInterval(refresh, 2000);
    return () => {
      window.removeEventListener(TEMPORARY_EXAM_EVENT, refresh);
      window.clearInterval(interval);
    };
  }, []);

  // 新实例首次进入自动展示公告；运行期间每分钟检查一次，作者端更新后自动再次展示。
  useEffect(() => {
    let alive = true;
    const refreshAnnouncements = async () => {
      const list = await fetchAnnouncements(true);
      if (!alive) return;
      setAnnouncements(list);
      setAnnouncementsLoading(false);
      if (list.length === 0) return;
      const version = announcementVersion(list);
      try {
        if (window.localStorage.getItem(ANNOUNCEMENT_SEEN_KEY) !== version) {
          window.localStorage.setItem(ANNOUNCEMENT_SEEN_KEY, version);
          if (examLiveRef.current) window.localStorage.setItem('exam_board_deferred_announcement', version);
          else setAnnouncementsOpen(true);
        }
      } catch {
        // 存储不可用时仍展示公告，避免隐私模式/受限浏览器漏掉更新。
        setAnnouncementsOpen(true);
      }
    };
    void refreshAnnouncements();
    const intervalId = window.setInterval(() => {
      void refreshAnnouncements();
    }, ANNOUNCEMENT_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, []);

  /**
   * 大屏上的公告入口只有一个（考试页顶栏的公告按钮），点开后按优先级决定打开哪扇窗口：
   * 有学校公告就先看学校公告（更新鲜、更大），没有才回落到作者端系统公告。
   */
  const openAnnouncements = useCallback(() => {
    const instanceId = getClassBindingInstanceId();
    if (instanceId) {
      // 当前公告与历史公告一起拉：即使当前没有公告，只要历史里有内容，
      // 教室端也应该能打开学校公告窗口翻历史（而不是被回落到作者端窗口）。
      void Promise.all([
        fetchDeviceExamAnnouncements(instanceId),
        fetchDeviceExamAnnouncements(instanceId, { history: true, limit: 30 }),
      ]).then(([list, history]) => {
        setSchoolAnnouncements(list);
        setSchoolAnnouncementHistory(history);
        if (list.length > 0 || history.length > 0) {
          // 手动打开也算"弹过"：不然下一次轮询还会把它当成新公告再弹一次。
          markAnnouncementsShown(list.map((item) => item.id));
          setSchoolAnnouncementsOpen(true);
          return;
        }
        setAnnouncementsOpen(true);
        setAnnouncementsLoading(true);
        void fetchAnnouncements(true)
          .then(setAnnouncements)
          .finally(() => setAnnouncementsLoading(false));
      });
      return;
    }
    setAnnouncementsOpen(true);
    setAnnouncementsLoading(true);
    void fetchAnnouncements(true)
      .then(setAnnouncements)
      .finally(() => setAnnouncementsLoading(false));
  }, []);

  /** 教室端切到「历史」分页时拉一次历史公告。 */
  const loadSchoolAnnouncementHistory = useCallback(() => {
    const instanceId = getClassBindingInstanceId();
    if (!instanceId) return;
    setSchoolHistoryLoading(true);
    void fetchDeviceExamAnnouncements(instanceId, { history: true, limit: 30 })
      .then(setSchoolAnnouncementHistory)
      .finally(() => setSchoolHistoryLoading(false));
  }, []);

  /**
   * 学校公告"看满 3 秒"的回执入口：先进本地缓冲，再立刻尝试发一次；
   * 失败（断网/429）会留在缓冲里，由每分钟的轮询补发。
   */
  const handleSchoolAnnouncementSeen = useCallback((item: AnnouncementSeenItem) => {
    queueAnnouncementSeen([item]);
    // 记在本机：管理端发强提醒时，已经看过的教室不再被打扰。
    markAnnouncementsSeenLocally([item.id]);
    const instanceId = getClassBindingInstanceId();
    if (instanceId) void flushAnnouncementAcks(instanceId);
  }, []);

  /**
   * 学校侧公告轮询：拉本机（按绑定班级）能收到的公告，并做三件事：
   * 1. 紧急公告立刻弹出（窗口自身禁止关闭），公告全部过期/撤回后自动收起空窗口；
   * 2. 普通公告**发布后自动弹一次**（每台设备只弹一次，靠本地标记去重），
   *    正在考试时先记下来、等考试结束再弹，避免打断考场；
   * 3. 顺手把本地缓冲的"看过"回执发出去（离线时留到下次）。
   */
  useEffect(() => {
    let alive = true;
    const instanceId = getClassBindingInstanceId();
    if (!instanceId) return () => undefined;
    const refreshSchoolAnnouncements = async () => {
      const list = await fetchDeviceExamAnnouncements(instanceId);
      if (!alive) return;
      setSchoolAnnouncements(list);
      void flushAnnouncementAcks(instanceId);
      if (list.length === 0) {
        setSchoolAnnouncementsOpen(false);
        return;
      }
      const candidates = pickAutoOpenSchoolAnnouncements(list);
      if (!candidates.length) return;
      if (examLiveRef.current) {
        // 考试进行中：记下待弹的公告，等考试结束（下面的 raw.phase 副作用）再弹。
        deferredSchoolAnnouncementsRef.current = candidates;
        return;
      }
      markAnnouncementsShown(candidates.map((item) => item.id));
      markRemindersHandled(
        candidates.filter((item) => item.remindAt).map((item) => ({ id: item.id, remindAt: item.remindAt as number })),
      );
      setSchoolAnnouncementsOpen(true);
    };
    void refreshSchoolAnnouncements();
    const intervalId = window.setInterval(() => {
      void refreshSchoolAnnouncements();
    }, ANNOUNCEMENT_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const tick = useCallback(() => setNow(nowMs()), []);
  useEffect(() => {
    tick();
    timerRef.current = setInterval(tick, 500);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [tick]);

  // 状态胶囊反映当下真实网络状态：监听 online/offline，断网立即变“离线”。
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // 将时间量化到整秒：大屏时钟与底部倒计时都基于同一 nowTick，
  // 确保两者在同一时刻跳变，消除偶发的 1 秒时差。
  const nowTick = Math.floor(now / 1000) * 1000;
  const raw = useMemo(() => computeRawState(items, nowTick), [items, nowTick]);
  const currentKind = raw.currentExam && (raw.currentExam as { kind?: string }).kind;
  const displayMasterTitle =
    currentKind === 'weekly'
      ? '周测'
      : currentKind === 'temporary'
        ? `${raw.currentExam?.name} - 临时考试`
        : raw.currentExam?.majorName || title || 'Novora';
  examLiveRef.current = raw.phase === 'live';
  useEffect(() => {
    if (raw.phase === 'live') return;
    // 学校公告：考试期间压下的新公告，考完（或考前空闲）补弹一次。
    const deferredSchool = deferredSchoolAnnouncementsRef.current;
    if (deferredSchool.length) {
      deferredSchoolAnnouncementsRef.current = [];
      markAnnouncementsShown(deferredSchool.map((item) => item.id));
      markRemindersHandled(
        deferredSchool
          .filter((item) => item.remindAt)
          .map((item) => ({ id: item.id, remindAt: item.remindAt as number })),
      );
      window.setTimeout(() => setSchoolAnnouncementsOpen(true), raw.phase === 'ended' ? 9500 : 0);
    }
    const deferred = window.localStorage.getItem('exam_board_deferred_announcement');
    if (deferred) {
      window.localStorage.removeItem('exam_board_deferred_announcement');
      // 考试结束后展示考试期间收到的最新公告；结束提醒仍由最高层提醒浮层优先显示。
      window.setTimeout(() => setAnnouncementsOpen(true), raw.phase === 'ended' ? 8500 : 0);
    }
  }, [raw.phase]);
  const { notification, dismiss } = useExamNotify(raw.currentExam);

  // 全屏提醒浮层：将通知事件与自定义提醒映射为对应设计风格的浮层
  const overlayItem = useAlertOverlay({
    notification,
    currentExam: raw.currentExam,
    nextExam: raw.nextExam,
    settings: alerts,
    masterTitle: displayMasterTitle,
  });
  // 浮层启用时，抑制设计内的轻量通知条，避免重复
  const inDesignNotification = alerts.enabled ? null : notification;

  const progressPct =
    raw.durationMs > 0
      ? Math.min(100, Math.max(0, (raw.elapsedMs / raw.durationMs) * 100))
      : raw.phase === 'ended'
        ? 100
        : 0;

  const vm: ExamViewModel = {
    masterTitle: displayMasterTitle,
    phase: raw.phase,
    clock: formatClockInZone(nowTick),
    dateText: fmtDateText(nowTick),
    currentName: raw.currentExam?.name ?? null,
    startHM: raw.currentExam ? fmtHM(parseZonedTime(raw.currentExam.startTime)) : null,
    endHM: raw.currentExam ? fmtHM(parseZonedTime(raw.currentExam.endTime)) : null,
    progressPct,
    elapsedText: fmtHMS(raw.elapsedMs),
    remainingText: fmtHMS(raw.remainingMs),
    countdownText: fmtCountdown(raw.startToNowMs),
    nextName: raw.nextExam?.name ?? null,
    nextStartHM: raw.nextExam ? fmtHM(parseZonedTime(raw.nextExam.startTime)) : null,
    urgency: computeUrgency(raw.phase, raw.remainingMs),
    timeSynced: isTimeSyncReady(),
    online,
    notification: inDesignNotification,
  };

  const Design = getDesign(designId).component;

  const chooseDesign = useCallback(
    (id: string) => {
      if (managedDesign) return;
      setDesign(id);
      setDesignId(id);
    },
    [managedDesign],
  );

  // 全屏展示：顶栏按钮手动切换 + 无操作 1 分钟自动进入。
  const { isFullscreen, enter: enterFullscreen, exit: exitFullscreen } = useFullscreen();
  const [fsHintOpen, setFsHintOpen] = useState(false);
  const [fsHintError, setFsHintError] = useState('');
  const [endExitStage, setEndExitStage] = useState<'hidden' | 'dialog' | 'bar'>('hidden');
  const [endExitBarCollapsed, setEndExitBarCollapsed] = useState(false);
  const [guide, setGuide] = useState<{ point: Point; target: Rect } | null>(null);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 720 : window.innerHeight,
  }));
  const [fullscreenExitHintOpen, setFullscreenExitHintOpen] = useState(false);
  const fullscreenExitHintTimer = useRef<number | null>(null);
  const endedExitBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastTapRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const isMobile = useIsMobile();
  const [mobileNoticeDismissed, setMobileNoticeDismissed] = useState(false);
  // 退出全屏入口仅在“考试结束后 15 分钟内”弹出，超时自动隐藏。
  const showEndedExit =
    raw.phase === 'ended' &&
    raw.currentExam != null &&
    nowTick - parseZonedTime(raw.currentExam.endTime) <= 15 * 60 * 1000;

  // 静置提示：不再自动进入全屏（浏览器也会因缺少用户手势拒绝），改为静置 1 分钟后
  // 弹出非阻塞提示条，由用户点击完成手势授权；「不再提示」永久静默，「稍后」静默 10 分钟。
  useEffect(() => {
    if (isFullscreen) {
      setFsHintOpen(false);
      return;
    }
    if (raw.phase === 'ended') return; // 考试结束后不再自动进入全屏，便于监考离场操作
    if (isFsHintSuppressed()) return;
    let deadline = Date.now() + AUTO_FULLSCREEN_IDLE_MS;
    let armed = true;
    const bump = () => {
      deadline = Date.now() + AUTO_FULLSCREEN_IDLE_MS;
      armed = true;
    };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const id = window.setInterval(() => {
      if (!armed || document.hidden) return;
      if (Date.now() >= deadline) {
        armed = false;
        setFsHintOpen(true);
      }
    }, 1000);
    return () => {
      window.clearInterval(id);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [isFullscreen, raw.phase]);

  // 提示条无人操作 20 秒后自动收起（只收本次，不写静默标记）。
  useEffect(() => {
    if (!fsHintOpen) return;
    const id = window.setTimeout(() => setFsHintOpen(false), FS_HINT_AUTO_HIDE_MS);
    return () => window.clearTimeout(id);
  }, [fsHintOpen]);

  // 考试结束 + 仍全屏：先弹中央 alertdialog，数秒后收缩为常驻提醒条，
  // 提醒条一直保留到真正退出全屏（含 Esc / 系统手势，由 fullscreenchange 驱动）。
  useEffect(() => {
    if (!isFullscreen || !showEndedExit) {
      setEndExitStage('hidden');
      setEndExitBarCollapsed(false);
      return;
    }
    setEndExitStage('dialog');
    setEndExitBarCollapsed(false);
    const id = window.setTimeout(() => setEndExitStage('bar'), ENDED_DIALOG_MS);
    return () => window.clearTimeout(id);
  }, [isFullscreen, showEndedExit]);

  // alertdialog 打开时自动聚焦退出按钮，键盘用户可以直接回车确认。
  useEffect(() => {
    if (endExitStage === 'dialog') endedExitBtnRef.current?.focus();
  }, [endExitStage]);

  // ?autofs=1：同源 window.open 打开的场景由打开方保留用户手势，加载后立即尝试一次。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('autofs') !== '1') return;
    void enterFullscreen().catch(() => {});
  }, [enterFullscreen]);

  // 指引浮层与窗口尺寸联动（旋转屏幕、浏览器工具栏变化都会重算）。
  useEffect(() => {
    const sync = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
    };
  }, []);

  // 真正退出全屏（含 Esc、系统手势）时关闭指引浮层。
  useEffect(() => {
    if (!isFullscreen) setGuide(null);
  }, [isFullscreen]);

  // 屏幕常亮：防止大屏/手机在展示期间自动熄屏。
  useEffect(() => {
    let lock: { release?: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        const wl = (
          navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release?: () => Promise<void> }> } }
        ).wakeLock;
        if (wl && document.visibilityState === 'visible') lock = await wl.request('screen');
      } catch {
        /* 不支持或被拒绝时静默降级 */
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') void request();
    };
    void request();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      try {
        void lock?.release?.();
      } catch {
        /* noop */
      }
    };
  }, []);

  const acceptFullscreenFromHint = useCallback(() => {
    setFsHintError('');
    void enterFullscreen()
      .then(() => setFsHintOpen(false))
      .catch(() => setFsHintError('浏览器拒绝了全屏请求，请按 F11 或使用浏览器菜单进入。'));
  }, [enterFullscreen]);

  const snoozeFullscreenHint = useCallback(() => {
    try {
      localStorage.setItem(FS_HINT_SNOOZE_KEY, String(Date.now() + FS_HINT_SNOOZE_MS));
    } catch {
      /* 忽略存储异常 */
    }
    setFsHintOpen(false);
  }, []);

  const disableFullscreenHint = useCallback(() => {
    try {
      localStorage.setItem(FS_HINT_DISABLED_KEY, '1');
    } catch {
      /* 忽略存储异常 */
    }
    setFsHintOpen(false);
  }, []);

  /** 双击（含触摸双击）：仅在网页全屏时，记录第二下点击位置并打开退出全屏指引。 */
  const handleRootPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isFullscreen) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, a, input, select, textarea, [role="button"], [data-fs-guide-ignore]')) return;
      const point = { x: event.clientX, y: event.clientY };
      const now = Date.now();
      const last = lastTapRef.current;
      lastTapRef.current = { at: now, x: point.x, y: point.y };
      if (
        last &&
        now - last.at <= DOUBLE_TAP_WINDOW_MS &&
        Math.hypot(point.x - last.x, point.y - last.y) <= DOUBLE_TAP_DISTANCE_PX
      ) {
        lastTapRef.current = null;
        const button = document.querySelector<HTMLElement>('[data-fullscreen-toggle]');
        const rect = button?.getBoundingClientRect();
        if (!rect || !rect.width || !rect.height) return;
        setGuide({
          point,
          target: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        });
      }
    },
    [isFullscreen],
  );

  // 指引浮层打开期间按 Esc 关闭（浏览器退出全屏会由 fullscreenchange 另行处理）。
  useEffect(() => {
    if (!guide) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGuide(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [guide]);

  const guideLayout = useMemo(() => {
    if (!guide) return null;
    // 移动端按安全区收紧：上方留状态栏、下方留浏览器工具栏。
    const insets = isMobile ? { top: 44, right: 8, bottom: 36, left: 8 } : { top: 8, right: 8, bottom: 8, left: 8 };
    const bubbleSize = { width: Math.min(288, Math.max(196, viewport.width - 56)), height: 104 };
    return {
      ring: ringRect(guide.target, { viewport, insets }),
      arrow: arrowLine(guide.point, guide.target),
      bubble: placeBubble(guide.point, bubbleSize, { viewport, insets }),
      bubbleSize,
    };
  }, [guide, isMobile, viewport]);

  const dismissFullscreenExitHint = useCallback(() => {
    setFullscreenExitHintOpen(false);
    if (fullscreenExitHintTimer.current != null) {
      window.clearTimeout(fullscreenExitHintTimer.current);
      fullscreenExitHintTimer.current = null;
    }
  }, []);

  const exitFullscreenWithBrowserGuidance = useCallback(async () => {
    await exitFullscreen();
    // A web page can leave only the Fullscreen API. Browser-level full screen
    // (such as Chrome F11/menu full screen) must still be dismissed by Chrome.
    setFullscreenExitHintOpen(true);
    if (fullscreenExitHintTimer.current != null) window.clearTimeout(fullscreenExitHintTimer.current);
    fullscreenExitHintTimer.current = window.setTimeout(() => {
      setFullscreenExitHintOpen(false);
      fullscreenExitHintTimer.current = null;
    }, 6500);
  }, [exitFullscreen]);

  const toggleFullscreenWithGuidance = useCallback(() => {
    if (isFullscreen) {
      void exitFullscreenWithBrowserGuidance().catch(() => {});
      return;
    }
    // 顶栏按钮同样是用户手势；被拒绝时退回静置提示条给出明确指引。
    void enterFullscreen().catch(() => {
      setFsHintError('浏览器拒绝了全屏请求，请按 F11 或使用浏览器菜单进入。');
      setFsHintOpen(true);
    });
  }, [enterFullscreen, exitFullscreenWithBrowserGuidance, isFullscreen]);

  useEffect(
    () => () => {
      if (fullscreenExitHintTimer.current != null) window.clearTimeout(fullscreenExitHintTimer.current);
    },
    [],
  );

  return (
    <div className="exam-root" onPointerUp={handleRootPointerUp}>
      <TemporaryExamLauncher
        formalItems={getResolvedSchedule(nowTick).activeItems}
        externalOpen={temporaryOpen}
        onExternalHandled={() => setTemporaryOpen(false)}
      />
      <Suspense fallback={<LoadingState kind="design" />}>
        <Design
          vm={vm}
          onDismissNotification={dismiss}
          onBack={() => navigate('/')}
          quickMenu={
            <ExamQuickMenu
              onTemporary={() => setTemporaryOpen(true)}
              onLocal={() => navigate('/local-settings')}
              onAdmin={() => navigate('/admin')}
            />
          }
          onOpenAnnouncements={openAnnouncements}
          onSwitchDesign={() => {
            if (!managedDesign) setSwitcherOpen(true);
          }}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreenWithGuidance}
        />
      </Suspense>
      <Watermark exam />
      {fullscreenExitHintOpen && (
        <div className="exam-fullscreen-exit-hint" role="status">
          <AlertTriangle aria-hidden="true" />
          <span>已退出看板全屏。若画面仍全屏，请按 F11 或使用浏览器菜单退出。</span>
          <button type="button" aria-label="关闭提示" onClick={dismissFullscreenExitHint}>
            <X aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="exam-context-bar" aria-label="看板信息">
        <div className="exam-context-bar__identity">
          {schoolName && (
            <div className="exam-school-name" title={schoolName}>
              {schoolLogo ? (
                <img className="exam-school-logo" src={schoolLogo} alt="" />
              ) : (
                <School aria-hidden="true" />
              )}
              <span>{schoolName}</span>
            </div>
          )}
        </div>
        <BrandMark compact className="exam-brand-mark" />
        <div className="exam-context-bar__status">
          {raw.currentExam && (
            <div className="exam-subject-badge">
              <SubjectIcon subject={raw.currentExam.name} size={17} />
              <span>{raw.currentExam.name}</span>
            </div>
          )}
          <ExamSyncAction
            state={examDataSyncState}
            lastSyncAt={examDataLastSyncAt}
            hasPendingSync={hasPendingSync}
            syncError={syncError}
            onRefresh={() => {
              void refreshExamData(true);
            }}
          />
        </div>
      </div>
      <ExamAnnouncementOverlay
        open={announcementsOpen && !schoolAnnouncementsOpen}
        announcements={announcements}
        loading={announcementsLoading}
        onClose={() => setAnnouncementsOpen(false)}
      />
      <SchoolAnnouncementOverlay
        open={schoolAnnouncementsOpen}
        announcements={schoolAnnouncements}
        history={schoolAnnouncementHistory}
        historyLoading={schoolHistoryLoading}
        onRequestHistory={loadSchoolAnnouncementHistory}
        schoolName={schoolName}
        onSeen={handleSchoolAnnouncementSeen}
        onClose={() => setSchoolAnnouncementsOpen(false)}
      />
      {/* 设计切换窗由各设计顶栏按钮触发，避免悬浮按钮遮挡大屏元素。 */}
      <DesignSwitcher
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        currentId={designId}
        onSelect={chooseDesign}
        managed={managedDesign}
      />
      {/* 全屏提醒浮层：风格跟随当前展示设计自动切换 */}
      <ExamAlertOverlay
        item={overlayItem}
        now={nowTick}
        designId={designId}
        masterTitle={title}
        timeSynced={isTimeSyncReady()}
      />
      {/* 考试结束 + 仍全屏：第一层中央高对比弹窗，自动聚焦退出按钮 */}
      {isFullscreen && showEndedExit && endExitStage === 'dialog' && (
        <div
          className="exam-ended-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="exam-ended-dialog-title"
          aria-describedby="exam-ended-dialog-desc"
        >
          <p className="exam-ended-dialog__title" id="exam-ended-dialog-title">
            本场考试已结束
          </p>
          <p className="exam-ended-dialog__desc" id="exam-ended-dialog-desc">
            若画面仍全屏，请按 Esc 或 F11 退出。
          </p>
          <button
            ref={endedExitBtnRef}
            type="button"
            className="exam-ended-dialog__btn"
            onClick={() => {
              void exitFullscreenWithBrowserGuidance().catch(() => {});
            }}
          >
            <LogOut aria-hidden="true" />
            退出全屏
          </button>
        </div>
      )}
      {/* 第二层：数秒后收缩为常驻提醒条，保留到真正退出全屏；关闭只收起、可重新展开 */}
      {isFullscreen && showEndedExit && endExitStage === 'bar' && (
        <>
          {endExitBarCollapsed ? (
            <button
              type="button"
              className="exam-ended-exit__peek"
              aria-label="展开退出全屏提醒"
              title="本场考试已结束，可退出全屏"
              onClick={() => setEndExitBarCollapsed(false)}
            >
              <LogOut aria-hidden="true" />
            </button>
          ) : (
            <div className="exam-ended-exit" role="status">
              <span className="exam-ended-exit__text">本场考试已结束</span>
              <button
                type="button"
                className="exam-ended-exit__btn"
                onClick={() => {
                  void exitFullscreenWithBrowserGuidance().catch(() => {});
                }}
              >
                <LogOut aria-hidden="true" />
                退出全屏
              </button>
              <button
                type="button"
                className="exam-ended-exit__collapse"
                aria-label="收起提醒"
                onClick={() => setEndExitBarCollapsed(true)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          )}
        </>
      )}
      {isMobile && !isMobileReadyDesign(designId) && !mobileNoticeDismissed && (
        <div className="exam-mobile-notice" role="alert">
          <span>当前设计未针对手机端优化，请到电脑端查看最优效果。</span>
          <div className="exam-mobile-notice__actions">
            <button type="button" onClick={() => setSwitcherOpen(true)}>
              切换适配设计
            </button>
            <button
              type="button"
              className="exam-mobile-notice__close"
              aria-label="关闭提示"
              onClick={() => setMobileNoticeDismissed(true)}
            >
              ×
            </button>
          </div>
        </div>
      )}
      {/* 静置提示：非阻塞提示条，不遮挡展示；点“进入全屏”是用户手势，可正常调起 */}
      {fsHintOpen && !isFullscreen && (
        <div className="exam-fs-hint" role="status">
          <div className="exam-fs-hint__body">
            <span className="exam-fs-hint__title">建议全屏展示，画面更完整</span>
            {fsHintError ? <span className="exam-fs-hint__error">{fsHintError}</span> : null}
          </div>
          <div className="exam-fs-hint__actions">
            <button type="button" className="exam-fs-hint__go" onClick={acceptFullscreenFromHint}>
              <Expand aria-hidden="true" />
              进入全屏
            </button>
            <button type="button" onClick={snoozeFullscreenHint}>
              稍后
            </button>
            <button type="button" onClick={disableFullscreenHint}>
              不再提示
            </button>
          </div>
        </div>
      )}
      {/* 双击指引：聚光圈套在真实的全屏按钮上，箭头从点击点指向它 */}
      {isFullscreen && guideLayout && (
        <div className="exam-fs-guide" role="presentation" data-fs-guide-ignore onClick={() => setGuide(null)}>
          <div
            className="exam-fs-guide__ring"
            aria-hidden="true"
            style={{
              left: `${guideLayout.ring.left}px`,
              top: `${guideLayout.ring.top}px`,
              width: `${guideLayout.ring.width}px`,
              height: `${guideLayout.ring.height}px`,
            }}
          />
          <svg className="exam-fs-guide__arrow" width={viewport.width} height={viewport.height} aria-hidden="true">
            <defs>
              <marker id="exam-fs-guide-head" markerWidth="10" markerHeight="10" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
              </marker>
            </defs>
            <line
              x1={guideLayout.arrow.from.x}
              y1={guideLayout.arrow.from.y}
              x2={guideLayout.arrow.to.x}
              y2={guideLayout.arrow.to.y}
              markerEnd="url(#exam-fs-guide-head)"
            />
          </svg>
          <div
            className="exam-fs-guide__bubble"
            role="dialog"
            aria-label="退出全屏指引"
            style={{
              left: `${guideLayout.bubble.left}px`,
              top: `${guideLayout.bubble.top}px`,
              width: `${guideLayout.bubbleSize.width}px`,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <p className="exam-fs-guide__title">退出全屏</p>
            <p className="exam-fs-guide__hint">双击后按这里，或直接按 Esc / F11</p>
            <button type="button" className="exam-fs-guide__ok" onClick={() => setGuide(null)}>
              知道了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
