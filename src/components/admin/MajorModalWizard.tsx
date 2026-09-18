// 大型考试新建/重命名向导弹窗（含 AI 导入引导）。状态与提交逻辑由 AdminPage 持有。
import type { HTMLAttributes } from 'react';
import AdminModalPortal from '../AdminModalPortal';
import AdminWizardSteps, { AdminWorkflowClose } from '../AdminWizardSteps';
import HelpTip from '../HelpTip';
import InlineSelect from '../InlineSelect';
import { fmtLocal } from '../../hooks/admin/adminPageUtils';
import { formatDateTimeInZone } from '../../utils/zonedTime';
import type { ExamItem } from '../../types';
import type { SchoolGrade } from '../../types/school';
import type { MajorModal } from '../../hooks/admin/useMajorScheduleActions';

export type BackdropProps = (
  onDismiss: () => void,
) => Pick<HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onClick'>;

export type MajorModalWizardProps = {
  majorModal: NonNullable<MajorModal>;
  setMajorModal: React.Dispatch<React.SetStateAction<MajorModal>>;
  majorModalStep: number;
  setMajorModalStep: React.Dispatch<React.SetStateAction<number>>;
  majorError: string;
  setMajorError: (message: string) => void;
  visibleGrades: SchoolGrade[];
  hasAllScope: boolean;
  backdropProps: BackdropProps;
  commitMajorModal: (onContinueToImport: () => void) => Promise<void> | void;
  setImportOpen: (open: boolean) => void;
  /** 第 2/3 步：当前草稿的科目与考试窗口。 */
  items: ExamItem[];
  windowStart: number | null;
  windowEnd: number | null;
  canManageItems: boolean;
  onToggleItem: (id: string, enabled: boolean) => void;
  onRemoveItem: (item: ExamItem) => void;
  onOpenBatchAdd: () => void;
  onOpenEditor: () => void;
  /** 第 1 步「创建并继续」：先把草稿写下来，再进入科目编辑。 */
  onCreateAndContinue: () => void;
  publishBusy: boolean;
  /** 第 3 步：完成（存为草稿）或保存并发布。 */
  onFinish: (publish: boolean) => void;
  /**
   * 关闭向导。由上层决定要不要对「还没填科目的草稿」追问保留 / 丢弃，
   * 所以这里不直接 setMajorModal(null)；没传时退回直接关闭。
   */
  onClose?: () => void;
};

