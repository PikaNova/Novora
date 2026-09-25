import React from 'react';
import Mascot from '../Mascot';
import InlineSelect from '../InlineSelect';
import SubjectIcon from '../SubjectIcon';
import { AlertTriangle, CalendarDays, CircleHelp } from 'lucide-react';
import { COMMON_EXAM_SUBJECTS } from '../../data/subjects';
import { duration, fmtLocal, phase } from '../../hooks/admin/adminPageUtils';
import { getQuickMajorDisplayStatus } from '../../utils/majorDisplayStatus';
import type { ExamItem, MajorExam } from '../../types';
import type { SchoolClass, SchoolGrade } from '../../types/school';
import type { EditItem } from '../../hooks/admin/useExamItemActions';
import type { MajorModal } from '../../hooks/admin/useMajorScheduleActions';

export const CUSTOM_SUBJECT_VALUE = '__custom_subject__';

export const STATUS = {
  waiting: { label: '待考', color: '#3498db', bg: 'rgba(52,152,219,.15)' },
  ongoing: { label: '进行中', color: '#27ae60', bg: 'rgba(39,174,96,.15)' },
  ended: { label: '已结束', color: '#6c757d', bg: 'rgba(108,117,125,.15)' },
};

export interface MajorTabPanelProps {
  grades: SchoolGrade[];
  selectedGradeId: string;
  orderedScopedMajors: MajorExam[];
  activeMajor: MajorExam | null | undefined;
  items: ExamItem[];
  can: (permission: string) => boolean;
  isOwnQuickTemporaryMajor: (major: MajorExam) => boolean;
  setMajorModal: React.Dispatch<React.SetStateAction<MajorModal | null>>;
  setMajorError: (message: string) => void;
  hasScopedMajor: boolean;
  canDeleteActiveMajor: boolean;
  majors: MajorExam[];
  setDeleteMajorOpen: (open: boolean) => void;
  activeMajorTrackSubjects: ExamItem[];
  subjectTrackModeEnabled: boolean;
  activeMajorTrackScopedCount: number;
  activeMajorUnsetTrackClassCount: number;
  quickScopedMajors: MajorExam[];
  adminNow: number;
  visibleClasses: SchoolClass[];
  canEndQuickTemporaryMajorInScope: (major: MajorExam) => boolean;
  extendQuickMajor: (major: MajorExam) => void;
  endQuickMajor: (major: MajorExam) => void;
  promoteQuickMajor: (major: MajorExam) => void;
  setQuickMajorDeleteTarget: (major: MajorExam | null) => void;
  canEditActiveMajor: boolean;
  editing: EditItem | null;
  editError: string;
  customSubjectActive: boolean;
  setCustomSubjectActive: (active: boolean) => void;
  setEditing: React.Dispatch<React.SetStateAction<EditItem | null>>;
  setEditError: (message: string) => void;
  majorTimeFlowAnchorRef: React.Ref<HTMLButtonElement>;
  openMajorStartTimeFlow: () => void;
  isLongEdit: boolean;
  longDurationConfirmed: boolean;
  setLongDurationConfirmed: (confirmed: boolean) => void;
  commitEdit: () => void | Promise<void>;
  setMajorTimeFlowOpen: (open: boolean) => void;
  setMajorTimeFlowInitialEnd: (value: string) => void;
  setMajorBatchAddOpen: (open: boolean) => void;
  majorConflictLabels: string[];
  selectedItemIds: Set<string>;
  collapsedList: boolean;
  setDeleteSelectedOpen: (open: boolean) => void;
  openMajorImport: () => void;
  setMajorPrintOpen: (open: boolean) => void;
  setCollapsedList: React.Dispatch<React.SetStateAction<boolean>>;
  lastDeletedExam: { item: ExamItem } | null;
  restoreExam: () => void;
  majorConflictItemKeys: Set<string>;
  setSelectedItemIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setExamEnabled: (id: string, enabled: boolean) => void;
  setDeleteTarget: (item: ExamItem | null) => void;
}

