import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, ClipboardList, Info, Pencil, RefreshCw, Wifi } from 'lucide-react';
import ExamRecordDetailDrawer from '../ExamRecordDetailDrawer';
import { fetchExamRecords, type ExamRecordListEntry } from '../../services/examRecords';
import { fetchDeviceBindings } from '../../services/classBinding';
import { formatApiError } from '../../services/apiError';
import { DEVICE_ONLINE_WINDOW_MS, isDeviceInExam } from '../../shared/deviceContracts';
import type { MajorExam } from '../../types';
import type { ScheduleMode, WeeklyConflictPolicy, WeeklyPlan } from '../../types/exam';
import type { SchoolClass, SchoolGrade } from '../../types/school';
import { nowMs } from '../../utils/timeSource';
import { getShanghaiDateKey } from '../../utils/weeklySchedule';
import {
  buildExamCenterView,
  collectExamSessions,
  EXAM_SESSION_KIND_LABELS,
  EXAM_SESSION_STATUS_LABELS,
  formatClockHm,
  formatClockHms,
  formatCountdown,
  formatDayLabel,
  formatRelativeDay,
  formatShortCountdown,
  type ExamSession,
  type ExamSessionView,
} from '../../utils/examCenterStatus';
import '../../styles/exam-center-current.css';

const RECORDS_POLL_MS = 10_000;
const DEVICES_POLL_MS = 30_000;

type DeviceSummary = { online: number; total: number; inExam: number };

/**
 * 输入数据的「内容指纹」。
 *
 * 父级每次渲染都会重建 majors / classes / weeklyPlans 数组，直接拿它们当 useMemo 依赖
 * 会让「展开当天全部考试」这件事每秒重算一次。指纹只比对内容，数据没变就不重算。
 */
function buildScheduleKey(input: {
  majors: MajorExam[];
  weeklyPlans: WeeklyPlan[];
  classes: SchoolClass[];
  grades: SchoolGrade[];
  scheduleMode: ScheduleMode;
  weeklyConflictPolicy: WeeklyConflictPolicy;
  activeWeeklyPlanId: string | null;
  activeWeeklyPlanIdByClassId?: Record<string, string | null>;
  subjectTrackModeEnabled?: boolean;
  dayKey: string;
}): string {
  return [
    input.majors
      .map((major) =>
        [
          major.id,
          major.name,
          major.startAt ?? '',
          major.endAt ?? '',
          major.actualEndAt ?? '',
          major.pausedAt ?? '',
          major.pausedMs ?? '',
          major.endedAt ?? '',
          major.archivedAt ?? '',
          (major.targetGradeIds ?? []).join('.'),
          (major.targetClassIds ?? []).join('.'),
          major.temporary ? 1 : 0,
          major.priorityOverSchedule ? 1 : 0,
          major.items
            .map((item) =>
              [
                item.id,
                item.name,
                item.startTime,
                item.endTime,
                item.enabled === false ? 0 : 1,
                (item.targetGradeIds ?? []).join('.'),
                (item.targetClassIds ?? []).join('.'),
              ].join(','),
            )
            .join(';'),
        ].join(','),
      )
      .join('|'),
    input.weeklyPlans
      .map((plan) =>
        [
          plan.id,
          plan.name,
          plan.enabled === false ? 0 : 1,
          plan.activeFrom,
          plan.activeUntil ?? '',
          plan.anchorDate,
          plan.repeatEveryWeeks,
          plan.weekMode ?? '',
          (plan.excludedDates ?? []).join('.'),
          (plan.items ?? [])
            .map((item) =>
              [item.id, item.name, item.weekday, item.startTime, item.endTime, item.enabled === false ? 0 : 1].join(
                ',',
              ),
            )
            .join(';'),
        ].join(','),
      )
      .join('|'),
    input.classes
      .map((schoolClass) => `${schoolClass.id},${schoolClass.gradeId},${(schoolClass.track ?? []).join('.')}`)
      .join('|'),
    input.grades.map((grade) => `${grade.id},${grade.name}`).join('|'),
    input.scheduleMode,
    `${input.weeklyConflictPolicy.enabled ? 1 : 0},${input.weeklyConflictPolicy.scope},${input.weeklyConflictPolicy.bufferBeforeMinutes},${input.weeklyConflictPolicy.bufferAfterMinutes}`,
    input.activeWeeklyPlanId ?? '',
    JSON.stringify(input.activeWeeklyPlanIdByClassId ?? {}),
    input.subjectTrackModeEnabled ? 1 : 0,
    input.dayKey,
  ].join('||');
}

