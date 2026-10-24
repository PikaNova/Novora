import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AdminModalPortal from './AdminModalPortal';
import ExamAnnouncementDialog from './admin/ExamAnnouncementDialog';
import { confirmDialog } from '../services/appDialog';
import { formatApiError } from '../services/apiError';
import { fetchDeviceBindings, type DeviceBindingInfo } from '../services/classBinding';
import {
  EXAM_RECORD_ACTION_LABELS,
  fetchExamRecord,
  fetchExamRecordOperations,
  newIdempotencyKey,
  requiresIdempotencyKey,
  runExamRecordAction,
  fetchExamRecordPrecheck,
  type ExamRecordListEntry,
  type ExamRecordOperationEntry,
  type ExamRecordSubjectEntry,
} from '../services/examRecords';
import {
  availableExamRecordActions,
  EXAM_RECORD_ACTION_PERMISSIONS,
  EXAM_RECORD_TIME_CHANGE_ACTIONS,
  EXAM_RECORD_STATUS_LABELS,
  type ExamRecordActionName,
} from '../shared/examRecordContracts.js';
import { buildExamDeviceSummary, filterExamDevices, isDeviceOnline } from '../utils/examDeviceDisplay';
import { buildExamRecordTimeline } from '../utils/examRecordTimeline';
import type { SchoolClass, SchoolGrade } from '../types/school';
import { adminSectionUrl } from '../hooks/admin/adminRoutes';
import { formatDateTimeInZone, getZonedParts, parseZonedTime } from '../utils/zonedTime';

const DEFAULT_EXTEND_MINUTES = 15;
const MAX_EXTEND_MINUTES = 600;

/** 操作日志里会出现、但不属于「记录动作」的条目（例如快速考试转正式）。 */
const EXTRA_OPERATION_LABELS: Record<string, string> = {
  promote: '转为正式考试',
  auto_start: '系统自动开考',
  auto_end: '系统自动结束',
  auto_archive: '系统自动归档',
  request_stop: '申请停止（历史操作）',
  force_end: '强制结束（历史操作）',
  publish: '发布考试',
  archive: '归档考试',
  unarchive: '取消归档',
};

const OPERATION_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  ongoing: '进行中',
  ended: '已结束',
  archived: '已归档',
};

type Props = {
  /**
   * 要展示的那场考试。抽屉自己按 id 取数：日程轴/班级网格里的行来自本地快照，
   * 可能属于别的板块，调用方的列表里不一定有这一行。
   */
  recordId: string;
  /** 调用方手里已有的那一行：有就先渲染，省掉一次空白等待；随后仍会按 id 校准一次。 */
  record?: ExamRecordListEntry | null;
  grades: SchoolGrade[];
  classes: SchoolClass[];
  can: (permission: string) => boolean;
  onClose: () => void;
  /** 动作成功后通知列表重新拉取（筛选条件由父组件保留）。 */
  onChanged: () => void;
  /**
   * 「编辑考试」的落点，由上层给：它知道要编辑哪一场、需不需要先切年级。
   * 没有传时直接跳「编辑考试」板块（只用于兼容旧调用方）。
   */
  onEdit?: (record: ExamRecordListEntry) => void;
  /** 调用方可按记录来源/所有权收窄编辑权限。 */
  canEditRecord?: (record: ExamRecordListEntry) => boolean;
  /** 草稿才有：删除这场草稿（由上层二次确认后按 id 从快照里移除）。 */
  onDiscard?: (record: ExamRecordListEntry) => void;
};

type PendingAction = { action: ExamRecordActionName; minutes?: number; reason?: string; idempotencyKey?: string };

const ACTION_CONFIRM: Record<
  ExamRecordActionName,
  { title: string; message: string; tone: 'info' | 'warning' | 'danger'; label: string }
> = {
  publish: {
    title: '发布考试',
    message: '发布后考试会下发到对应范围的教室大屏，未开考前仍可修改。',
    tone: 'info',
    label: '发布',
  },
  pause: {
    title: '暂停考试',
    // 暂停不等系统的到点校验：还没开考的考试也能手动暂停（服务端会先补记开考时间）。
    message: '暂停期间倒计时停止，教室大屏会立刻显示暂停状态；还没开考的考试会先记为已开考再暂停。',
    tone: 'warning',
    label: '暂停',
  },
  resume: {
    title: '继续考试',
    message: '恢复后倒计时重新开始，预计结束时间会按本次暂停时长顺延。',
    tone: 'info',
    label: '继续',
  },
  extend: {
    title: '延长当前科目',
    message: '仅延长当前正在进行的子考试，其他子考试的计划时间保持不变。',
    tone: 'info',
    label: '确认延长',
  },
  end: {
    title: '结束考试',
    message: '立即结束本场考试：教室大屏马上不再显示它，不用等系统判定，之后只能归档或复制。',
    tone: 'danger',
    label: '结束考试',
  },
  archive: {
    title: '归档考试',
    message: '归档后考试进入历史记录，默认不出现在列表里。',
    tone: 'danger',
    label: '归档',
  },
  unarchive: { title: '取消归档', message: '取消归档后考试回到已结束列表。', tone: 'info', label: '取消归档' },
  copy: {
    title: '复制考试',
    message: '会以当前科目生成一场新的草稿考试，原考试不受影响。',
    tone: 'info',
    label: '复制',
  },
};

function formatDateTime(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return '—';
  return formatDateTimeInZone(value);
}

