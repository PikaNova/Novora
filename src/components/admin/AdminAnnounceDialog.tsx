// 后台公告查看弹窗。
import { Megaphone } from 'lucide-react';
import AdminModalPortal from '../AdminModalPortal';
import AnnouncementList from '../AnnouncementList';
import Mascot from '../Mascot';
import type { Announcement } from '../../services/announcements';
import type { BackdropProps } from './AdminConfirmDialogs';

export type AdminAnnounceDialogProps = {
  anns: Announcement[];
  annLoading: boolean;
  /** 公告拉取失败时的提示文案；为空表示最近一次拉取成功。 */
  annError?: string;
  formatTime: (value: number) => string;
  backdropProps: BackdropProps;
  setAnnounceOpen: (open: boolean) => void;
};

export function AdminAnnounceDialog({
  anns,
  annLoading,
  annError = '',
  formatTime,
  backdropProps,
  setAnnounceOpen,
}: AdminAnnounceDialogProps) {
  return (
    <AdminModalPortal className="admin-modal-overlay" {...backdropProps(() => setAnnounceOpen(false))}>
      <div className="admin-modal admin-modal--wide admin-announce" onClick={(e) => e.stopPropagation()}>
        <div className="admin-alerts__head">
          <h2 className="admin-modal__title" style={{ margin: 0 }}>
            <Megaphone size={19} />
            公告
          </h2>
          <button className="admin-btn admin-btn--ghost" onClick={() => setAnnounceOpen(false)}>
            关闭
          </button>
        </div>
        <p className="admin-alerts__lead">公告由作者端统一发布，内容以 Markdown 渲染；本页仅供查看。</p>
        {annLoading ? (
          <div className="admin-announce__empty">公告加载中…</div>
        ) : annError ? (
          <div className="admin-announce__empty">⚠️ {annError}</div>
        ) : anns.length === 0 ? (
          <div className="admin-announce__empty">
            <Mascot className="mascot-empty" size={48} alt="" />
            暂无公告。
          </div>
        ) : (
          <AnnouncementList announcements={anns} formatTime={formatTime} />
        )}
      </div>
    </AdminModalPortal>
  );
}