export type CurrentExamPanelProps = {
  majors: MajorExam[];
  weeklyPlans: WeeklyPlan[];
  grades: SchoolGrade[];
  classes: SchoolClass[];
  scheduleMode: ScheduleMode;
  weeklyConflictPolicy: WeeklyConflictPolicy;
  activeWeeklyPlanId: string | null;
  activeWeeklyPlanIdByClassId?: Record<string, string | null>;
  subjectTrackModeEnabled?: boolean;
  /** 云同步状态；只做展示，页面不参与同步逻辑。 */
  syncLabel: string;
  syncTone: 'ok' | 'warn' | 'busy';
  online: boolean;
  can: (permission: string) => boolean;
  /** 带着某场考试（id + 名称）跳到编辑器。 */
  onEditExam: (majorId: string, examName: string) => void;
  /** 跳到「考试安排」板块。 */
  onGoSchedule: () => void;
  /** 父级在创建/发布等写操作后自增，触发重新拉取。 */
  refreshKey?: number;
};

function scopeDetail(session: ExamSessionView): string {
  const parts = [session.scope.label];
  if (session.scope.classCount > 1) parts.push(`${session.scope.classCount} 个班级`);
  return parts.join(' · ');
}

function SessionFacts({ session, now, dayKey }: { session: ExamSessionView; now: number; dayKey: string }) {
  return (
    <dl className="exam-now__facts">
      <div>
        <dt>考试类型</dt>
        <dd>{EXAM_SESSION_KIND_LABELS[session.kind]}</dd>
      </div>
      <div>
        <dt>科目</dt>
        <dd>{session.subject}</dd>
      </div>
      <div>
        <dt>日期</dt>
        <dd>{formatRelativeDay(session.startAt, dayKey)}</dd>
      </div>
      <div>
        <dt>适用范围</dt>
        <dd>{scopeDetail(session)}</dd>
      </div>
      <div>
        <dt>当前时间</dt>
        <dd>{formatClockHms(now)}</dd>
      </div>
    </dl>
  );
}

function SessionCard({
  session,
  now,
  dayKey,
  variant,
}: {
  session: ExamSessionView;
  now: number;
  dayKey: string;
  variant: 'hero' | 'compact';
}) {
  const statusLabel = EXAM_SESSION_STATUS_LABELS[session.status];
  const progress = Math.round(session.progress * 1000) / 10;
  if (variant === 'compact') {
    return (
      <article className={`exam-now-card is-compact is-${session.status}`}>
        <header>
          <span className={`exam-now-pill is-${session.status}`}>{statusLabel}</span>
          <span className="exam-now-card__kind">{EXAM_SESSION_KIND_LABELS[session.kind]}</span>
        </header>
        <h3>{session.subject}</h3>
        <p className="exam-now-card__exam">{session.examName}</p>
        <p className="exam-now-card__time">
          {formatClockHm(session.startAt)} — {formatClockHm(session.effectiveEndAt)}
        </p>
        <p className="exam-now-card__scope">{scopeDetail(session)}</p>
        <p className="exam-now-card__countdown">
          {session.status === 'running' || session.status === 'paused'
            ? formatCountdown(session.remainingMs)
            : session.status === 'ended'
              ? '已结束'
              : `还有 ${formatShortCountdown(session.startAt - now)}`}
        </p>
      </article>
    );
  }
  return (
    <article className={`exam-now-card is-hero is-${session.status}`}>
      <header>
        <span className={`exam-now-pill is-${session.status}`}>{statusLabel}</span>
        <span className="exam-now-card__kind">{EXAM_SESSION_KIND_LABELS[session.kind]}</span>
      </header>
      <p className="exam-now-card__exam">{session.examName}</p>
      <h2>{session.subject}</h2>
      {(session.status === 'running' || session.status === 'paused') && (
        <>
          <p className="exam-now-card__countdown" aria-live="off">
            {formatCountdown(session.remainingMs)}
          </p>
          <p className="exam-now-card__countdown-label">
            {session.status === 'paused' ? '已暂停 · 剩余时间冻结' : '剩余时间'}
          </p>
          <p className="exam-now-card__elapsed">已进行 {formatCountdown(session.elapsedMs)}</p>
        </>
      )}
      <div className="exam-now-card__track" role="img" aria-label={`考试进度 ${progress}%`}>
        <span className="exam-now-card__track-time">{formatClockHm(session.startAt)}</span>
        <span className="exam-now-card__track-bar">
          <span style={{ width: `${progress}%` }} />
        </span>
        <span className="exam-now-card__track-time">{formatClockHm(session.effectiveEndAt)}</span>
      </div>
      <SessionFacts session={session} now={now} dayKey={dayKey} />
    </article>
  );
}