export function MajorModalWizard({
  majorModal,
  setMajorModal,
  majorModalStep,
  setMajorModalStep,
  majorError,
  setMajorError,
  visibleGrades,
  hasAllScope,
  backdropProps,
  commitMajorModal,
  setImportOpen,
  items,
  windowStart,
  windowEnd,
  canManageItems,
  onToggleItem,
  onRemoveItem,
  onOpenBatchAdd,
  onOpenEditor,
  onCreateAndContinue,
  publishBusy,
  onFinish,
  onClose,
}: MajorModalWizardProps) {
  const closeModal = onClose ?? (() => setMajorModal(null));

  const isAddFlow = majorModal.mode === 'add' && majorModal.next !== 'import';
  const enabledItems = items.filter((item) => item.enabled);
  const timedItems = enabledItems.filter((item) => item.startTime && item.endTime);
  const missingTime = enabledItems.length - timedItems.length;
  const canPublish = enabledItems.length > 0 && missingTime === 0 && windowStart != null && windowEnd != null;

  return (
    <AdminModalPortal className="admin-modal-overlay" {...backdropProps(closeModal)}>
      <div className="admin-modal admin-modal--wide admin-modal--workflow" onClick={(e) => e.stopPropagation()}>
        <h2 className="admin-modal__title admin-workflow-head">
          {majorModal.next === 'import'
            ? '先填写考试标题'
            : majorModal.mode === 'add'
              ? '新建大型考试'
              : '大型考试设置'}
        </h2>
        <AdminWorkflowClose
          onClick={() => {
            closeModal();
            setMajorError('');
          }}
        />
        {majorError && <div className="admin-error">{majorError}</div>}
        <div className="admin-workflow-layout">
          <AdminWizardSteps
            active={majorModalStep}
            steps={
              isAddFlow
                ? [
                    { label: '考试名称', hint: '填写清晰的考试标题' },
                    { label: '适用范围', hint: '确认下发年级' },
                    { label: '科目与时间', hint: '安排各科场次' },
                    { label: '确认', hint: '检查后保存或发布' },
                  ]
                : [
                    { label: '考试名称', hint: '填写清晰的考试标题' },
                    { label: '适用范围', hint: '确认下发年级' },
                  ]
            }
            summary={
              <>
                <span>大型考试</span>
                <strong>{majorModal.name || '尚未命名'}</strong>
                <span>
                  {majorModal.targetGradeIds.length
                    ? visibleGrades.find((grade) => grade.id === majorModal.targetGradeIds[0])?.name || '指定年级'
                    : '全校统一'}
                </span>
              </>
            }
          />
          <div className="admin-workflow-content" key={majorModalStep}>
            {majorModalStep === 0 && (
              <div className="admin-workflow-pane">
                {majorModal.next === 'import' && (
                  <p className="admin-modal__body">
                    当前年级还没有大型考试。先填写标题，创建后将生成对应的 AI 识图提示词。
                  </p>
                )}
                <label className="admin-label">
                  考试名称
                  <input
                    className="admin-input"
                    autoFocus
                    value={majorModal.name}
                    onChange={(e) => setMajorModal((p) => p && { ...p, name: e.target.value })}
                    placeholder="如：2026年高考 / 高三一模"
                  />
                </label>
              </div>
            )}
            {majorModalStep === 1 && (
              <div className="admin-workflow-pane">
                <label className="admin-label">
                  <span className="with-help-tip">
                    适用范围
                    <HelpTip title="适用范围">默认归属当前年级；全校统一考试会出现在所有年级绑定设备上。</HelpTip>
                  </span>
                  <InlineSelect
                    className="admin-input"
                    value={majorModal.targetGradeIds.length ? majorModal.targetGradeIds[0] : 'all'}
                    onChange={(value) =>
                      setMajorModal((p) => p && { ...p, targetGradeIds: value === 'all' ? [] : [value] })
                    }
                    options={[
                      ...(hasAllScope ? [{ value: 'all', label: '全校统一' }] : []),
                      ...visibleGrades.map((grade) => ({ value: grade.id, label: grade.name })),
                    ]}
                  />
                </label>
                <div className="admin-workflow-review">
                  <span>
                    考试名称<strong>{majorModal.name}</strong>
                  </span>
                  <span>
                    显示范围
                    <strong>
                      {majorModal.targetGradeIds.length
                        ? visibleGrades.find((grade) => grade.id === majorModal.targetGradeIds[0])?.name || '指定年级'
                        : '全校统一'}
                    </strong>
                  </span>
                </div>
                <p className="admin-major-card__hint">
                  后台切换考试只改变编辑对象，不会覆盖大屏；客户端按绑定年级自动匹配。
                </p>
              </div>
            )}
            {majorModalStep === 2 && (
              <div className="admin-workflow-pane">
                <div className="major-wizard-actions">
                  <button className="admin-btn" type="button" disabled={!canManageItems} onClick={onOpenEditor}>
                    + 添加科目（打开编辑器）
                  </button>
                  <button className="admin-btn" type="button" onClick={onOpenBatchAdd} disabled={!canManageItems}>
                    批量添加分考试
                  </button>
                  <button
                    className="admin-btn"
                    type="button"
                    onClick={() => setImportOpen(true)}
                    disabled={!canManageItems}
                  >
                    AI 识图 / JSON 导入
                  </button>
                  <button className="admin-btn admin-btn--ghost" type="button" onClick={onOpenEditor}>
                    去编辑器逐项调整
                  </button>
                </div>
                {items.length === 0 ? (
                  <p className="admin-modal__body">
                    还没有科目。可以「批量添加分考试」，或到编辑器里用 AI 识图 / JSON 导入一次灌入整张表。
                  </p>
                ) : (
                  <ul className="major-wizard-items">
                    {items.map((item) => (
                      <li key={item.id}>
                        <strong>{item.name}</strong>
                        <span>
                          {item.startTime && item.endTime
                            ? `${fmtLocal(item.startTime)} - ${fmtLocal(item.endTime)}`
                            : '未设时间'}
                        </span>
                        <label className="major-wizard-items__toggle">
                          <input
                            type="checkbox"
                            checked={item.enabled}
                            disabled={!canManageItems}
                            onChange={(event) => onToggleItem(item.id, event.target.checked)}
                          />
                          启用
                        </label>
                        <button
                          className="admin-btn admin-btn--ghost"
                          type="button"
                          onClick={onOpenEditor}
                          title="在编辑器里改这场科目的时间"
                        >
                          改时间
                        </button>
                        <button
                          className="admin-btn admin-btn--danger"
                          type="button"
                          disabled={!canManageItems}
                          onClick={() => onRemoveItem(item)}
                        >
                          删除
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="admin-workflow-review">
                  <span>
                    启用科目<strong>{enabledItems.length} 科</strong>
                  </span>
                  <span>
                    考试窗口
                    <strong>
                      {windowStart != null && windowEnd != null
                        ? `${formatDateTimeInZone(windowStart)} → ${formatDateTimeInZone(windowEnd)}`
                        : '待科目时间'}
                    </strong>
                  </span>
                </div>
                {missingTime > 0 && (
                  <p className="admin-error">还有 {missingTime} 个启用科目没有完整时间，补齐后才能发布。</p>
                )}
              </div>
            )}
            {majorModalStep === 3 && (
              <div className="admin-workflow-pane">
                <ul className="major-wizard-checklist">
                  <li className={majorModal.name.trim() ? 'is-ok' : 'is-bad'}>
                    考试名称：{majorModal.name.trim() || '未填写'}
                  </li>
                  <li className={majorModal.targetGradeIds.length || hasAllScope ? 'is-ok' : 'is-bad'}>
                    适用范围：
                    {majorModal.targetGradeIds.length
                      ? visibleGrades.find((grade) => grade.id === majorModal.targetGradeIds[0])?.name || '指定年级'
                      : '全校统一'}
                  </li>
                  <li className={enabledItems.length > 0 ? 'is-ok' : 'is-bad'}>
                    启用科目：{enabledItems.length} 科{enabledItems.length === 0 ? '（至少 1 科）' : ''}
                  </li>
                  <li className={missingTime === 0 && enabledItems.length > 0 ? 'is-ok' : 'is-bad'}>
                    科目时间：
                    {enabledItems.length === 0
                      ? '无启用科目'
                      : missingTime === 0
                        ? '完整'
                        : `${missingTime} 科缺少起止时间`}
                  </li>
                  <li className={windowStart != null && windowEnd != null ? 'is-ok' : 'is-bad'}>
                    考试窗口：
                    {windowStart != null && windowEnd != null
                      ? `${formatDateTimeInZone(windowStart)} → ${formatDateTimeInZone(windowEnd)}`
                      : '无法计算（缺科目时间）'}
                  </li>
                </ul>
                <p className="admin-modal__body">
                  保存为草稿会留在「考试安排」的草稿区；保存并发布会立刻下发到对应范围的教室大屏。
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="admin-modal__actions">
          <button
            className="admin-btn"
            onClick={() => {
              if (majorModalStep) setMajorModalStep(0);
              else {
                closeModal();
                setMajorError('');
              }
            }}
            disabled={publishBusy}
          >
            {majorModalStep ? '上一步' : '取消'}
          </button>
          {majorModalStep === 0 ? (
            <button
              className="admin-btn admin-btn--primary admin-workflow-actions-spacer"
              onClick={() => {
                if (!majorModal.name.trim()) {
                  setMajorError('请输入大型考试名称');
                  return;
                }
                setMajorError('');
                setMajorModalStep(1);
              }}
            >
              下一步
            </button>
          ) : majorModalStep === 1 && isAddFlow ? (
            <button
              className="admin-btn admin-btn--primary admin-workflow-actions-spacer"
              onClick={onCreateAndContinue}
            >
              创建并继续
            </button>
          ) : majorModalStep === 1 ? (
            <button
              className="admin-btn admin-btn--primary admin-workflow-actions-spacer"
              onClick={() => commitMajorModal(() => setImportOpen(true))}
            >
              {majorModal.next === 'import' ? '创建并继续导入' : '确认保存'}
            </button>
          ) : majorModalStep === 2 ? (
            <button
              className="admin-btn admin-btn--primary admin-workflow-actions-spacer"
              onClick={() => setMajorModalStep(3)}
            >
              下一步
            </button>
          ) : (
            <>
              <button
                className="admin-btn admin-workflow-actions-spacer"
                type="button"
                disabled={publishBusy}
                onClick={() => onFinish(false)}
              >
                存为草稿
              </button>
              <button
                className="admin-btn admin-btn--primary"
                type="button"
                disabled={!canPublish || publishBusy}
                title={canPublish ? undefined : '补齐科目与时间后才能发布'}
                onClick={() => onFinish(true)}
              >
                {publishBusy ? '正在发布…' : '保存并发布'}
              </button>
            </>
          )}
        </div>
      </div>
    </AdminModalPortal>
  );
}
