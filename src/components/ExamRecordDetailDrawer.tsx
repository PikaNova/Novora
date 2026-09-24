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
  fetchExamRecordOperations,
  newIdempotencyKey,
  requiresIdempotencyKey,
  runExamRecordAction,
  fetchExamRecordPrecheck,
  type ExamRecordListEntry,
  type ExamRecordOperationEntry,
} from '../services/examRecords';
import {
  availableExamRecordActions,
  EXAM_RECORD_ACTION_PERMISSIONS,
  EXAM_RECORD_TIME_CHANGE_ACTIONS,
  EXAM_RECORD_STATUS_LABELS,
  type ExamRecordActionName,
} from '../shared/examRecordContracts.js';
import { DEVICE_ONLINE_WINDOW_MS } from '../shared/deviceContracts.js';
import type { SchoolClass, SchoolGrade } from '../types/school';
import { adminSectionUrl } from '../hooks/admin/adminRoutes';

const DEFAULT_EXTEND_MINUTES = 15;
const MAX_EXTEND_MINUTES = 600;

/** 操作日志里会出现、但不属于「记录动作」的条目（例如快速考试转正式）。 */
const EXTRA_OPERATION_LABELS: Record<string, string> = {
  promote: '转为正式考试',
};

type Props = {
  record: ExamRecordListEntry;
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
  onEdit?: () => void;
  /** 草稿才有：删除这场草稿（由上层二次确认后按 id 从快照里移除）。 */
  onDiscard?: () => void;
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
  request_stop: {
    title: '申请停止考试',
    message: '停止会由系统判定后生效：到结束时间、教室端全部结束，或长时间没有任何在线设备。判定期间教室里照常显示。',
    tone: 'warning',
    label: '申请停止',
  },
  force_end: {
    title: '强制结束考试',
    message: '系统还没判定出结果时才会用到它：会立刻结束本场考试，之后只能归档或复制。',
    tone: 'danger',
    label: '强制结束',
  },
  pause: { title: '暂停考试', message: '暂停期间倒计时停止，教室大屏会显示暂停状态。', tone: 'warning', label: '暂停' },
  resume: { title: '继续考试', message: '恢复后剩余时间按累计暂停时长顺延。', tone: 'info', label: '继续' },
  extend: { title: '延长考试', message: '延长会同时顺延结束时间与倒计时。', tone: 'info', label: '延长' },
  end: {
    // 兼容旧数据路径：新流程里手动结束已经变成「申请停止」，这里只在极端情况兜底。
    title: '结束考试',
    message: '立即结束本场考试，之后只能归档或复制。',
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
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 分钟';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分钟`;
}

type TimelineStage = { key: string; label: string; at: number | null; note?: string };

/** 时间线按「创建 → 发布 → 开考 → 暂停/继续 → 结束 → 归档」构造，未发生的阶段保留占位。 */
function buildTimeline(record: ExamRecordListEntry, operations: ExamRecordOperationEntry[]): TimelineStage[] {
  const pauseStages: TimelineStage[] = operations
    .filter((entry) => entry.action === 'pause' || entry.action === 'resume')
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((entry) => ({
      key: `${entry.action}-${entry.createdAt}`,
      label: entry.action === 'pause' ? '暂停' : '继续',
      at: entry.createdAt,
      note: entry.actorName || undefined,
    }));
  return [
    { key: 'created', label: '创建', at: record.createdAt },
    { key: 'published', label: '发布', at: record.publishedAt },
    { key: 'started', label: '开考', at: record.actualStartAt },
    ...pauseStages,
    { key: 'ended', label: '结束', at: record.actualEndAt ?? record.endedAt },
    { key: 'archived', label: '归档', at: record.archivedAt },
  ];
}

export default function ExamRecordDetailDrawer({
  record,
  grades,
  classes,
  can,
  onClose,
  onChanged,
  onEdit,
  onDiscard,
}: Props) {
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
  const [reason, setReason] = useState('');
  const [devices, setDevices] = useState<DeviceBindingInfo[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [devicesError, setDevicesError] = useState('');

  const canReadDevices = can('device.read');

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
        if (active) setDevices(result.bindings);
      })
      .catch((caught) => {
        if (!active) return;
        setDevices([]);
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

  const timeline = useMemo(() => buildTimeline(record, operations), [operations, record]);
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

  // 设备状态只做「这场考试覆盖的教室设备在不在线」的汇总，不做任何控制类操作。
  const deviceSummary = useMemo(() => {
    const schoolWide = record.targetGradeIds.length === 0 && record.targetClassIds.length === 0;
    const inScope = devices.filter(
      (item) =>
        !item.revoked &&
        (schoolWide || record.targetGradeIds.includes(item.gradeId) || record.targetClassIds.includes(item.classId)),
    );
    const now = Date.now();
    const online = inScope.filter((item) => now - item.lastSeenAt <= DEVICE_ONLINE_WINDOW_MS).length;
    const coveredClassIds = new Set(inScope.map((item) => item.classId).filter(Boolean));
    const scopedClasses = classes.filter(
      (item) => schoolWide || record.targetClassIds.includes(item.id) || record.targetGradeIds.includes(item.gradeId),
    );
    return {
      devices: inScope,
      online,
      offline: inScope.length - online,
      unboundClasses: scopedClasses.filter((item) => !coveredClassIds.has(item.id)).length,
    };
  }, [classes, devices, record.targetClassIds, record.targetGradeIds]);

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
          ? `${confirm.message}本次延长 ${extendMinutes} 分钟，可随时再次延长。`
          : `${confirm.message}${publishWarning}`,
      tone: confirm.tone,
      confirmLabel: confirm.label,
    });
    if (!confirmed) return;
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
              {/* 状态徽标从「基本信息」里挪上来：宽屏两栏之后，它属于标题而不是某个字段。 */}
              <span className={`exam-records-status is-${record.displayStatus}`}>
                {EXAM_RECORD_STATUS_LABELS[record.displayStatus]}
              </span>
            </div>
            <code className="exam-record-detail__id">{record.id}</code>
          </div>
          <div className="exam-record-detail__head-actions">
            {/* T-286-03 一期：从这场考试直接给它的范围发公告（可选全校）。 */}
            {can('major.edit') && (
              <button className="admin-btn admin-btn--ghost" type="button" onClick={() => setAnnounceOpen(true)}>
                发送公告
              </button>
            )}
            {/* 公告管理页是发布/撤回的统一入口，详情页只做快捷跳转。 */}
            {can('major.read') && (
              <button
                className="admin-btn admin-btn--ghost"
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
              <button className="admin-btn admin-btn--danger" type="button" onClick={onDiscard}>
                删除草稿
              </button>
            )}
            {can('major.edit') && (
              <button
                className="admin-btn admin-btn--ghost"
                type="button"
                onClick={() => {
                  onClose();
                  if (onEdit) {
                    onEdit();
                    return;
                  }
                  navigate(adminSectionUrl({ tab: 'exam', view: 'editor' }));
                }}
              >
                编辑考试
              </button>
            )}
            <button className="admin-btn admin-btn--ghost" type="button" onClick={onClose} aria-label="关闭详情">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="exam-record-detail__body">
          <section className="exam-record-detail__facts" aria-label="基本信息">
            <h3>基本信息</h3>
            <dl>
              <div>
                <dt>适用范围</dt>
                <dd>{scopeLabel()}</dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd>{record.source === 'quick' ? '快速考试' : '正式考试'}</dd>
              </div>
              <div>
                <dt>科目数</dt>
                <dd>{record.itemCount}</dd>
              </div>
              <div>
                <dt>创建人</dt>
                <dd>{record.createdBy == null ? '系统' : `#${record.createdBy}`}</dd>
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
                  {record.startAt ? `${formatDateTime(record.startAt)} - ${formatDateTime(record.endAt)}` : '未设置'}
                  {/* P1-⑤：最近一次动时间的操作原文（含旧 → 新），避免时间悄悄变了没提示。 */}
                  {latestTimeChange && <em className="exam-record-detail__time-note">{latestTimeChange.reason}</em>}
                </dd>
              </div>
              <div>
                <dt>累计暂停</dt>
                <dd>
                  {formatDuration(record.pausedMs)}
                  {effectiveEndAt ? `（顺延至 ${formatDateTime(effectiveEndAt)}）` : ''}
                </dd>
              </div>
            </dl>
          </section>

          <section className="exam-record-detail__devices" aria-label="设备状态">
            <h3>设备状态</h3>
            {!canReadDevices ? (
              <p className="exam-record-detail__hint">当前账号没有查看设备的权限。</p>
            ) : devicesError ? (
              <p className="exam-record-detail__hint is-error">{devicesError}</p>
            ) : !devicesLoaded ? (
              <p className="exam-record-detail__hint">正在读取设备状态…</p>
            ) : (
              <>
                {deviceSummary.devices.length === 0 ? (
                  <p className="exam-record-detail__hint">这场考试范围内还没有绑定设备。</p>
                ) : (
                  <p className="exam-record-detail__device-summary">
                    <span>覆盖 {deviceSummary.devices.length} 台设备</span>
                    <span className={deviceSummary.online > 0 ? 'is-online' : undefined}>
                      在线 {deviceSummary.online}
                    </span>
                    <span>离线 {deviceSummary.offline}</span>
                    {deviceSummary.unboundClasses > 0 && (
                      <span className="is-warn">{deviceSummary.unboundClasses} 个班级未绑定设备</span>
                    )}
                  </p>
                )}
                {deviceSummary.devices.length > 0 && (
                  <ul>
                    {deviceSummary.devices.slice(0, 6).map((item) => {
                      const online = Date.now() - item.lastSeenAt <= DEVICE_ONLINE_WINDOW_MS;
                      return (
                        <li key={item.instanceId}>
                          <strong>{classLabel(item.gradeId, item.classId)}</strong>
                          <span className={online ? 'is-online' : 'is-offline'}>{online ? '在线' : '离线'}</span>
                          <em>
                            {item.currentExam
                              ? `当前显示：${item.currentExam}`
                              : `最后在线 ${formatDateTime(item.lastSeenAt)}`}
                          </em>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {deviceSummary.devices.length > 6 && (
                  <p className="exam-record-detail__hint">
                    还有 {deviceSummary.devices.length - 6} 台设备未列出，可在设备管理中查看。
                  </p>
                )}
              </>
            )}
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

          <section className="exam-record-detail__operations" aria-label="操作记录">
            <h3>
              <History size={15} aria-hidden="true" /> 操作记录
            </h3>
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
                        {entry.fromStatus} → {entry.toStatus}
                      </em>
                    )}
                    {entry.reason && <em>{entry.reason}</em>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="exam-record-detail__actions">
          {actions.includes('extend') && (
            <label className="exam-record-detail__minutes">
              延长
              <input
                className="admin-input"
                type="number"
                min="1"
                max={MAX_EXTEND_MINUTES}
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
                aria-label="延长分钟数"
              />
              分钟
            </label>
          )}
          <label className="exam-record-detail__reason">
            备注
            <input
              className="admin-input"
              value={reason}
              maxLength={200}
              onChange={(event) => setReason(event.target.value)}
              placeholder="可选，会写入操作记录"
              aria-label="操作备注"
            />
          </label>
          <div className="exam-record-detail__buttons">
            {actions.length === 0 && <span className="exam-record-detail__hint">当前账号没有可执行的操作。</span>}
            {actions.map((action) => (
              <button
                key={action}
                className={`admin-btn ${action === 'end' || action === 'archive' ? 'admin-btn--danger' : 'admin-btn--primary'}`}
                type="button"
                onClick={() => void startAction(action)}
                disabled={busyAction !== null}
              >
                {busyAction === action ? '处理中…' : EXAM_RECORD_ACTION_LABELS[action]}
              </button>
            ))}
          </div>
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