export default function CurrentExamPanel({
  majors,
  weeklyPlans,
  grades,
  classes,
  scheduleMode,
  weeklyConflictPolicy,
  activeWeeklyPlanId,
  activeWeeklyPlanIdByClassId,
  subjectTrackModeEnabled,
  syncLabel,
  syncTone,
  online,
  can,
  onEditExam,
  onGoSchedule,
  refreshKey = 0,
}: CurrentExamPanelProps) {
  const [now, setNow] = useState(() => nowMs());
  const [records, setRecords] = useState<ExamRecordListEntry[] | null>(null);
  const [recordsError, setRecordsError] = useState('');
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [devices, setDevices] = useState<DeviceSummary | null>(null);
  /** 设备心跳最近一次读取失败：保留旧数字并标注滞后，而不是清空状态条。 */
  const [devicesStale, setDevicesStale] = useState(false);
  const [detailId, setDetailId] = useState('');
  const [manualRefresh, setManualRefresh] = useState(0);

  // 倒计时用 1 秒时钟；页面不可见时停跳，回来时立即对齐一次，避免后台标签页空转。
  useEffect(() => {
    let timer = 0;
    const tick = () => setNow(nowMs());
    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(tick, 1_000);
      tick();
    };
    const stop = () => window.clearInterval(timer);
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const loadRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      const result = await fetchExamRecords({ page: 1, pageSize: 100, preset: 'current' });
      setRecords(result.data);
      setRecordsError('');
      setLastSyncedAt(Date.now());
    } catch (caught) {
      // 记录层只是状态权威源：读不到时保留上一批状态（首次失败才退回「状态未知」），
      // 清空会让整页状态闪一下再恢复。
      setRecordsError(formatApiError(caught, '考试状态读取失败'));
    } finally {
      setRecordsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecords();
    const timer = window.setInterval(() => void loadRecords(), RECORDS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadRecords, manualRefresh, refreshKey]);

  const loadDevices = useCallback(async () => {
    try {
      const result = await fetchDeviceBindings();
      const active = result.bindings.filter((item) => !item.revoked);
      const stamp = Date.now();
      setDevices({
        online: active.filter((item) => stamp - item.lastSeenAt <= DEVICE_ONLINE_WINDOW_MS).length,
        total: active.length,
        inExam: active.filter((item) => isDeviceInExam(item.status)).length,
      });
      setDevicesStale(false);
    } catch {
      // 同理：读不到设备心跳时保留上一次的数字，只标「可能滞后」，不要清空状态条。
      setDevicesStale(true);
    }
  }, []);

  useEffect(() => {
    void loadDevices();
    const timer = window.setInterval(() => void loadDevices(), DEVICES_POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadDevices]);

  const dayKey = getShanghaiDateKey(now);
  // 收集层随班级数放大，只在数据或日期变化时重算；每秒变化的时间交给下面的 view。
  const scheduleKey = useMemo(
    () =>
      buildScheduleKey({
        majors,
        weeklyPlans,
        classes,
        grades,
        scheduleMode,
        weeklyConflictPolicy,
        activeWeeklyPlanId,
        activeWeeklyPlanIdByClassId,
        subjectTrackModeEnabled,
        dayKey,
      }),
    [
      majors,
      weeklyPlans,
      classes,
      grades,
      scheduleMode,
      weeklyConflictPolicy,
      activeWeeklyPlanId,
      activeWeeklyPlanIdByClassId,
      subjectTrackModeEnabled,
      dayKey,
    ],
  );
  const sessionsRef = useRef<{ key: string; sessions: ExamSession[] }>({ key: '', sessions: [] });
  if (sessionsRef.current.key !== scheduleKey) {
    sessionsRef.current = {
      key: scheduleKey,
      sessions: collectExamSessions({
        majors,
        weeklyPlans,
        classes,
        grades,
        scheduleMode,
        weeklyConflictPolicy,
        activeWeeklyPlanId,
        activeWeeklyPlanIdByClassId,
        subjectTrackModeEnabled,
        dayKey,
      }),
    };
  }
  const sessions = sessionsRef.current.sessions;
  const view = useMemo(() => buildExamCenterView(sessions, records, now, dayKey), [sessions, records, now, dayKey]);

  const headline = view.headline;
  /** 抽屉自己按 id 取数；这里只是把手里已有的那一行当种子，避免开抽屉时闪一下加载态。 */
  const detailSeed = detailId ? (records?.find((item) => item.id === detailId) ?? null) : null;
  const canEdit = can('major.edit');
  const lastSyncLabel = lastSyncedAt ? `${Math.max(0, Math.round((now - lastSyncedAt) / 1000))} 秒前` : '—';

  const openDetail = (session: ExamSessionView) => {
    if (!session.recordId) return;
    setDetailId(session.recordId);
  };

  return (
    <main className="exam-now">
      <header className="exam-now__topbar">
        <div className="exam-now__brand">
          <span className="exam-now__eyebrow">NOVORA · 考试中心</span>
          <h1>当前考试</h1>
        </div>
        <div className="exam-now__clock">
          <span className="exam-now__date">{formatDayLabel(now)}</span>
          <strong>{formatClockHms(now)}</strong>
        </div>
        <div className="exam-now__topbar-actions">
          <span className={`exam-now-sync is-${syncTone}`}>
            <span className="exam-now-sync__dot" />
            {online ? syncLabel : '离线 · 数据可能滞后'}
          </span>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => setManualRefresh((value) => value + 1)}
            disabled={recordsLoading}
          >
            <RefreshCw size={16} aria-hidden="true" />
            刷新
          </button>
        </div>
      </header>

      {recordsError && (
        <p className="exam-now__banner is-warn">
          <AlertTriangle size={16} aria-hidden="true" />
          {recordsError}（下方时间线取自本地快照，考试状态可能滞后）
        </p>
      )}

      <section className="exam-now__hero" aria-label="正在进行或即将开始的考试">
        {view.running.length > 0 ? (
          <>
            {view.running.length > 1 && <p className="exam-now__concurrent">同时进行 {view.running.length} 场考试</p>}
            <div className={`exam-now__grid${view.running.length > 1 ? ' is-multi' : ''}`}>
              {view.running.map((session) => (
                <SessionCard
                  key={session.key}
                  session={session}
                  now={now}
                  dayKey={dayKey}
                  variant={view.running.length > 1 ? 'compact' : 'hero'}
                />
              ))}
            </div>
          </>
        ) : view.overdue.length > 0 ? (
          <>
            {view.overdue.map((session) => (
              <article key={session.key} className="exam-now-card is-hero is-overdue">
                <header>
                  <span className="exam-now-pill is-overdue">{EXAM_SESSION_STATUS_LABELS.overdue}</span>
                  <span className="exam-now-card__kind">{EXAM_SESSION_KIND_LABELS[session.kind]}</span>
                </header>
                <p className="exam-now-card__exam">{session.examName}</p>
                <h2>{session.subject}</h2>
                <p className="exam-now-card__hint">
                  计划结束时间 {formatClockHm(session.effectiveEndAt)}{' '}
                  已过，但考试仍未结束。请到「考试安排」结束或延长。
                </p>
                <p className="exam-now-card__elapsed">已超时 {formatCountdown(now - session.effectiveEndAt)}</p>
                <SessionFacts session={session} now={now} dayKey={dayKey} />
              </article>
            ))}
          </>
        ) : headline?.status === 'ended' ? (
          <article className="exam-now-card is-hero is-ended">
            <header>
              <span className="exam-now-pill is-ended">考试已结束</span>
              <span className="exam-now-card__kind">{EXAM_SESSION_KIND_LABELS[headline.kind]}</span>
            </header>
            <p className="exam-now-card__exam">{headline.examName}</p>
            <h2>{headline.subject}</h2>
            <p className="exam-now-card__time">
              {formatClockHm(headline.startAt)} — {formatClockHm(headline.effectiveEndAt)}
            </p>
            <p className="exam-now-card__hint">
              {view.upcoming[0]
                ? `下一场：${view.upcoming[0].subject} · ${formatRelativeDay(view.upcoming[0].startAt, dayKey)} ${formatClockHm(view.upcoming[0].startAt)}`
                : '今天已没有后续考试安排。'}
            </p>
          </article>
        ) : view.upcoming.length > 0 ? (
          <article className="exam-now-card is-hero is-upcoming">
            <span className="exam-now__section-label">下一场考试</span>
            <p className="exam-now-card__exam">{view.upcoming[0].examName}</p>
            <h2>{view.upcoming[0].subject}</h2>
            <p className="exam-now-card__countdown">{formatCountdown(view.upcoming[0].startAt - now)}</p>
            <p className="exam-now-card__countdown-label">
              距离开始 · {formatRelativeDay(view.upcoming[0].startAt, dayKey)} {formatClockHm(view.upcoming[0].startAt)}
            </p>
            <SessionFacts session={view.upcoming[0]} now={now} dayKey={dayKey} />
          </article>
        ) : (
          <article className="exam-now-card is-hero is-empty">
            <ClipboardList size={34} aria-hidden="true" />
            <h2>当前无考试</h2>
            <p className="exam-now-card__hint">
              {view.hasAnyExamToday
                ? '今天的考试都已结束，未来一周也没有排期。'
                : '今天没有安排考试，未来一周也没有排期，可在「考试安排」新建。'}
            </p>
          </article>
        )}
      </section>

      <section className="exam-now__timeline" aria-label="上一场、当前与下一场">
        <div className="exam-now__timeline-slot">
          <span className="exam-now__section-label">上一场</span>
          {view.previous ? (
            <SessionCard session={view.previous} now={now} dayKey={dayKey} variant="compact" />
          ) : (
            <p className="exam-now__placeholder">今天之前没有已结束的考试</p>
          )}
        </div>
        <div className="exam-now__timeline-slot is-current">
          <span className="exam-now__section-label">当前</span>
          {view.running.length ? (
            <ul className="exam-now__current-list">
              {view.running.map((session) => (
                <li key={session.key}>
                  <strong>{session.subject}</strong>
                  <span>{session.examName}</span>
                  <span className={`exam-now-pill is-${session.status}`}>
                    {EXAM_SESSION_STATUS_LABELS[session.status]}
                  </span>
                  <code>{formatCountdown(session.remainingMs)}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="exam-now__placeholder">当前没有正在进行的考试</p>
          )}
        </div>
        <div className="exam-now__timeline-slot">
          <span className="exam-now__section-label">下一场</span>
          {view.upcoming.length ? (
            <ul className="exam-now__next-list">
              {view.upcoming.slice(0, 3).map((session) => (
                <li key={session.key}>
                  <strong>{session.subject}</strong>
                  <span>{session.examName}</span>
                  <span>
                    {formatRelativeDay(session.startAt, dayKey)} {formatClockHm(session.startAt)}
                  </span>
                  <em>还有 {formatShortCountdown(session.startAt - now)}</em>
                </li>
              ))}
            </ul>
          ) : (
            <p className="exam-now__placeholder">未来一周没有排期</p>
          )}
        </div>
      </section>

      <section className="exam-now__actions" aria-label="快捷操作">
        <div className="exam-now__action-buttons">
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            disabled={!headline || !headline.recordId}
            onClick={() => headline && openDetail(headline)}
          >
            <Info size={16} aria-hidden="true" />
            查看详情
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            disabled={!canEdit || !headline || headline.kind === 'weekly'}
            onClick={() => headline && onEditExam(headline.sourceId, headline.examName)}
          >
            <Pencil size={16} aria-hidden="true" />
            编辑考试
          </button>
          <button type="button" className="admin-btn admin-btn--ghost" onClick={onGoSchedule}>
            <CalendarClock size={16} aria-hidden="true" />
            进入考试安排
          </button>
        </div>
        <p className="exam-now__hint">当前考试只负责实时态势；创建、修改与结束考试在「考试安排」完成。</p>
      </section>

      <footer className="exam-now__statusbar">
        <span className={`exam-now-status is-${syncTone}`}>
          <span className="exam-now-status__dot" />
          数据同步 {online ? syncLabel : '离线'}
        </span>
        <span className={`exam-now-status is-${online ? 'ok' : 'warn'}`}>
          <span className="exam-now-status__dot" />
          服务端 {online ? '正常' : '离线'}
        </span>
        <span className={`exam-now-status is-${devices && devices.total > 0 && devices.online === 0 ? 'warn' : 'ok'}`}>
          <span className="exam-now-status__dot" />
          <Wifi size={14} aria-hidden="true" />
          {devices
            ? devices.total === 0
              ? '暂无绑定客户端'
              : `客户端 ${devices.online}/${devices.total} 在线${devices.inExam ? ` · ${devices.inExam} 台考试中` : ''}${
                  devicesStale ? ' · 可能滞后' : ''
                }`
            : '客户端状态读取失败'}
        </span>
        <span className="exam-now-status">
          最后同步 {lastSyncLabel}
          {view.lifecycleUnknown ? ' · 状态待恢复' : ''}
        </span>
      </footer>

      {detailId && (
        <ExamRecordDetailDrawer
          recordId={detailId}
          record={detailSeed}
          grades={grades}
          classes={classes}
          can={can}
          onClose={() => setDetailId('')}
          onChanged={() => {
            setManualRefresh((value) => value + 1);
          }}
        />
      )}
    </main>
  );
}
