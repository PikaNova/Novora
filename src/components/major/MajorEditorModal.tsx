import { useEffect } from 'react';
import type { ReactNode } from 'react';
import AdminModalPortal from '../AdminModalPortal';
import { AdminWorkflowClose } from '../AdminWizardSteps';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';
import { hasOpenAppDialog } from '../../services/appDialog';

/**
 * 「分考试编辑器」的弹窗形态。
 *
 * 面板本体（`MajorTabPanel`）一行不改，整页形态（深链 `/admin/exam/editor`）也保留；
 * 这个壳只负责尺寸、两栏各自滚动与关闭。考试中心的行、日程轴的行、当前考试面板、向导第 2 步
 * 都用它把同一份面板叠在当前视图上——关掉就回到原处，不再换页，筛选与滚动位置自然保留。
 */
export default function MajorEditorModal({
  title,
  hint,
  nestedModalOpen,
  onClose,
  children,
}: {
  title: string;
  hint?: string;
  /**
   * 弹窗内部还会再开批量添加 / AI 导入 / 时间选择器 / 打印预览 / 确认框。
   * 它们开着时 Esc 与点遮罩都不能关这一层，否则用户会一次关掉两层。
   */
  nestedModalOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const backdropProps = useBackdropDismiss();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      // 只关最上面那一层：弹窗内部的子弹窗、或确认框开着时，Esc 交给它们处理。
      if (event.key !== 'Escape' || nestedModalOpen || hasOpenAppDialog()) return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [nestedModalOpen, onClose]);

  return (
    <AdminModalPortal className="admin-modal-overlay admin-modal-overlay--editor" {...backdropProps(onClose)}>
      <div className="admin-modal admin-modal--editor" onClick={(event) => event.stopPropagation()}>
        <div className="admin-editor-modal__head">
          <div className="admin-editor-modal__title">
            <strong>{title}</strong>
            {hint && <small>{hint}</small>}
          </div>
          <AdminWorkflowClose onClick={onClose} label="关闭编辑器" />
        </div>
        <div className="admin-editor-modal__body">{children}</div>
      </div>
    </AdminModalPortal>
  );
}
