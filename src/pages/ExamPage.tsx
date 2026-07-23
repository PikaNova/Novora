import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ExamItem, AlertsSettings } from '../types';
import { getAppSettings } from '../utils/appSettings';
import { getResolvedExamItems } from '../utils/appSchedule';
import {
  nowMs, formatClockInZone, getZonedParts, parseZonedTime, DISPLAY_TIME_ZONE, isTimeSyncReady,
} from '../utils/timeSource';
import { useExamNotify } from '../hooks/useExamNotify';
import { useExamSync } from '../hooks/useExamSync';
import { useAlertOverlay } from '../hooks/useAlertOverlay';
import { useFullscreen } from '../hooks/useFullscreen';
import { useIsMobile } from '../hooks/useIsMobile';
import ExamAlertOverlay from '../components/ExamAlertOverlay';
import ExamSyncAction from '../components/ExamSyncAction';
import Watermark from '../components/Watermark';
import { getDesign, isMobileReadyDesign } from '../designs/registry';
import { getDesignId, setDesignId } from '../utils/designPref';
import DesignSwitcher from '../components/DesignSwitcher';
import ExamAnnouncementOverlay from '../components/ExamAnnouncementOverlay';
import { fetchAnnouncements } from '../services/announcements';
import type { Announcement } from '../services/announcements';
import type { ExamViewModel, ExamPhaseVM, Urgency } from '../designs/types';
import { sortExamItemsByTime } from '../utils/examSchedule';
import '../styles/exam.css';

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
const AUTO_FULLSCREEN_IDLE_MS = 60 * 1000; // 大屏无操作 1 分钟后尝试自动进入全屏
const pad2 = (n: number) => String(n).padStart(2, '0');

function announcementVersion(list: Announcement[]): string {
  // updated_at 随编辑/置顶状态变更而更新；仅保存版本标识，不保存公告正文。
  return list.map(item => `${item.id}:${item.updated_at}:${item.pinned ? 1 : 0}`).join('|');
}

function getActiveExams(items: ExamItem[]): ExamItem[] {
  return sortExamItemsByTime(items.filter(x => x.enabled));
}