function subjectTime(value: string, recordStartAt: number | null): number {
  if (!value) return Number.NaN;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return Date.parse(value);
  if (value.includes('T')) return parseZonedTime(value);
  if (recordStartAt == null || !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(value)) return Number.NaN;
  const date = getZonedParts(recordStartAt);
  const clock = value.length === 5 ? `${value}:00` : value;
  return parseZonedTime(
    `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}T${clock}`,
  );
}

function subjectStatus(item: ExamRecordSubjectEntry, startAt: number, endAt: number, now: number): string {
  if (!item.enabled) return '未启用';
  if (Number.isFinite(startAt) && Number.isFinite(endAt)) {
    if (now < startAt) return '未开始';
    if (now < endAt) return '进行中';
    return '已结束';
  }
  return '时间未设置';
}

function operationResult(entry: ExamRecordOperationEntry): string {
  const known: Record<string, string> = {
    pause: '已暂停',
    resume: '已继续',
    extend: '当前子考试时间已延长',
    end: '已结束',
    auto_start: '系统已开考',
    auto_end: '系统已结束',
    auto_archive: '系统已归档',
  };
  if (known[entry.action]) return known[entry.action];
  return entry.toStatus ? `状态变更为${OPERATION_STATUS_LABELS[entry.toStatus] ?? entry.toStatus}` : '已完成';
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 分钟';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分钟`;
}

type BodyProps = Omit<Props, 'recordId' | 'record'> & {
  record: ExamRecordListEntry;
  /** 动作执行后按 id 重新取一次这条记录，抽屉自己也能跟上最新状态。 */
  onRefreshRecord: () => Promise<void>;
};

