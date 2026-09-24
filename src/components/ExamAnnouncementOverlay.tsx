import React, { useEffect } from 'react';
import type { Announcement } from '../services/announcements';
import type { SchoolExamAnnouncement } from '../services/examAnnouncements';
import AnnouncementList from './AnnouncementList';
import { Megaphone } from 'lucide-react';
import Mascot from './Mascot';
import '../styles/exam-announcement-overlay.css';

type Props = {
  open: boolean;
  announcements: Announcement[];
  loading: boolean;
  onClose: () => void;
  /** 学校侧考试公告（T-286-03）：优先展示；里面有 urgent 时不可关闭。 */
  schoolAnnouncements?: SchoolExamAnnouncement[];
};

function formatUpdatedAt(value: number): string {
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

/** 考试大屏公告弹窗：沿用设置页公告的 Markdown 卡片阅读方式。 */
export default function ExamAnnouncementOverlay({
  open,
  announcements,
  loading,
  onClose,
  schoolAnnouncements = [],
}: Props) {
  // 紧急公告置顶且不可关闭：用户口径「学校侧紧急公告盖过作者端全局公告」。
  const hasUrgent = schoolAnnouncements.some((item) => item.level === 'urgent');
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
    <div className="eann-overlay" role="dialog" aria-modal="true" aria-label="公告" onClick={close}>
      <section className="eann-window" onClick={(event) => event.stopPropagation()}>
        <header className="eann-window__head">
          <div>
            <h2 className="eann-window__title">
              <Megaphone aria-hidden="true" />
              系统公告
            </h2>
            <p className="eann-window__lead">
              {schoolAnnouncements.length
                ? '学校公告优先展示；紧急公告需要等它过期后才能关闭。'
                : '公告由作者端统一发布，内容以 Markdown 渲染。'}
            </p>
          </div>
          <button className="eann-window__close" onClick={close} aria-label="关闭公告" disabled={hasUrgent}>
            ×
          </button>
        </header>
        <div className="eann-window__body">
          {schoolAnnouncements.length > 0 && (
            <ul className="eann-school">
              {schoolAnnouncements.map((item) => (
                <li key={item.id} className={item.level === 'urgent' ? 'is-urgent' : undefined}>
                  <header>
                    <strong>{item.title || '学校公告'}</strong>
                    <em>{item.level === 'urgent' ? '紧急' : '学校公告'}</em>
                  </header>
                  <p>{item.body}</p>
                  <small>{formatUpdatedAt(item.createdAt)}</small>
                </li>
              ))}
            </ul>
          )}
          {loading ? (
            <div className="eann-empty">公告加载中…</div>
          ) : announcements.length === 0 ? (
            <div className="eann-empty">
              <Mascot className="mascot-inline" size={32} alt="" />
              暂无公告。
            </div>
          ) : (
            <AnnouncementList announcements={announcements} formatTime={formatUpdatedAt} />
          )}
        </div>
      </section>
    </div>
  );
}