function computeRawState(items: ExamItem[], nowTs: number): RawState {
  const active = getActiveExams(items);
  if (active.length === 0) {
    return { currentExam: null, phase: 'empty', remainingMs: 0, elapsedMs: 0, durationMs: 0, startToNowMs: 0, nextExam: null };
  }
  for (let i = 0; i < active.length; i++) {
    const exam = active[i];
    const start = parseZonedTime(exam.startTime);
    const end = parseZonedTime(exam.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (nowTs < start) {
      return { currentExam: exam, phase: 'before', remainingMs: 0, elapsedMs: 0, durationMs: end - start, startToNowMs: start - nowTs, nextExam: active[i + 1] ?? null };
    }
    if (nowTs >= start && nowTs <= end) {
      return { currentExam: exam, phase: 'live', remainingMs: end - nowTs, elapsedMs: nowTs - start, durationMs: end - start, startToNowMs: 0, nextExam: active[i + 1] ?? null };
    }
  }
  const last = active[active.length - 1];
  return { currentExam: last ?? null, phase: 'ended', remainingMs: 0, elapsedMs: 0, durationMs: 0, startToNowMs: 0, nextExam: null };
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
  const navigate = useNavigate();
  const [items, setItems] = useState<ExamItem[]>(() => getResolvedExamItems());
  const [title, setTitle] = useState<string>(() => getAppSettings().exam?.title ?? '');
  const [now, setNow] = useState<number>(() => nowMs());
  const [designId, setDesign] = useState<string>(() => getDesignId());
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [alerts, setAlerts] = useState<AlertsSettings>(() => getAppSettings().alerts);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [announcementsOpen, setAnnouncementsOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(true);
  const examLiveRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 数据链接：30s Neon 同步，所有设计共用同一份数据（含提醒管理配置）
  const { refresh: refreshExamData, syncState: examDataSyncState, lastSyncAt: examDataLastSyncAt, hasPendingSync } = useExamSync({
    intervalMs: 30000,
    onUpdate: ({ items: newItems, title: newTitle, alerts: newAlerts }) => {
      setItems(newItems); if (newTitle) setTitle(newTitle);
      if (newAlerts) setAlerts(newAlerts);
    },
  });

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
    const intervalId = window.setInterval(() => { void refreshAnnouncements(); }, ANNOUNCEMENT_POLL_MS);
    return () => { alive = false; window.clearInterval(intervalId); };
  }, []);

  const openAnnouncements = useCallback(() => {
    setAnnouncementsOpen(true);
    setAnnouncementsLoading(true);
    void fetchAnnouncements(true)
      .then(setAnnouncements)
      .finally(() => setAnnouncementsLoading(false));
  }, []);

  const tick = useCallback(() => setNow(nowMs()), []);
  useEffect(() => {
    tick();
    timerRef.current = setInterval(tick, 500);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [tick]);

  // 状态胶囊反映当下真实网络状态：监听 online/offline，断网立即变“离线”。
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);

  // 将时间量化到整秒：大屏时钟与底部倒计时都基于同一 nowTick，
  // 确保两者在同一时刻跳变，消除偶发的 1 秒时差。
  const nowTick = Math.floor(now / 1000) * 1000;
  const raw = useMemo(() => computeRawState(items, nowTick), [items, nowTick]);
  examLiveRef.current = raw.phase === 'live';
  useEffect(() => {
    if (raw.phase === 'live') return;
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
    masterTitle: title,
  });
  // 浮层启用时，抑制设计内的轻量通知条，避免重复
  const inDesignNotification = alerts.enabled ? null : notification;

  const progressPct = raw.durationMs > 0
    ? Math.min(100, Math.max(0, (raw.elapsedMs / raw.durationMs) * 100))
    : (raw.phase === 'ended' ? 100 : 0);

  const vm: ExamViewModel = {
    masterTitle: title,
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

  const chooseDesign = useCallback((id: string) => {
    setDesign(id); setDesignId(id);
  }, []);

  // 全屏展示：顶栏按钮手动切换 + 无操作 1 分钟自动进入。
  const { isFullscreen, enter: enterFullscreen, exit: exitFullscreen, toggle: toggleFullscreen } = useFullscreen();
  const [fsPromptOpen, setFsPromptOpen] = useState(false);
  const isMobile = useIsMobile();
  const [mobileNoticeDismissed, setMobileNoticeDismissed] = useState(false);
  // 退出全屏入口仅在“考试结束后 15 分钟内”弹出，超时自动隐藏。
  const showEndedExit =
    raw.phase === 'ended' &&
    raw.currentExam != null &&
    nowTick - parseZonedTime(raw.currentExam.endTime) <= 15 * 60 * 1000;

  // 自动全屏：进入全屏后停表；退出后重新计时。部分浏览器会因缺少用户手势而
  // 拒绝 requestFullscreen，此时回退到“轻触进入全屏”引导浮层，由用户点击完成手势授权。
  useEffect(() => {
    if (isFullscreen) { setFsPromptOpen(false); return; }
    if (raw.phase === 'ended') return; // 考试结束后不再自动进入全屏，便于监考离场操作
    let deadline = Date.now() + AUTO_FULLSCREEN_IDLE_MS;
    let armed = true;
    const bump = () => { deadline = Date.now() + AUTO_FULLSCREEN_IDLE_MS; armed = true; };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'];
    events.forEach(e => window.addEventListener(e, bump, { passive: true }));
    const id = window.setInterval(() => {
      if (!armed || document.hidden) return;
      if (Date.now() >= deadline) {
        armed = false;
        void enterFullscreen().catch(() => setFsPromptOpen(true));
      }
    }, 1000);
    return () => {
      window.clearInterval(id);
      events.forEach(e => window.removeEventListener(e, bump));
    };
  }, [isFullscreen, enterFullscreen, raw.phase]);

  // 屏幕常亮：防止大屏/手机在展示期间自动熄屏。
  useEffect(() => {
    let lock: { release?: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release?: () => Promise<void> }> } }).wakeLock;
        if (wl && document.visibilityState === 'visible') lock = await wl.request('screen');
      } catch { /* 不支持或被拒绝时静默降级 */ }
    };
    const onVis = () => { if (document.visibilityState === 'visible') void request(); };
    void request();
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); try { void lock?.release?.(); } catch { /* noop */ } };
  }, []);

  const confirmFullscreen = useCallback(() => {
    setFsPromptOpen(false);
    void enterFullscreen().catch(() => {});
  }, [enterFullscreen]);

  return (
    <div className="exam-root">
      <Suspense fallback={<div className="exam-design-loading">正在载入展示设计…</div>}><Design
        vm={vm}
        onDismissNotification={dismiss}
        onBack={() => navigate('/')}
        onAdmin={() => navigate('/admin')}
        onOpenAnnouncements={openAnnouncements}
        onSwitchDesign={() => setSwitcherOpen(true)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={() => { void toggleFullscreen(); }}
      /></Suspense>
      <Watermark exam />
      <ExamSyncAction
        state={examDataSyncState}
        lastSyncAt={examDataLastSyncAt}
        hasPendingSync={hasPendingSync}
        onRefresh={() => { void refreshExamData(true); }}
      />
      <ExamAnnouncementOverlay
        open={announcementsOpen}
        announcements={announcements}
        loading={announcementsLoading}
        onClose={() => setAnnouncementsOpen(false)}
      />
      {/* 设计切换窗：由各设计顶栏“▣ 切换设计”按���触发，避免悬浮按钮遮挡大屏元素 */}
      <DesignSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} currentId={designId} onSelect={chooseDesign} />
      {/* 全屏提醒浮层：风格跟随当前展示设计自动切换 */}
      <ExamAlertOverlay
        item={overlayItem}
        now={nowTick}
        designId={designId}
        masterTitle={title}
        timeSynced={isTimeSyncReady()}
      />
      {/* 考试结束后单独弹出的退出全屏提示：独立浮层，层级高于结束提醒，避免与提醒浮层耦合产生布局问题；仅考试结束后 15 分钟内显示 */}
      {isFullscreen && showEndedExit && (
        <div className="exam-ended-exit" role="dialog" aria-label="考试已结束，可退出全屏">
          <span className="exam-ended-exit__text">本场考试已结束</span>
          <button
            type="button"
            className="exam-ended-exit__btn"
            onClick={() => { void exitFullscreen(); }}
          >✕ 退出全屏</button>
        </div>
      )}
      {isMobile && !isMobileReadyDesign(designId) && !mobileNoticeDismissed && (
        <div className="exam-mobile-notice" role="alert">
          <span>当前设计未针对手机端优化，请到电脑端查看最优效果。</span>
          <div className="exam-mobile-notice__actions">
            <button type="button" onClick={() => setSwitcherOpen(true)}>切换适配设计</button>
            <button type="button" className="exam-mobile-notice__close" aria-label="关闭提示" onClick={() => setMobileNoticeDismissed(true)}>×</button>
          </div>
        </div>
      )}
      {fsPromptOpen && !isFullscreen && (
        <div className="exam-fs-prompt" role="dialog" aria-label="进入全屏展示" onClick={confirmFullscreen}>
          <div className="exam-fs-prompt__card" onClick={e => e.stopPropagation()}>
            <div className="exam-fs-prompt__icon" aria-hidden="true">⛶</div>
            <p className="exam-fs-prompt__title">轻触进入全屏展示</p>
            <p className="exam-fs-prompt__hint">大屏已静置 1 分钟，建议全屏投放以获得最佳布局</p>
            <div className="exam-fs-prompt__actions">
              <button type="button" className="exam-fs-prompt__go" onClick={confirmFullscreen}>进入全屏</button>
              <button type="button" className="exam-fs-prompt__later" onClick={() => setFsPromptOpen(false)}>暂不</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
