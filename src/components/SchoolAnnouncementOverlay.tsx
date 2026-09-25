import React, { useEffect, useRef } from 'react';
import Mascot from './Mascot';
import SchoolAnnouncementCard from './SchoolAnnouncementCard';
import { formatDateTimeInZone } from '../utils/timeSource';
import { createSeenTracker } from '../utils/announcementSeen';
import type { SchoolExamAnnouncement } from '../services/examAnnouncements';
import { ANNOUNCEMENT_SEEN_MIN_MS, type AnnouncementSeenItem } from '../shared/examAnnouncementContracts.js';
import '../styles/school-announcement-overlay.css';

type Props = {
  open: boolean;
  announcements: SchoolExamAnnouncement[];
  /** 大屏上的学校名（标题用，可空）。 */
  schoolName?: string;
  onClose: () => void;
  /** 某条公告在屏幕上真正看满门槛时回调（回执上报的入口）。 */
  onSeen?: (item: AnnouncementSeenItem) => void;
  /** 已读门槛，默认 3 秒；测试里可以调小。 */
  seenMinMs?: number;
};

/**
 * 学校公告窗口（教室大屏）。
 *
 * 与作者端「系统公告窗口」（`ExamAnnouncementOverlay`）分开：
 * 这一扇窗口更大、正文按学校选择的样式排版（标准卡片 / 大字海报 / 公告栏），
 * 并且紧急公告置顶且不可关闭——用户口径：学校紧急公告盖过作者端公告。
 */
export default function SchoolAnnouncementOverlay({
  open,
  announcements,
  schoolName = '',
  onClose,
  onSeen,
  seenMinMs = ANNOUNCEMENT_SEEN_MIN_MS,
}: Props) {
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
              <TrackedAnnouncementCard
                key={item.id}
                item={item}
                minMs={seenMinMs}
                meta={`${formatDateTimeInZone(item.createdAt)} 发布`}
                onSeen={onSeen}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * 带"看过"计时的公告卡片。
 *
 * 只有卡片确实在视口里（IntersectionObserver ≥50%）且标签页在前台时才计时，
 * 于是滚动路过、切后台、锁屏都不算已读。没有 IntersectionObserver 的环境
 * （老浏览器 / 组件测试）退化成"窗口打开即视为可见"。
 */
function TrackedAnnouncementCard({
  item,
  meta,
  minMs,
  onSeen,
}: {
  item: SchoolExamAnnouncement;
  meta: string;
  minMs: number;
  onSeen?: (seen: AnnouncementSeenItem) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;

  useEffect(() => {
    if (!onSeenRef.current) return undefined;
    const tracker = createSeenTracker({
      id: item.id,
      minMs,
      onSeen: (seen) => onSeenRef.current?.(seen),
    });
    const hasDocument = typeof document !== 'undefined';
    const element = hostRef.current;
    let visible = true;
    let observer: IntersectionObserver | null = null;
    const update = () => {
      const foreground = !hasDocument || document.visibilityState !== 'hidden';
      tracker.setVisible(visible && foreground);
    };
    if (element && typeof IntersectionObserver !== 'undefined') {
      visible = false;
      observer = new IntersectionObserver(
        (entries) => {
          visible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5);
          update();
        },
        { threshold: [0, 0.5, 1] },
      );
      observer.observe(element);
    }
    if (hasDocument) document.addEventListener('visibilitychange', update);
    update();
    return () => {
      observer?.disconnect();
      if (hasDocument) document.removeEventListener('visibilitychange', update);
      tracker.dispose();
    };
  }, [item.id, minMs]);

  return (
    <div className="sann-screen-window__item" ref={hostRef}>
      <SchoolAnnouncementCard item={item} meta={meta} />
    </div>
  );
}
