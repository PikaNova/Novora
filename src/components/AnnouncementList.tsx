import React, { useMemo, useState } from 'react';
import type { Announcement } from '../services/announcements';
import { renderMarkdown } from '../utils/renderMarkdown';
import { isAnnouncementRead, markAnnouncementRead, sortAnnouncements } from '../utils/announcementState';
import '../styles/announcement-list.css';

type Props = { announcements: Announcement[]; formatTime: (value: number) => string; className?: string };
export default function AnnouncementList({ announcements, formatTime, className = '' }: Props) {
  const sorted = useMemo(() => sortAnnouncements(announcements), [announcements]);
  const hasDocuments = sorted.some(item => item.type === 'document');
  const hasAnnouncements = sorted.some(item => item.type !== 'document');
  const [view, setView] = useState<'announcement' | 'document'>(() => hasAnnouncements ? 'announcement' : 'document');
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const [, refresh] = useState(0);
  const toggle = (a: Announcement) => { const next = new Set(open); if (next.has(a.id)) next.delete(a.id); else { next.add(a.id); markAnnouncementRead(a); refresh(v => v + 1); } setOpen(next); };
  const visible = hasDocuments ? sorted.filter(item => view === 'document' ? item.type === 'document' : item.type !== 'document') : sorted;
  const safeUrl = (value?: string) => { try { const url = new URL(value ?? ''); return url.protocol === 'https:' ? url.toString() : ''; } catch { return ''; } };
  return <div className={`announcement-list ${className}`}>{hasDocuments && hasAnnouncements && <div className="announcement-tabs" role="tablist"><button className={view === 'announcement' ? 'is-active' : ''} onClick={() => setView('announcement')}>公告</button><button className={view === 'document' ? 'is-active' : ''} onClick={() => setView('document')}>文档</button></div>}{visible.map(a => { const expanded = open.has(a.id); const read = isAnnouncementRead(a); const documentUrl = a.type === 'document' ? safeUrl(a.url) : ''; return <article className={`announcement-card${expanded ? ' is-open' : ''}${read ? ' is-read' : ' is-unread'}`} key={a.id}>
    <button className="announcement-card__head" onClick={() => toggle(a)} aria-expanded={expanded}>
      <span className={`announcement-card__state ${read ? 'is-read' : 'is-unread'}`}>{read ? '已读' : '未读'}</span>
      {!read && <span className="announcement-card__new">NEW</span>}
      {a.pinned && <span className="announcement-card__pin">📌</span>}
      <span className="announcement-card__title">{a.type === 'document' ? '文档 · ' : ''}{a.title || '（无标题）'}</span>
      <span className="announcement-card__toggle">{expanded ? '收起 ▴' : '展开 ▾'}</span>
    </button>
    <div className="announcement-card__meta">更新于 {formatTime(Number(a.updated_at))}</div>
    {expanded && <div className="announcement-card__body md-body"><div dangerouslySetInnerHTML={{ __html: renderMarkdown(a.summary || a.content) }} />{a.type === 'document' && (documentUrl ? <a className="announcement-card__document" href={documentUrl} target="_blank" rel="noopener noreferrer" onClick={() => markAnnouncementRead(a)}>{a.buttonLabel?.trim() || '打开文档'} <span aria-hidden="true">↗</span></a> : <p className="announcement-card__invalid">文档链接无效或不是 HTTPS 地址</p>)}</div>}
  </article>; })}</div>;
}
