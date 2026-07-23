import React, { useEffect } from 'react';
import type { Announcement } from '../services/announcements';
import AnnouncementList from './AnnouncementList';
import '../styles/exam-announcement-overlay.css';

type Props = {
  open: boolean;
  announcements: Announcement[];
  loading: boolean;
  onClose: () => void;
};

function formatUpdatedAt(value: number): string {
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

/** 考试大屏公告弹窗：沿用设置页公告的 Markdown 卡片阅读方式。 */
export default function ExamAnnouncementOverlay({ open, announcements, loading, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="eann-overlay" role="dialog" aria-modal="true" aria-label="系统公告" onClick={onClose}>
      <section className="eann-window" onClick={event => event.stopPropagation()}>
        <header className="eann-window__head">
          <div>
            <h2 className="eann-window__title">📢 系统公告</h2>
            <p className="eann-window__lead">公告由作者端统一发布，内容以 Markdown 渲染。</p>
          </div>
          <button className="eann-window__close" onClick={onClose} aria-label="关闭公告">×</button>
        </header>
        <div className="eann-window__body">
          {loading ? (
            <div className="eann-empty">公告加载中…</div>
          ) : announcements.length === 0 ? (
            <div className="eann-empty">暂无公告。</div>
          ) : (
            <AnnouncementList announcements={announcements} formatTime={formatUpdatedAt} />
          )}
        </div>
      </section>
    </div>
  );
}