export default function MajorTabPanel(props: MajorTabPanelProps) {
  const {
    grades,
    selectedGradeId,
    orderedScopedMajors,
    activeMajor,
    items,
    can,
    isOwnQuickTemporaryMajor,
    setMajorModal,
    setMajorError,
    hasScopedMajor,
    canDeleteActiveMajor,
    majors,
    setDeleteMajorOpen,
    activeMajorTrackSubjects,
    subjectTrackModeEnabled,
    activeMajorTrackScopedCount,
    activeMajorUnsetTrackClassCount,
    quickScopedMajors,
    adminNow,
    visibleClasses,
    canEndQuickTemporaryMajorInScope,
    extendQuickMajor,
    endQuickMajor,
    promoteQuickMajor,
    setQuickMajorDeleteTarget,
    canEditActiveMajor,
    editing,
    editError,
    customSubjectActive,
    setCustomSubjectActive,
    setEditing,
    setEditError,
    majorTimeFlowAnchorRef,
    openMajorStartTimeFlow,
    isLongEdit,
    longDurationConfirmed,
    setLongDurationConfirmed,
    commitEdit,
    setMajorTimeFlowOpen,
    setMajorTimeFlowInitialEnd,
    setMajorBatchAddOpen,
    majorConflictLabels,
    selectedItemIds,
    collapsedList,
    setDeleteSelectedOpen,
    openMajorImport,
    setMajorPrintOpen,
    setCollapsedList,
    lastDeletedExam,
    restoreExam,
    majorConflictItemKeys,
    setSelectedItemIds,
    setExamEnabled,
    setDeleteTarget,
  } = props;
  return (
    <>
      <aside className="admin-sidebar">
        {/* 大型考试：添加 / 切换 / 重命名 / 删除 */}
        <div className="admin-major-card">
          <div className="admin-major-card__head">
            <label className="admin-label" style={{ opacity: 0.9 }}>
              {grades.find((grade) => grade.id === selectedGradeId)?.name || '当前年级'} · 大型考试
            </label>
            <span className="admin-major-card__count">共 {orderedScopedMajors.length} 场</span>
          </div>
          <div className="admin-major-card__active">
            {orderedScopedMajors.length === 0 && <Mascot className="admin-major-card__mascot" size={34} alt="" />}
            <span className="admin-major-card__active-name" title={activeMajor?.name}>
              {activeMajor?.name || '未命名考试'}
            </span>
            <span className="admin-major-card__active-meta">
              {items.length} 个分考试 · {items.filter((i) => i.enabled).length} 个启用
            </span>
          </div>
          {/*
           * 这里不再提供「切换考试 / 快速发布 / 新建大型考试」三个入口：
           * 编辑器现在只服务「编辑这一场考试的科目与时间」——从考试中心列表或新建向导进来，
           * 改完回到列表。切考试、快速发布、新建都从考试中心的「创建考试」菜单走，
           * 免得在这条流程里点到别的考试上去。
           */}
          <div className="admin-major-card__btns">
            {hasScopedMajor && can('major.edit') && (
              <button
                className="admin-btn"
                onClick={() => {
                  setMajorModal({
                    mode: 'rename',
                    name: activeMajor?.name ?? '',
                    targetGradeIds: activeMajor?.targetGradeIds ?? [],
                  });
                  setMajorError('');
                }}
                disabled={activeMajor?.archivedAt != null}
                title={activeMajor?.archivedAt != null ? '已归档的考试需要先取消归档才能修改' : undefined}
              >
                设置
              </button>
            )}
            {hasScopedMajor && canDeleteActiveMajor && (
              <button
                className="admin-btn admin-btn--danger"
                onClick={() => setDeleteMajorOpen(true)}
                disabled={majors.length <= 1 || activeMajor?.archivedAt != null}
                title={
                  // 禁用时要说清原因：以前只剩一场时按钮变灰但没有任何说明，看着像"删不掉"。
                  majors.length <= 1
                    ? '至少要保留一场大型考试：先新建一场，再删这一场'
                    : activeMajor?.archivedAt != null
                      ? '已归档的考试需要先取消归档才能删除'
                      : undefined
                }
              >
                删除
              </button>
            )}
          </div>
          <p className="admin-major-card__hint">
            切换年级只改变后台管理内容；大屏始终按设备绑定班级所属年级自动匹配适用考试。
          </p>
          {activeMajor?.archivedAt != null && (
            <div className="admin-warning-banner">
              <span>
                <strong>已归档</strong>
                这场考试是只读历史，不能修改或删除。需要调整请先到「考试中心」取消归档。
              </span>
            </div>
          )}
          {activeMajorTrackSubjects.length > 0 && (
            <div className="admin-warning-banner admin-warning-banner--structured">
              {subjectTrackModeEnabled ? (
                <>
                  <span>
                    <strong>规则</strong>语数外全班显示，选考科目按班级选科显示。
                  </span>
                  <span>
                    <strong>进度</strong>已设置 {activeMajorTrackScopedCount}/{activeMajorTrackSubjects.length}{' '}
                    个选考科目，旧数据自动兜底过滤。
                  </span>
                  {activeMajorUnsetTrackClassCount > 0 && (
                    <span>
                      <strong>未分科</strong>
                      {activeMajorUnsetTrackClassCount} 个班级读取全部科目。
                    </span>
                  )}
                </>
              ) : (
                <span>
                  <strong>分科关闭</strong>所有分考试按考试范围直接下放，不按班级选科过滤。
                </span>
              )}
            </div>
          )}
        </div>

        {quickScopedMajors.length > 0 && (
          <section className="quick-major-running">
            <div className="quick-major-running__head">
              <strong>临时统一考试</strong>
              <span>{quickScopedMajors.length} 场</span>
            </div>
            {quickScopedMajors.map((major) => {
              const item = major.items.find((value) => value.enabled);
              const running =
                item && new Date(item.startTime).getTime() <= adminNow && new Date(item.endTime).getTime() > adminNow;
              const displayStatus = getQuickMajorDisplayStatus(major, orderedScopedMajors, adminNow, visibleClasses);
              // 已归档即只读：延长 / 结束 / 转正式 / 删除全部按只读处理（服务端同样会冻结）。
              const quickMajorReadOnly = major.archivedAt != null;
              const canManageQuickMajor =
                !quickMajorReadOnly &&
                (can('major.edit') || (can('major.quick_create') && isOwnQuickTemporaryMajor(major)));
              const canEndQuickMajor =
                !quickMajorReadOnly &&
                (can('major.edit') || (can('major.quick_create') && canEndQuickTemporaryMajorInScope(major)));
              const canDeleteQuickMajor =
                !quickMajorReadOnly &&
                (can('major.delete') || (can('major.quick_create') && isOwnQuickTemporaryMajor(major)));
              return (
                <article key={major.id}>
                  <div>
                    <strong>{major.name}</strong>
                    <small>
                      {item ? `${item.name} · ${fmtLocal(item.startTime)} - ${fmtLocal(item.endTime)}` : '已结束'}
                      {major.priorityOverSchedule ? ' · 优先覆盖' : ''}
                    </small>
                  </div>
                  <span className={running ? 'is-running' : ''}>{running ? '进行中' : '待开始'}</span>
                  {displayStatus && (
                    <div className={`quick-major-running__display is-${displayStatus.tone}`}>
                      <strong>{displayStatus.label}</strong>
                      <span>{displayStatus.detail}</span>
                    </div>
                  )}
                  {(canManageQuickMajor || canEndQuickMajor || canDeleteQuickMajor) && (
                    <div className="quick-major-running__actions">
                      {canManageQuickMajor && (
                        <>
                          <button className="admin-item-btn" onClick={() => extendQuickMajor(major)}>
                            延长 5 分钟
                          </button>
                          <button
                            className="admin-item-btn admin-item-btn--delete"
                            onClick={() => endQuickMajor(major)}
                          >
                            提前结束
                          </button>
                        </>
                      )}
                      {!canManageQuickMajor && canEndQuickMajor && (
                        <button className="admin-item-btn admin-item-btn--delete" onClick={() => endQuickMajor(major)}>
                          提前结束
                        </button>
                      )}
                      {can('major.edit') && (
                        <button className="admin-item-btn" onClick={() => promoteQuickMajor(major)}>
                          转正式
                        </button>
                      )}
                      {canDeleteQuickMajor && (
                        <button
                          className="admin-item-btn admin-item-btn--delete"
                          onClick={() => setQuickMajorDeleteTarget(major)}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        )}

        {hasScopedMajor &&
          canEditActiveMajor &&
          (editing ? (
            <div className="admin-form-card">
              <h2 className="admin-form-card__title">{editing.id ? '编辑分考试' : '添加分考试'}</h2>
              {editError && <div className="admin-error">{editError}</div>}
              <div className="admin-form">
                <label className="admin-label">
                  科目名称
                  <InlineSelect
                    className="admin-major-subject-select"
                    ariaLabel="选择考试科目"
                    value={
                      customSubjectActive || (editing.name && !COMMON_EXAM_SUBJECTS.includes(editing.name))
                        ? CUSTOM_SUBJECT_VALUE
                        : editing.name
                    }
                    placeholder="选择常用科目"
                    options={[
                      { value: '', label: '选择常用科目' },
                      ...COMMON_EXAM_SUBJECTS.map((subject) => ({
                        value: subject,
                        label: (
                          <>
                            <SubjectIcon subject={subject} size={16} />
                            {subject}
                          </>
                        ),
                      })),
                      {
                        value: CUSTOM_SUBJECT_VALUE,
                        label: (
                          <>
                            <SubjectIcon subject="其他" size={16} />
                            其他 / 自定义
                          </>
                        ),
                      },
                    ]}
                    onChange={(value) => {
                      if (value === CUSTOM_SUBJECT_VALUE) {
                        setCustomSubjectActive(true);
                        return;
                      }
                      setCustomSubjectActive(false);
                      setEditing((p) => p && { ...p, name: value });
                    }}
                  />
                  {(customSubjectActive || (editing.name && !COMMON_EXAM_SUBJECTS.includes(editing.name))) && (
                    <input
                      className="admin-input"
                      value={editing.name}
                      onChange={(e) => setEditing((p) => p && { ...p, name: e.target.value })}
                      placeholder="填写自定义科目名称"
                      maxLength={40}
                      autoFocus
                    />
                  )}
                </label>
                <div className="admin-major-endtime admin-major-time-setting">
                  <span>时间设置</span>
                  <button
                    type="button"
                    className="admin-major-endtime__trigger"
                    ref={majorTimeFlowAnchorRef}
                    onClick={openMajorStartTimeFlow}
                  >
                    <strong>
                      {editing.startTime && editing.endTime
                        ? `${fmtLocal(editing.startTime)} - ${fmtLocal(editing.endTime)}`
                        : '设置考试时间'}
                    </strong>
                    <small>一次设置开始日期、结束日期、时分和常用时长</small>
                  </button>
                </div>
                {isLongEdit && (
                  <label className="admin-long-duration">
                    <input
                      type="checkbox"
                      checked={longDurationConfirmed}
                      onChange={(e) => setLongDurationConfirmed(e.target.checked)}
                    />
                    我确认这是超过 6 小时的跨天或特殊考试安排
                  </label>
                )}
                <label className="admin-toggle-label">
                  <input
                    type="checkbox"
                    checked={editing.enabled}
                    onChange={(e) => setEditing((p) => p && { ...p, enabled: e.target.checked })}
                  />
                  启用此科目
                </label>
                <div className="admin-form-actions">
                  <button className="admin-btn admin-btn--primary" onClick={() => void commitEdit()}>
                    确认并保存
                  </button>
                  <button
                    className="admin-btn admin-btn--ghost"
                    onClick={() => {
                      setMajorTimeFlowOpen(false);
                      setEditing(null);
                      setCustomSubjectActive(false);
                      setEditError('');
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="admin-major-add-actions">
              <button
                className="admin-btn admin-btn--primary"
                onClick={() => {
                  setLongDurationConfirmed(false);
                  setCustomSubjectActive(false);
                  setMajorTimeFlowOpen(false);
                  setMajorTimeFlowInitialEnd('');
                  setEditing({
                    name: '',
                    startTime: '',
                    endTime: '',
                    enabled: true,
                  });
                }}
              >
                + 添加分考试
              </button>
              <button className="admin-btn" onClick={() => setMajorBatchAddOpen(true)}>
                批量添加分考试
              </button>
            </div>
          ))}
        <div className="admin-tips">
          <p className="admin-tips__title">
            <CircleHelp size={16} />
            使用说明
          </p>
          <ul>
            <li>每次修改会自动保存并同步到云（Neon）</li>
            <li>离线时仍可编辑，数据先存本地，联网后自动回推</li>
            <li>不同大型考试各自拥有独立的分考试列表</li>
            <li>大屏每 30 秒自动拉取最新数据</li>
          </ul>
        </div>
      </aside>
      <main className="admin-main">
        {majorConflictLabels.length > 0 && (
          <div className="admin-major-conflict" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <div>
              <strong>检测到 {new Set(majorConflictLabels).size} 组大型考试时间冲突</strong>
              <span>{[...new Set(majorConflictLabels)].join('、')}</span>
            </div>
          </div>
        )}
        <div className="admin-list-header">
          <h2 className="admin-list-title">{activeMajor?.name ?? '未命名考试'} · 考试安排</h2>
          <span className="admin-list-count">{items.length} 项</span>
          {selectedItemIds.size > 0 && canDeleteActiveMajor && (
            <button className="admin-btn admin-btn--danger" onClick={() => setDeleteSelectedOpen(true)}>
              批量删除（{selectedItemIds.size}）
            </button>
          )}
          {can('major.import') && (
            <button className="admin-btn" onClick={() => openMajorImport()}>
              AI智能导入考试
            </button>
          )}
          {items.length > 0 && (
            <>
              <button className="admin-btn" onClick={() => setMajorPrintOpen(true)}>
                预览与导出 PDF
              </button>
              <button
                className="admin-btn admin-btn--ghost admin-list-collapse"
                onClick={() => setCollapsedList((v) => !v)}
                aria-expanded={!collapsedList}
              >
                {collapsedList ? '展开列表' : '折叠列表'}
              </button>
            </>
          )}
        </div>
        {lastDeletedExam && (
          <div className="admin-undo">
            <span>已删除「{lastDeletedExam.item.name}」</span>
            <button className="admin-btn admin-btn--ghost" onClick={restoreExam}>
              撤销删除
            </button>
          </div>
        )}
        {items.length === 0 ? (
          <div className="admin-empty">
            <Mascot className="mascot-empty" size={64} alt="" />
            <div className="admin-empty__icon">
              <CalendarDays />
            </div>
            <p>当前大型考试暂无分考试，点击左侧“添加分考试”开始</p>
          </div>
        ) : collapsedList ? (
          <div className="admin-collapsed-hint">列表已折叠（共 {items.length} 项），点击“展开列表”查看</div>
        ) : (
          <ul className="admin-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {items.map((item, index) => {
              const status = STATUS[phase(item)];
              return (
                <li
                  className={`admin-item${canDeleteActiveMajor ? ' admin-item--selectable' : ''}${!item.enabled ? ' admin-item--disabled' : ''}${activeMajor && majorConflictItemKeys.has(activeMajor.id + ':' + item.id) ? ' admin-item--conflict' : ''}`}
                  key={item.id}
                >
                  {canDeleteActiveMajor && (
                    <label className="admin-item__select" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedItemIds.has(item.id)}
                        onChange={(e) => {
                          setSelectedItemIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          });
                        }}
                        aria-label={`选择「${item.name}」`}
                      />
                    </label>
                  )}
                  <div className="admin-item__order">
                    <span className="admin-item__order-num">#{index + 1}</span>
                  </div>
                  <div className="admin-item__info">
                    <div className="admin-item__name-row">
                      <span className="admin-item__name">
                        <SubjectIcon subject={item.name} size={16} />
                        {item.name}
                      </span>
                      <span
                        className="admin-item__status"
                        style={{
                          color: status.color,
                          background: status.bg,
                        }}
                      >
                        {status.label}
                      </span>
                      {!item.enabled && (
                        <span
                          className="admin-item__status"
                          style={{
                            color: '#6c757d',
                            background: 'rgba(108,117,125,.1)',
                          }}
                        >
                          已禁用
                        </span>
                      )}
                      {activeMajor && majorConflictItemKeys.has(activeMajor.id + ':' + item.id) && (
                        <span className="admin-item__conflict-badge">时间冲突</span>
                      )}
                    </div>
                    <div className="admin-item__times">
                      <span>{fmtLocal(item.startTime)}</span>
                      <span className="admin-item__times-sep">–</span>
                      <span>{fmtLocal(item.endTime)}</span>
                      <span className="admin-item__duration">{duration(item.startTime, item.endTime)}</span>
                    </div>
                  </div>
                  {canEditActiveMajor && (
                    <div className="admin-item__actions">
                      <button
                        type="button"
                        className={`admin-item-btn admin-item-btn--toggle ${item.enabled ? 'admin-item-btn--disable' : 'admin-item-btn--enable'}`}
                        title={item.enabled ? '停用后不会出现在首页、大屏或提醒中' : '启用后会参与首页、大屏和提醒计算'}
                        aria-label={`${item.enabled ? '停用' : '启用'}${item.name}`}
                        onClick={() => setExamEnabled(item.id, !item.enabled)}
                      >
                        {item.enabled ? '停用' : '启用'}
                      </button>
                      <button
                        className="admin-item-btn"
                        onClick={() => {
                          setLongDurationConfirmed(false);
                          setCustomSubjectActive(false);
                          setEditing({ ...item });
                        }}
                      >
                        编辑
                      </button>
                      {canDeleteActiveMajor && (
                        <button className="admin-item-btn admin-item-btn--delete" onClick={() => setDeleteTarget(item)}>
                          删除
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