function ExamRecordDetailBody({
  record,
  grades,
  classes,
  can,
  onClose,
  onChanged,
  onEdit,
  canEditRecord,
  onDiscard,
  onRefreshRecord,
}: BodyProps) {
  const navigate = useNavigate();
  const [operations, setOperations] = useState<ExamRecordOperationEntry[]>([]);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [operationsError, setOperationsError] = useState('');
  const [loadingOperations, setLoadingOperations] = useState(true);
  const [busyAction, setBusyAction] = useState<ExamRecordActionName | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [retry, setRetry] = useState<PendingAction | null>(null);
  const [minutes, setMinutes] = useState(String(DEFAULT_EXTEND_MINUTES));
  const [now, setNow] = useState(() => Date.now());
  const [reason, setReason] = useState('');
  const [devices, setDevices] = useState<DeviceBindingInfo[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [devicesError, setDevicesError] = useState('');
  const [devicesTruncated, setDevicesTruncated] = useState(false);
  const [deviceFilter, setDeviceFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [devicesExpanded, setDevicesExpanded] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [unboundOpen, setUnboundOpen] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState<'open' | 'ended' | 'all'>(
    record.displayStatus === 'ended' || record.displayStatus === 'archived' ? 'ended' : 'open',
  );
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [extendOpen, setExtendOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  const canReadDevices = can('device.read');

  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1000);
    return () => globalThis.clearInterval(timer);
  }, []);

  const loadOperations = useCallback(async () => {
    setLoadingOperations(true);
    setOperationsError('');
    try {
      setOperations(await fetchExamRecordOperations(record.id));
    } catch (caught) {
      setOperations([]);
      setOperationsError(formatApiError(caught, '读取操作记录失败'));
    } finally {
      setLoadingOperations(false);
    }
  }, [record.id]);

  useEffect(() => {
    void loadOperations();
  }, [loadOperations]);

  useEffect(() => {
    if (!canReadDevices) {
      setDevicesLoaded(true);
      return;
    }
    let active = true;
    setDevicesError('');
    void fetchDeviceBindings()
      .then((result) => {
        if (!active) return;
        setDevices(result.bindings);
        setDevicesTruncated(result.truncated);
      })
      .catch((caught) => {
        if (!active) return;
        setDevices([]);
        setDevicesTruncated(false);
        setDevicesError(formatApiError(caught, '读取设备状态失败'));
      })
      .finally(() => {
        if (active) setDevicesLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [canReadDevices]);

  const actions = useMemo(
    () =>
      availableExamRecordActions({
        status: record.displayStatus,
        actualStartAt: record.actualStartAt,
        pausedAt: record.pausedAt,
      }).filter((action) => can(EXAM_RECORD_ACTION_PERMISSIONS[action])),
    [can, record.actualStartAt, record.displayStatus, record.pausedAt],
  );

  const timeline = useMemo(() => buildExamRecordTimeline(record, operations), [operations, record]);
  // P1-⑤：最近一次改动时间的操作（延长/暂停/继续/结束/系统判定…），文案里带「旧 → 新」。
  const latestTimeChange = useMemo(
    () =>
      [...operations]
        .filter((entry) =>
          EXAM_RECORD_TIME_CHANGE_ACTIONS.includes(entry.action as (typeof EXAM_RECORD_TIME_CHANGE_ACTIONS)[number]),
        )
        .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null,
    [operations],
  );
  const effectiveEndAt = record.endAt == null ? null : record.endAt + record.pausedMs;
  const resumedEndAt =
    effectiveEndAt != null && record.pausedAt != null
      ? effectiveEndAt + Math.max(0, now - record.pausedAt)
      : effectiveEndAt;
  const subjects = useMemo(() => {
    const rows = (record.items ?? []).map((item) => {
      const startAt = subjectTime(item.startTime, record.startAt);
      let endAt = subjectTime(item.endTime, record.startAt);
      if (Number.isFinite(startAt) && Number.isFinite(endAt) && endAt <= startAt && !item.endTime.includes('T')) {
        endAt += 24 * 60 * 60_000;
      }
      return { item, startAt, endAt, status: subjectStatus(item, startAt, endAt, now) };
    });
    return rows.sort((left, right) => {
      const activeFirst = Number(right.status === '进行中') - Number(left.status === '进行中');
      if (activeFirst) return activeFirst;
      const leftTime = Number.isFinite(left.startAt) ? left.startAt : Number.MAX_SAFE_INTEGER;
      const rightTime = Number.isFinite(right.startAt) ? right.startAt : Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime || left.item.order - right.item.order;
    });
  }, [now, record.items, record.startAt]);
  const currentSubject = subjects.find((subject) => subject.status === '进行中') ?? null;
  const extendUnavailable = !currentSubject;
  const upcomingSubject = subjects.find((subject) => subject.status === '未开始') ?? null;
  const endedSubjectCount = subjects.filter((subject) => subject.status === '已结束').length;
  const openSubjectCount = subjects.length - endedSubjectCount;
  const subjectMatchesFilter = (status: string) => {
    if (subjectFilter === 'all') return true;
    if (subjectFilter === 'ended') return status === '已结束';
    return status !== '已结束';
  };
  const visibleSubjectRows = subjects.filter((subject) => subjectMatchesFilter(subject.status));
  const selectedSubject =
    visibleSubjectRows.find((subject) => subject.item.id === selectedSubjectId) ??
    visibleSubjectRows.find((subject) => subject.status === '进行中') ??
    visibleSubjectRows.find((subject) => subject.status === '未开始') ??
    visibleSubjectRows[0] ??
    null;
  const visibleActions = actions;
  const hasMoreActions = can('major.read') || (Boolean(onDiscard) && record.displayStatus === 'draft');

  // 设备状态只做「这场考试覆盖的教室设备在不在线」的汇总，不做任何控制类操作。
  // 筛选/排序/汇总的规则在 utils/examDeviceDisplay.ts，那边有回归测试。
  const deviceSummary = useMemo(
    () =>
      buildExamDeviceSummary({
        devices,
        classes,
        targetGradeIds: record.targetGradeIds,
        targetClassIds: record.targetClassIds,
        examName: record.name,
        now: Date.now(),
      }),
    [classes, devices, record.name, record.targetClassIds, record.targetGradeIds],
  );

  // 「设备多了怎么展示」：默认 6 张，展开后面板自己滚动，不把抽屉撑长。
  const filteredDevices = useMemo(
    () => filterExamDevices(deviceSummary.devices, deviceFilter, Date.now()),
    [deviceFilter, deviceSummary.devices],
  );
  const visibleDevices = devicesExpanded ? filteredDevices : filteredDevices.slice(0, 6);
  const deviceChipClass = (tone: 'online' | 'warn' | null, active: boolean) =>
    [tone ? `is-${tone}` : '', active ? 'is-active' : ''].filter(Boolean).join(' ') || undefined;

  const classLabel = (gradeId: string, classId: string) => {
    const gradeName = grades.find((grade) => grade.id === gradeId)?.name ?? gradeId ?? '未知年级';
    if (!classId) return `${gradeName} · 未指定班级`;
    return `${gradeName} · ${classes.find((item) => item.id === classId)?.name ?? classId}`;
  };

  const scopeLabel = () => {
    if (!record.targetGradeIds.length && !record.targetClassIds.length) return '全校';
    const names = [
      ...record.targetGradeIds.map((id) => grades.find((grade) => grade.id === id)?.name ?? id),
      ...record.targetClassIds.map((id) => classes.find((item) => item.id === id)?.name ?? id),
    ];
    return names.join('、');
  };

  const perform = async (pending: PendingAction) => {
    setBusyAction(pending.action);
    setActionError('');
    setActionNotice('');
    try {
      const result = await runExamRecordAction({
        id: record.id,
        action: pending.action,
        minutes: pending.minutes,
        reason: pending.reason || reason.trim() || undefined,
        idempotencyKey: pending.idempotencyKey,
      });
      setRetry(null);
      setActionNotice(
        result.idempotent
          ? `${EXAM_RECORD_ACTION_LABELS[pending.action]}已执行过，本次未重复生效。`
          : `${EXAM_RECORD_ACTION_LABELS[pending.action]}完成。`,
      );
      onChanged();
      await loadOperations();
      // 抽屉自己那份记录也要重新取：日程轴里的行可能根本不在调用方列表里，
      // 只靠父组件刷新的话，抽屉里的状态会一直停在动作前。
      await onRefreshRecord();
    } catch (caught) {
      setActionError(formatApiError(caught, `${EXAM_RECORD_ACTION_LABELS[pending.action]}失败`));
      // 保留幂等键，用户点「重试」时复用同一次意图，避免重复执行。
      setRetry({ ...pending, idempotencyKey: pending.idempotencyKey ?? keyFor(pending.action) });
    } finally {
      setBusyAction(null);
    }
  };

  const keyFor = (action: ExamRecordActionName) =>
    requiresIdempotencyKey(action) ? newIdempotencyKey(action, record.id) : undefined;

  const startAction = async (action: ExamRecordActionName) => {
    if (busyAction) return;
    let extendMinutes: number | undefined;
    if (action === 'extend') {
      extendMinutes = Math.floor(Number(minutes));
      if (!Number.isFinite(extendMinutes) || extendMinutes <= 0 || extendMinutes > MAX_EXTEND_MINUTES) {
        setActionError(`延长分钟数需在 1-${MAX_EXTEND_MINUTES} 之间`);
        return;
      }
    }
    const confirm = ACTION_CONFIRM[action];
    const extendBaseEndAt = currentSubject?.endAt ?? effectiveEndAt;
    const proposedEndAt =
      action === 'extend' && extendBaseEndAt != null && extendMinutes != null
        ? extendBaseEndAt + extendMinutes * 60_000
        : null;
    const proposedExamEndAt =
      action === 'extend' && proposedEndAt != null && record.endAt != null
        ? Math.max(effectiveEndAt ?? record.endAt, proposedEndAt + record.pausedMs)
        : null;
    // 发布前检查（T-286-01）：设备在线情况只做提示，不阻断发布。
    let publishWarning = '';
    if (action === 'publish') {
      try {
        const precheck = await fetchExamRecordPrecheck(record.id);
        if (precheck.warnings.length) {
          publishWarning = `\n\n发布前检查：${precheck.warnings.join('；')}。（可以直接发布，设备上线后会收到。）`;
        } else if (precheck.devices.bound) {
          publishWarning = `\n\n发布前检查：目标范围 ${precheck.devices.bound} 台设备，其中 ${precheck.devices.online} 台最近在线。`;
        }
      } catch {
        // 检查失败不挡发布：拿不到设备状态时按原提示继续。
      }
    }
    const confirmed = await confirmDialog({
      title: confirm.title,
      message:
        action === 'extend'
          ? `${confirm.message}\n延长目标：${currentSubject?.item.name ?? record.name}（当前进行中）\n当前科目预计结束：${formatDateTime(extendBaseEndAt)} → ${formatDateTime(proposedEndAt)}\n整场预计结束：${formatDateTime(effectiveEndAt)} → ${formatDateTime(proposedExamEndAt)}\n大型考试下其他子考试的计划时间保持不变；教室端会更新当前科目结束时间。`
          : action === 'resume'
            ? `${confirm.message}\n继续后预计结束时间：${formatDateTime(resumedEndAt)}\n本次暂停时长：${formatDuration(Math.max(0, now - (record.pausedAt ?? now)))}`
            : action === 'pause'
              ? `${confirm.message}\n当前预计结束时间：${formatDateTime(effectiveEndAt)}${reason.trim() ? `\n备注：${reason.trim()}` : ''}`
              : action === 'end'
                ? `${confirm.message}${reason.trim() ? `\n备注：${reason.trim()}` : ''}`
                : `${confirm.message}${publishWarning}`,
      tone: confirm.tone,
      confirmLabel: confirm.label,
    });
    if (!confirmed) return;
    if (action === 'extend') setExtendOpen(false);
    await perform({
      action,
      minutes: extendMinutes,
      reason: reason.trim() || undefined,
      idempotencyKey: keyFor(action),
    });
  };

  return (
    <AdminModalPortal className="admin-modal-overlay" role="dialog" aria-modal="true" aria-label="考试详情">
      <div className="admin-modal admin-modal--wide exam-record-detail" onClick={(event) => event.stopPropagation()}>
        <header className="exam-record-detail__head">
          <div className="exam-record-detail__head-main">
            <div className="exam-record-detail__title-row">
              <h2 className="admin-modal__title">{record.name || '未命名考试'}</h2>
              <span className={`exam-records-status is-${record.displayStatus}`}>
                {EXAM_RECORD_STATUS_LABELS[record.displayStatus]}
              </span>
            </div>
            <span className="exam-record-detail__head-meta">
              {scopeLabel()} · {record.itemCount} 个科目 · 预计 {formatDateTime(effectiveEndAt)} 结束
            </span>
          </div>
          <div className="exam-record-detail__head-actions">
            {can('major.edit') && (
              <button className="admin-btn admin-btn--ghost" type="button" onClick={() => setAnnounceOpen(true)}>
                发送公告
              </button>
            )}
            {((onEdit && (canEditRecord?.(record) ?? true)) || (!onEdit && can('major.edit'))) && (
              <button
                className="admin-btn admin-btn--ghost"
                type="button"
                onClick={() => {
                  onClose();
                  if (onEdit) {
                    onEdit(record);
                    return;
                  }
                  navigate(adminSectionUrl({ tab: 'exam', view: 'editor' }));
                }}
              >
                编辑考试
              </button>
            )}
            {hasMoreActions && (
              <details className="exam-record-detail__more">
                <summary className="admin-btn admin-btn--ghost">更多</summary>
                <div className="exam-record-detail__more-menu">
                  {can('major.read') && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        navigate(adminSectionUrl({ tab: 'announcements' }));
                      }}
                    >
                      公告管理
                    </button>
                  )}
                  {onDiscard && record.displayStatus === 'draft' && (
                    <button className="is-danger" type="button" onClick={() => onDiscard(record)}>
                      删除草稿
                    </button>
                  )}
                </div>
              </details>
            )}
            <button className="admin-btn admin-btn--ghost" type="button" onClick={onClose} aria-label="关闭详情">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="exam-record-detail__body">
          {(record.displayStatus === 'ongoing' || record.pausedAt != null) && (
            <section
              className={`exam-record-detail__live ${
                record.pausedAt != null ? 'is-paused' : currentSubject ? 'is-ongoing' : 'is-between'
              }`}
              aria-live="polite"
            >
              <div>
                <span className="exam-record-detail__eyebrow">
                  {record.pausedAt != null ? '整场考试已暂停' : '整场考试进行中'}
                </span>
                <strong>
                  {record.pausedAt != null
                    ? '倒计时已冻结'
                    : currentSubject
                      ? `当前科目 · ${currentSubject.item.name}`
                      : upcomingSubject
                        ? `当前无进行中科目 · 下一场 ${upcomingSubject.item.name}`
                        : '当前无进行中科目'}
                </strong>
                <span>
                  {record.pausedAt != null
                    ? `暂停中 · 整场预计结束 ${formatDateTime(effectiveEndAt)}`
                    : currentSubject
                      ? `${formatDateTime(currentSubject.startAt)} – ${formatDateTime(currentSubject.endAt)}`
                      : upcomingSubject
                        ? `${formatDateTime(upcomingSubject.startAt)} – ${formatDateTime(upcomingSubject.endAt)}`
                        : `整场预计结束 ${formatDateTime(effectiveEndAt)}`}
                </span>
              </div>
              <b>
                {record.pausedAt != null
                  ? '倒计时已暂停'
                  : currentSubject
                    ? `本科目剩余 ${formatDuration(currentSubject.endAt - now)}`
                    : upcomingSubject
                      ? `距开考 ${formatDuration(upcomingSubject.startAt - now)}`
                      : `整场剩余 ${formatDuration((effectiveEndAt ?? now) - now)}`}
              </b>
            </section>
          )}

          <dl className="exam-record-detail__summary" aria-label="考试概要">
            <div>
              <dt>适用范围</dt>
              <dd>{scopeLabel()}</dd>
            </div>
            <div>
              <dt>考试类型</dt>
              <dd>
                {record.source === 'quick' ? '快速考试' : '正式考试'} · {record.itemCount} 科
              </dd>
            </div>
            <div>
              <dt>整场预计结束</dt>
              <dd>{formatDateTime(effectiveEndAt)}</dd>
            </div>
            <div>
              <dt>当前焦点</dt>
              <dd>
                {currentSubject
                  ? currentSubject.item.name
                  : upcomingSubject
                    ? `下一场 · ${upcomingSubject.item.name}`
                    : endedSubjectCount
                      ? '全部科目已结束'
                      : '暂无科目安排'}
              </dd>
            </div>
          </dl>

          <div className="exam-record-detail__workspace">
            <section className="exam-record-detail__subjects" aria-label="考试科目">
              <div className="exam-record-detail__section-head">
                <div>
                  <h3>
                    科目进度 <span>{subjects.length}</span>
                  </h3>
                  <p>选择科目查看安排；已结束科目默认收起。</p>
                </div>
                <div className="exam-record-detail__subject-tabs" role="group" aria-label="筛选考试科目">
                  <button
                    type="button"
                    className={subjectFilter === 'open' ? 'is-active' : undefined}
                    aria-pressed={subjectFilter === 'open'}
                    onClick={() => setSubjectFilter('open')}
                  >
                    未结束 <span>{openSubjectCount}</span>
                  </button>
                  <button
                    type="button"
                    className={subjectFilter === 'ended' ? 'is-active' : undefined}
                    aria-pressed={subjectFilter === 'ended'}
                    onClick={() => setSubjectFilter('ended')}
                  >
                    已结束 <span>{endedSubjectCount}</span>
                  </button>
                  <button
                    type="button"
                    className={subjectFilter === 'all' ? 'is-active' : undefined}
                    aria-pressed={subjectFilter === 'all'}
                    onClick={() => setSubjectFilter('all')}
                  >
                    全部
                  </button>
                </div>
              </div>

              {subjects.length === 0 ? (
                <p className="exam-record-detail__hint">详情接口暂未提供科目时间。</p>
              ) : (
                <>
                  <ol>
                    {subjects.map(({ item, startAt, endAt, status }) => {
                      const matchesFilter = subjectMatchesFilter(status);
                      const selected = selectedSubject?.item.id === item.id;
                      return (
                        <li
                          key={item.id}
                          hidden={!matchesFilter}
                          className={[status === '进行中' ? 'is-current' : '', selected ? 'is-selected' : '']
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <button type="button" aria-pressed={selected} onClick={() => setSelectedSubjectId(item.id)}>
                            <strong>{item.name}</strong>
                            <span>
                              {Number.isFinite(startAt) ? formatDateTime(startAt) : item.startTime || '—'} –{' '}
                              {Number.isFinite(endAt) ? formatDateTime(endAt) : item.endTime || '—'}
                            </span>
                            <em
                              className={`is-${
                                status === '进行中' ? 'ongoing' : status === '已结束' ? 'ended' : 'pending'
                              }`}
                            >
                              {status}
                            </em>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                  {visibleSubjectRows.length === 0 ? (
                    <div className="exam-record-detail__empty-subjects">
                      <span>当前筛选下没有科目。</span>
                      <button type="button" onClick={() => setSubjectFilter('all')}>
                        查看全部科目
                      </button>
                    </div>
                  ) : (
                    selectedSubject && (
                      <article
                        key={selectedSubject.item.id}
                        className="exam-record-detail__selected-subject"
                        aria-live="polite"
                      >
                        <div>
                          <span>当前选择</span>
                          <strong>{selectedSubject.item.name}</strong>
                        </div>
                        <div>
                          <span>安排时间</span>
                          <b>
                            {formatDateTime(selectedSubject.startAt)} – {formatDateTime(selectedSubject.endAt)}
                          </b>
                        </div>
                        <em
                          className={`is-${
                            selectedSubject.status === '进行中'
                              ? 'ongoing'
                              : selectedSubject.status === '已结束'
                                ? 'ended'
                                : 'pending'
                          }`}
                        >
                          {selectedSubject.status === '进行中'
                            ? '当前可暂停、延长或结束'
                            : selectedSubject.status === '已结束'
                              ? '该科目已结束'
                              : '等待开考，可在编辑考试中调整计划'}
                        </em>
                      </article>
                    )
                  )}
                </>
              )}
            </section>

            <aside className="exam-record-detail__side">
              <section className="exam-record-detail__devices" aria-label="设备概览">
                <div className="exam-record-detail__section-head">
                  <div>
                    <h3>设备概览</h3>
                    <p>仅显示异常摘要，需要排查时再展开。</p>
                  </div>
                  {devicesLoaded && deviceSummary.devices.length > 0 && (
                    <button
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      type="button"
                      aria-expanded={devicesOpen}
                      onClick={() => setDevicesOpen((value) => !value)}
                    >
                      {devicesOpen ? '收起设备' : '查看设备'}
                    </button>
                  )}
                </div>
                {!canReadDevices ? (
                  <p className="exam-record-detail__hint">当前账号没有查看设备的权限。</p>
                ) : devicesError ? (
                  <p className="exam-record-detail__hint is-error">{devicesError}</p>
                ) : !devicesLoaded ? (
                  <p className="exam-record-detail__hint">正在读取设备状态…</p>
                ) : deviceSummary.devices.length === 0 ? (
                  <p className="exam-record-detail__hint">这场考试范围内还没有绑定设备。</p>
                ) : (
                  <>
                    <p className="exam-record-detail__device-summary">
                      <button
                        type="button"
                        className={deviceChipClass(null, deviceFilter === 'all')}
                        aria-pressed={deviceFilter === 'all'}
                        onClick={() => {
                          setDeviceFilter('all');
                          setDevicesOpen(true);
                        }}
                      >
                        覆盖 {deviceSummary.devices.length} 台
                      </button>
                      <button
                        type="button"
                        className={deviceChipClass(
                          deviceSummary.online > 0 ? 'online' : null,
                          deviceFilter === 'online',
                        )}
                        aria-pressed={deviceFilter === 'online'}
                        onClick={() => {
                          setDeviceFilter('online');
                          setDevicesOpen(true);
                        }}
                      >
                        在线 {deviceSummary.online}
                      </button>
                      <button
                        type="button"
                        className={deviceChipClass(null, deviceFilter === 'offline')}
                        aria-pressed={deviceFilter === 'offline'}
                        onClick={() => {
                          setDeviceFilter('offline');
                          setDevicesOpen(true);
                        }}
                      >
                        离线 {deviceSummary.offline}
                      </button>
                      {deviceSummary.unboundClasses > 0 && (
                        <button
                          type="button"
                          className={deviceChipClass('warn', unboundOpen)}
                          aria-expanded={unboundOpen}
                          onClick={() => setUnboundOpen((value) => !value)}
                        >
                          {deviceSummary.unboundClasses} 个班级未绑定
                        </button>
                      )}
                    </p>
                    {unboundOpen && deviceSummary.unboundClassNames.length > 0 && (
                      <p className="exam-record-detail__hint exam-record-detail__reveal">
                        未绑定设备：{deviceSummary.unboundClassNames.join('、')}
                      </p>
                    )}
                    {devicesOpen && (
                      <div className="exam-record-detail__device-detail exam-record-detail__reveal">
                        {filteredDevices.length > 0 ? (
                          <ul className={devicesExpanded && filteredDevices.length > 6 ? 'is-scroll' : undefined}>
                            {visibleDevices.map((item) => {
                              const online = isDeviceOnline(item, Date.now());
                              return (
                                <li key={item.instanceId}>
                                  <strong>{classLabel(item.gradeId, item.classId)}</strong>
                                  <span className={online ? 'is-online' : 'is-offline'}>
                                    {online ? '在线' : '离线'}
                                  </span>
                                  <em>
                                    {item.currentExam
                                      ? `当前显示：${item.currentExam}`
                                      : `最后在线 ${formatDateTime(item.lastSeenAt)}`}
                                  </em>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="exam-record-detail__hint">当前筛选下没有设备。</p>
                        )}
                        {filteredDevices.length > 6 && (
                          <button
                            className="admin-btn admin-btn--ghost admin-btn--sm exam-record-detail__devices-more"
                            type="button"
                            onClick={() => setDevicesExpanded((value) => !value)}
                          >
                            {devicesExpanded ? '收起' : `展开全部 ${filteredDevices.length} 台`}
                          </button>
                        )}
                        {devicesTruncated && (
                          <p className="exam-record-detail__hint">设备总数超过一次读取上限，这里只统计了前 500 台。</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </section>

              <details className="exam-record-detail__disclosure">
                <summary>
                  <span>
                    <strong>考试详情</strong>
                    <em>范围、时间、生命周期</em>
                  </span>
                  <i aria-hidden="true" />
                </summary>
                <div className="exam-record-detail__disclosure-panel">
                  <section className="exam-record-detail__facts" aria-label="基本信息">
                    <h3>基本信息</h3>
                    <dl>
                      <div>
                        <dt>记录编号</dt>
                        <dd>
                          <code>{record.id}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>创建人</dt>
                        <dd>{record.createdByName || (record.createdBy == null ? '系统' : `#${record.createdBy}`)}</dd>
                      </div>
                      <div>
                        <dt>创建时间</dt>
                        <dd>{formatDateTime(record.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>更新时间</dt>
                        <dd>{formatDateTime(record.updatedAt)}</dd>
                      </div>
                      <div>
                        <dt>计划时间</dt>
                        <dd>
                          {record.startAt
                            ? `${formatDateTime(record.startAt)} - ${formatDateTime(record.endAt)}`
                            : '未设置'}
                        </dd>
                      </div>
                      <div>
                        <dt>实际开考</dt>
                        <dd>{formatDateTime(record.actualStartAt)}</dd>
                      </div>
                      <div>
                        <dt>实际结束</dt>
                        <dd>{formatDateTime(record.actualEndAt ?? record.endedAt)}</dd>
                      </div>
                      <div>
                        <dt>累计暂停</dt>
                        <dd>{formatDuration(record.pausedMs)}</dd>
                      </div>
                      {latestTimeChange?.reason && (
                        <div className="exam-record-detail__time-change">
                          <dt>最近时间调整</dt>
                          <dd>{latestTimeChange.reason}</dd>
                        </div>
                      )}
                      {record.stopRequestedAt != null && (
                        <div className="exam-record-detail__time-change">
                          <dt>停止申请</dt>
                          <dd>
                            {formatDateTime(record.stopRequestedAt)}
                            <em className="exam-record-detail__time-note">
                              等待系统判定：到结束时间 / 教室端全部结束 / 长时间无在线设备
                            </em>
                          </dd>
                        </div>
                      )}
                    </dl>
                  </section>

                  <section className="exam-record-detail__timeline" aria-label="生命周期">
                    <h3>生命周期</h3>
                    <ol>
                      {timeline.map((stage) => (
                        <li key={stage.key} className={stage.at ? 'is-done' : ''}>
                          <span className="exam-record-detail__dot" aria-hidden="true" />
                          <div>
                            <strong>{stage.label}</strong>
                            <span>{formatDateTime(stage.at)}</span>
                            {stage.note && <em>{stage.note}</em>}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                </div>
              </details>
            </aside>
          </div>

          <details className="exam-record-detail__disclosure exam-record-detail__operations">
            <summary>
              <span>
                <strong>
                  <History size={15} aria-hidden="true" /> 操作记录
                </strong>
                <em>{loadingOperations ? '正在读取' : `${operations.length} 条记录`}</em>
              </span>
              <i aria-hidden="true" />
            </summary>
            <div className="exam-record-detail__disclosure-panel">
              {loadingOperations ? (
                <p className="exam-record-detail__hint">正在读取…</p>
              ) : operationsError ? (
                <p className="exam-record-detail__hint is-error">{operationsError}</p>
              ) : operations.length === 0 ? (
                <p className="exam-record-detail__hint">还没有操作记录。</p>
              ) : (
                <ul>
                  {operations.map((entry) => (
                    <li key={`${entry.action}-${entry.createdAt}-${entry.resultRecordId}`}>
                      <strong>
                        {EXAM_RECORD_ACTION_LABELS[entry.action as ExamRecordActionName] ??
                          EXTRA_OPERATION_LABELS[entry.action] ??
                          entry.action}
                      </strong>
                      <span>{formatDateTime(entry.createdAt)}</span>
                      <span>{entry.actorName || (entry.actorId == null ? '系统' : `#${entry.actorId}`)}</span>
                      {entry.fromStatus && entry.toStatus && entry.fromStatus !== entry.toStatus && (
                        <em>
                          {OPERATION_STATUS_LABELS[entry.fromStatus] ?? entry.fromStatus} →{' '}
                          {OPERATION_STATUS_LABELS[entry.toStatus] ?? entry.toStatus}
                        </em>
                      )}
                      <em>结果：{operationResult(entry)}</em>
                      {entry.reason && <em>{entry.reason}</em>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        </div>

        <footer className="exam-record-detail__actions">
          <div className="exam-record-detail__action-bar">
            <div className="exam-record-detail__selection">
              <span>{selectedSubject ? `${selectedSubject.status}科目` : '操作范围'}</span>
              <strong>{selectedSubject?.item.name ?? record.name}</strong>
            </div>
            <div className="exam-record-detail__buttons">
              {visibleActions.length === 0 && (
                <span className="exam-record-detail__hint">当前账号没有可执行的操作。</span>
              )}
              {actions.includes('extend') && extendUnavailable && (
                <span className="exam-record-detail__action-note">单科开考后可用快捷延长</span>
              )}
              <button
                className={`admin-btn admin-btn--ghost exam-record-detail__note-toggle${
                  reason.trim() ? ' has-note' : ''
                }`}
                type="button"
                aria-expanded={noteOpen}
                onClick={() => setNoteOpen((value) => !value)}
              >
                {reason.trim() ? '备注已填' : '备注'}
              </button>
              {visibleActions.map((action) => (
                <button
                  key={action}
                  className={`admin-btn ${
                    action === 'end'
                      ? 'admin-btn--danger'
                      : action === 'copy' || action === 'archive' || action === 'unarchive'
                        ? 'admin-btn--ghost'
                        : 'admin-btn--primary'
                  }`}
                  type="button"
                  aria-expanded={action === 'extend' ? extendOpen : undefined}
                  aria-controls={action === 'extend' ? 'exam-record-extend-panel' : undefined}
                  onClick={() => (action === 'extend' ? setExtendOpen((value) => !value) : void startAction(action))}
                  disabled={busyAction !== null || (action === 'extend' && extendUnavailable)}
                  title={action === 'extend' && extendUnavailable ? '仅当单科考试进行中时可快捷延长' : undefined}
                >
                  {busyAction === action
                    ? '处理中…'
                    : action === 'extend'
                      ? '快捷延长'
                      : EXAM_RECORD_ACTION_LABELS[action]}
                </button>
              ))}
            </div>
          </div>

          {noteOpen && (
            <label className="exam-record-detail__reason exam-record-detail__reveal">
              操作备注
              <input
                className="admin-input"
                value={reason}
                maxLength={200}
                onChange={(event) => setReason(event.target.value)}
                disabled={busyAction !== null}
                placeholder="可选，会写入操作记录"
                aria-label="操作备注"
                autoFocus
              />
            </label>
          )}

          {extendOpen && visibleActions.includes('extend') && (
            <div id="exam-record-extend-panel" className="exam-record-detail__extend exam-record-detail__reveal">
              <div className="exam-record-detail__extend-head">
                <div>
                  <strong>延长当前科目</strong>
                  <span>{currentSubject?.item.name} · 其他科目时间保持不变</span>
                </div>
                <button type="button" onClick={() => setExtendOpen(false)} aria-label="收起延长时间设置">
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              <label className="exam-record-detail__minutes">
                延长时间
                <input
                  className="admin-input"
                  type="number"
                  min="1"
                  max={MAX_EXTEND_MINUTES}
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                  disabled={busyAction !== null}
                  aria-label="延长分钟数"
                />
                分钟
              </label>
              <div className="exam-record-detail__extend-presets" aria-label="常用延长时长">
                {[5, 10, 15, 30].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={busyAction !== null}
                    className={Number(minutes) === preset ? 'is-active' : undefined}
                    onClick={() => setMinutes(String(preset))}
                  >
                    +{preset}
                  </button>
                ))}
                {effectiveEndAt != null && Number(minutes) > 0 && Number(minutes) <= MAX_EXTEND_MINUTES && (
                  <span>
                    {currentSubject
                      ? `${currentSubject.item.name}：${formatDateTime(currentSubject.endAt)} → ${formatDateTime(currentSubject.endAt + Math.floor(Number(minutes)) * 60_000)}；其他子考试不变`
                      : `整场考试：${formatDateTime(effectiveEndAt)} → ${formatDateTime(effectiveEndAt + Math.floor(Number(minutes)) * 60_000)}`}
                  </span>
                )}
              </div>
              <div className="exam-record-detail__extend-actions">
                <button className="admin-btn admin-btn--ghost" type="button" onClick={() => setExtendOpen(false)}>
                  取消
                </button>
                <button
                  className="admin-btn admin-btn--primary"
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void startAction('extend')}
                >
                  确认延长
                </button>
              </div>
            </div>
          )}

          {actionError && (
            <div className="exam-record-detail__feedback is-error">
              <span>{actionError}</span>
              {retry && (
                <button className="admin-btn admin-btn--ghost" type="button" onClick={() => void perform(retry)}>
                  重试
                </button>
              )}
            </div>
          )}
          {actionNotice && <div className="exam-record-detail__feedback">{actionNotice}</div>}
        </footer>
      </div>
      <ExamAnnouncementDialog
        open={announceOpen}
        onClose={() => setAnnounceOpen(false)}
        record={{
          id: record.id,
          name: record.name,
          targetGradeIds: record.targetGradeIds,
          targetClassIds: record.targetClassIds,
        }}
        gradeName={grades.find((grade) => grade.id === record.targetGradeIds[0])?.name}
      />
    </AdminModalPortal>
  );
}

/**
 * 考试详情抽屉。
 *
 * 数据由抽屉自己按 id 取（`resource=record`），不再要求调用方的列表里先有这一行：
 * 日程轴、班级网格里的行来自本地快照，可能属于「当前考试 / 历史考试」等别的板块，
 * 以前这些行点「详情」会因为查不到记录而静默不开抽屉。
 */
export default function ExamRecordDetailDrawer({
  recordId,
  record: seed,
  grades,
  classes,
  can,
  onClose,
  onChanged,
  onEdit,
  canEditRecord,
  onDiscard,
}: Props) {
  const [record, setRecord] = useState<ExamRecordListEntry | null>(seed ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadRecord = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRecord(await fetchExamRecord(recordId));
    } catch (caught) {
      setError(formatApiError(caught, '考试详情读取失败'));
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  // 调用方手里那行先顶上（列表刷新后会换新的），随后一律按 id 取服务端权威数据。
  useEffect(() => {
    setRecord(seed ?? null);
    void loadRecord();
  }, [loadRecord, seed]);

  if (record) {
    return (
      <ExamRecordDetailBody
        record={record}
        grades={grades}
        classes={classes}
        can={can}
        onClose={onClose}
        onChanged={onChanged}
        onEdit={onEdit}
        canEditRecord={canEditRecord}
        onDiscard={onDiscard}
        onRefreshRecord={loadRecord}
      />
    );
  }

  // 取不到记录时也要给一个能关掉的壳：以前这里直接不渲染，用户看到的是「点详情没反应」。
  return (
    <AdminModalPortal className="admin-modal-overlay" role="dialog" aria-modal="true" aria-label="考试详情">
      <div className="admin-modal admin-modal--wide exam-record-detail" onClick={(event) => event.stopPropagation()}>
        <header className="exam-record-detail__head">
          <div>
            <h2 className="admin-modal__title">考试详情</h2>
            <code className="exam-record-detail__id">{recordId}</code>
          </div>
          <div className="exam-record-detail__head-actions">
            <button className="admin-btn admin-btn--ghost" type="button" onClick={onClose} aria-label="关闭详情">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="exam-record-detail__body">
          {loading ? (
            <p className="exam-record-detail__hint">正在读取考试详情…</p>
          ) : (
            <div className="exam-record-detail__feedback is-error">
              <span>{error || '考试详情读取失败，请稍后重试。'}</span>
              <button className="admin-btn admin-btn--ghost" type="button" onClick={() => void loadRecord()}>
                重试
              </button>
            </div>
          )}
        </div>
      </div>
    </AdminModalPortal>
  );
}
