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

const DEFAULT_EXTEND_MINUTES = 15;
const MAX_EXTEND_MINUTES = 600;

/** 操作日志里会出现、但不属于「记录动作」的条目（例如快速考试转正式）。 */
const EXTRA_OPERATION_LABELS: Record<string, string> = {
  promote: '转为正式考试',
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
  const [reason, setReason] = useState('');
  const [devices, setDevices] = useState<DeviceBindingInfo[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [devicesError, setDevicesError] = useState('');
  const [devicesTruncated, setDevicesTruncated] = useState(false);
  const [deviceFilter, setDeviceFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [devicesExpanded, setDevicesExpanded] = useState(false);
  const [unboundOpen, setUnboundOpen] = useState(false);

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
              <button className="admin-btn admin-btn--danger" type="button" onClick={() => onDiscard(record)}>
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
                    onEdit(record);
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
                  <>
                    {/* chip 兼筛选器：点「离线 8」就只看离线那批，排查时最常用。 */}
                    <p className="exam-record-detail__device-summary">
                      <button
                        type="button"
                        className={deviceChipClass(null, deviceFilter === 'all')}
                        aria-pressed={deviceFilter === 'all'}
                        onClick={() => setDeviceFilter('all')}
                      >
                        覆盖 {deviceSummary.devices.length} 台设备
                      </button>
                      <button
                        type="button"
                        className={deviceChipClass(
                          deviceSummary.online > 0 ? 'online' : null,
                          deviceFilter === 'online',
                        )}
                        aria-pressed={deviceFilter === 'online'}
                        onClick={() => setDeviceFilter((value) => (value === 'online' ? 'all' : 'online'))}
                      >
                        在线 {deviceSummary.online}
                      </button>
                      <button
                        type="button"
                        className={deviceChipClass(null, deviceFilter === 'offline')}
                        aria-pressed={deviceFilter === 'offline'}
                        onClick={() => setDeviceFilter((value) => (value === 'offline' ? 'all' : 'offline'))}
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
                          {deviceSummary.unboundClasses} 个班级未绑定设备
                        </button>
                      )}
                    </p>
                    {unboundOpen && deviceSummary.unboundClassNames.length > 0 && (
                      <p className="exam-record-detail__hint">
                        未绑定设备：{deviceSummary.unboundClassNames.join('、')}
                      </p>
                    )}
                  </>
                )}
                {filteredDevices.length > 0 && (
                  <ul className={devicesExpanded && filteredDevices.length > 6 ? 'is-scroll' : undefined}>
                    {visibleDevices.map((item) => {
                      const online = isDeviceOnline(item, Date.now());
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
                {deviceSummary.devices.length > 0 && filteredDevices.length === 0 && (
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
