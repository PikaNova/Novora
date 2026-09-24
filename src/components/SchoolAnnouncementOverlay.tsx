import React, { useEffect } from 'react';
import Mascot from './Mascot';
import SchoolAnnouncementCard from './SchoolAnnouncementCard';
import { formatDateTimeInZone } from '../utils/timeSource';
import type { SchoolExamAnnouncement } from '../services/examAnnouncements';
import '../styles/school-announcement-overlay.css';

type Props = {
  open: boolean;
  announcements: SchoolExamAnnouncement[];
  /** 大屏上的学校名（标题用，可空）。 */
  schoolName?: string;
  onClose: () => void;
};

/**
 * 学校公告窗口（教室大屏）。
 *
 * 与作者端「系统公告窗口」（`ExamAnnouncementOverlay`）分开：
 * 这一扇窗口更大、正文按学校选择的样式排版（标准卡片 / 大字海报 / 公告栏），
 * 并且紧急公告置顶且不可关闭——用户口径：学校紧急公告盖过作者端公告。
 */
export default function SchoolAnnouncementOverlay({ open, announcements, schoolName = '', onClose }: Props) {
  const hasUrgent = announcements.some((item) => item.level === 'urgent');
  const close = () => {
    if (hasUrgent) return;
    onClose();
  };
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !hasUrgent) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasUrgent, open, onClose]);

  if (!open) return null;
  return (
    <div className="sann-screen-overlay" role="dialog" aria-modal="true" aria-label="学校公告" onClick={close}>
      <section className="sann-screen-window" onClick={(event) => event.stopPropagation()}>
        <header className="sann-screen-window__head">
          <div>
            <h2 className="sann-screen-window__title">{schoolName ? `${schoolName} · 公告` : '学校公告'}</h2>
            <p className="sann-screen-window__lead">
              {hasUrgent
                ? '含紧急公告：需要等它过期或管理员撤回后才能关闭。'
                : `${announcements.length} 条公告 · 由学校管理端发布`}
            </p>
          </div>
          <button
            className="sann-screen-window__close"
            type="button"
            onClick={close}
            disabled={hasUrgent}
            aria-label="关闭公告"
          >
            ×
          </button>
        </header>
        <div className="sann-screen-window__body">
          {announcements.length === 0 ? (
            <div className="sann-screen-empty">
              <Mascot className="mascot-inline" size={40} alt="" />
              当前没有学校公告。
            </div>
          ) : (
            announcements.map((item) => (
              <SchoolAnnouncementCard key={item.id} item={item} meta={`${formatDateTimeInZone(item.createdAt)} 发布`} />
            ))
          )}
        </div>
      </section>
    </div>
  );
}
