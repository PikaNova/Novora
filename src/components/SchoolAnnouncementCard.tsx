import React, { useMemo } from 'react';
import { renderMarkdown } from '../utils/renderMarkdown';
import type { SchoolExamAnnouncement } from '../services/examAnnouncements';
import '../styles/school-announcement-view.css';

type Props = {
  /** 只依赖展示字段，后台草稿预览可以传未发送的内容。 */
  item: Pick<SchoolExamAnnouncement, 'title' | 'body' | 'level' | 'style'>;
  /** 大屏上显示的时间/范围脚注；后台预览不传。 */
  meta?: string;
};

/**
 * 学校公告的展示件（大屏窗口与后台预览/确认弹窗共用同一个组件）。
 *
 * 正文按 Markdown 渲染：标题 / 加粗 / 列表 / 引用 / 表格 / 图片都支持，
 * 图片走 `/api/exams?resource=announcement-image&id=...` 同源地址。
 * 样式（card / poster / bulletin）只影响排版，不影响内容。
 */
export default function SchoolAnnouncementCard({ item, meta }: Props) {
  const html = useMemo(() => renderMarkdown(item.body ?? ''), [item.body]);
  const hasBody = (item.body ?? '').trim().length > 0;
  return (
    <article className={`sann-view is-${item.style}${item.level === 'urgent' ? ' is-urgent' : ''}`}>
      <header className="sann-view__head">
        <h3 className="sann-view__title">{item.title || '学校公告'}</h3>
        <em className="sann-view__tag">{item.level === 'urgent' ? '紧急' : '学校公告'}</em>
      </header>
      {hasBody ? (
        <div className="sann-view__body md-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="sann-view__body sann-view__body--empty">（这条公告没有正文）</p>
      )}
      {meta && <footer className="sann-view__meta">{meta}</footer>}
    </article>
  );
}
