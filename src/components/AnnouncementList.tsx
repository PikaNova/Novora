import React, { useMemo, useState } from 'react';
import type { Announcement } from '../services/announcements';
import { renderMarkdown } from '../utils/renderMarkdown';
import { isAnnouncementRead, markAnnouncementRead, sortAnnouncements } from '../utils/announcementState';
import '../styles/announcement-list.css';

type Props = { announcements: Announcement[]; formatTime: (value: number) => string; className?: string };
export default function AnnouncementList({ announcements, formatTime, className = '' }: Props) {
  const sorted = useMemo(() => sortAnnouncements(announcements), [announcements]);
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const [, refresh] = useState(0);
  const toggle = (a: Announcement) => { const next = new Set(open); if (next.has(a.id)) next.delete(a.id); else { next.add(a.id); markAnnouncementRead(a); refresh(v => v + 1); } setOpen(next); };
  return <div className={`announcement-list ${className}`}>{sorted.map(a => { const expanded = open.has(a.id); const read = isAnnouncementRead(a); return <article className={`announcement-card${expanded ? ' is-open' : ''}${read ? ' is-read' : ' is-unread'}`} key={a.id}>
    <button className="announcement-card__head" onClick={() => toggle(a)} aria-expanded={expanded}>
      <span className={`announcement-card__state ${read ? 'is-read' : 'is-unread'}`}>{read ? '已读' : '未读'}</span>
      {!read && <span className="announcement-card__new">NEW</span>}
      {a.pinned && <span className="announcement-card__pin">📌</span>}
      <span className="announcement-card__title">{a.title || '（无标题）'}</span>
      <span className="announcement-card__toggle">{expanded ? '收起 ▴' : '展开 ▾'}</span>
    </button>
    <div className="announcement-card__meta">更新于 {formatTime(Number(a.updated_at))}</div>
    {expanded && <div className="announcement-card__body md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.content) }} />}
  </article>; })}</div>;
}
