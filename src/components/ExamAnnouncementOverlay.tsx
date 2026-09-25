import React, { useEffect } from 'react';
import type { Announcement } from '../services/announcements';
import AnnouncementList from './AnnouncementList';
import { Megaphone } from 'lucide-react';
import Mascot from './Mascot';
import '../styles/exam-announcement-overlay.css';

type Props = {
  open: boolean;
  announcements: Announcement[];
  loading: boolean;
  /** 切回学校公告窗口（本机有学校公告时才会传）。 */
  onSwitchToSchool?: () => void;
  onClose: () => void;
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

/**
 * 作者端「系统公告窗口」（教室大屏）。
 *
 * 只展示作者端统一公告，沿用设置页公告的 Markdown 卡片阅读方式；
 * 学校自己发的公告走另一扇更大的窗口（`SchoolAnnouncementOverlay`）。
 */
export default function ExamAnnouncementOverlay({ open, announcements, loading, onSwitchToSchool, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    // 组件测试/无 window 环境（例如 node 里渲染）不该因为键盘监听炸掉。
    if (typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="eann-overlay" role="dialog" aria-modal="true" aria-label="系统公告" onClick={onClose}>
      <section className="eann-window" onClick={(event) => event.stopPropagation()}>
        <header className="eann-window__head">
          <div>
            <h2 className="eann-window__title">
              <Megaphone aria-hidden="true" />
              系统公告
            </h2>
            <p className="eann-window__lead">公告由作者端统一发布，内容以 Markdown 渲染。</p>
          </div>
          <div className="eann-window__actions">
            {onSwitchToSchool && (
              <button className="eann-window__switch" type="button" onClick={onSwitchToSchool}>
                学校公告
              </button>
            )}
            <button className="eann-window__close" onClick={onClose} aria-label="关闭公告">
              ×
            </button>
          </div>
        </header>
        <div className="eann-window__body">
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
