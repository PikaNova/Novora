import React from 'react';
import AdminModalPortal from '../AdminModalPortal';
import SchoolAnnouncementCard from '../SchoolAnnouncementCard';
import {
  ANNOUNCEMENT_STYLE_LABELS,
  type AnnouncementLevel,
  type AnnouncementStyle,
} from '../../shared/examAnnouncementContracts.js';

export type SchoolAnnouncementDraftPreview = {
  title: string;
  body: string;
  level: AnnouncementLevel;
  style: AnnouncementStyle;
};

type Props = {
  draft: SchoolAnnouncementDraftPreview;
  /** 范围摘要（全校 / 年级 / 班级）。 */
  audience: string;
  /** 有效期文案（30 分钟 / 不过期 …）。 */
  expiryLabel: string;
  /** 投放方式文案（自动弹出 / 只进列表）。 */
  delivery: string;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * 发布前确认窗：先让管理员看到教室大屏上的真实排版，再决定发不发。
 * 预览用的是大屏同一个组件（`SchoolAnnouncementCard`），所以「确认窗里看到的」就是「大屏上显示的」。
 */
export default function SchoolAnnouncementPublishDialog({
  draft,
  audience,
  expiryLabel,
  delivery,
  busy,
  error,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <AdminModalPortal
      className="admin-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="发布前确认"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div className="admin-modal admin-modal--wide sann-publish" onClick={(event) => event.stopPropagation()}>
        <h2 className="admin-modal__title">发布前确认</h2>
        <p className="admin-modal__body">确认下面这份内容与投放范围；发出后教室大屏 1 分钟内更新。</p>
        {/* 宽屏两栏：左边信息、右边预览各自滚动；窄屏回落单列。 */}
        <div className="sann-publish__body">
          <dl className="sann-publish__facts">
            <div>
              <dt>样式</dt>
              <dd>{ANNOUNCEMENT_STYLE_LABELS[draft.style]}</dd>
            </div>
            <div>
              <dt>级别</dt>
              <dd>{draft.level === 'urgent' ? '紧急（置顶，不可关闭）' : '普通（可关闭）'}</dd>
            </div>
            <div>
              <dt>范围</dt>
              <dd>{audience}</dd>
            </div>
            <div>
              <dt>有效期</dt>
              <dd>{expiryLabel}</dd>
            </div>
            <div>
              <dt>投放方式</dt>
              <dd>{delivery}</dd>
            </div>
          </dl>
          <div className="sann-publish__preview">
            <SchoolAnnouncementCard item={draft} />
          </div>
        </div>
        {error && <div className="admin-error">{error}</div>}
        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--primary" type="button" disabled={busy} onClick={onConfirm}>
            {busy ? '发送中…' : '确认发送'}
          </button>
          <button className="admin-btn admin-btn--ghost" type="button" disabled={busy} onClick={onCancel}>
            返回修改
          </button>
        </div>
      </div>
    </AdminModalPortal>
  );
}
