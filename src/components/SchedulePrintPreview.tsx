import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Printer, X } from 'lucide-react';
import { getClassBindingInstanceId } from '../services/classBinding';
import { getAppSettings } from '../utils/appSettings';
import { addDaysToDateKey, getShanghaiDateKey, isoWeekdayOfDateKey } from '../utils/weeklySchedule';

export interface PrintScheduleEntry {
  date: string;
  name: string;
  startTime: string;
  endTime: string;
  suppressed?: boolean;
  note?: string;
}

type FontKey = 'smiley' | 'source' | 'alibaba' | 'wenkai';
const FONT_OPTIONS: Array<{ id: FontKey; label: string; css: string }> = [
  { id: 'smiley', label: '得意黑', css: '"Exam Smiley","Exam Source Han",sans-serif' },
  { id: 'source', label: '思源黑体', css: '"Exam Source Han",sans-serif' },
  { id: 'alibaba', label: '阿里巴巴普惠体', css: '"Exam Alibaba","Exam Source Han",sans-serif' },
  { id: 'wenkai', label: '霞鹜文楷', css: '"Exam WenKai","Exam Source Han",sans-serif' },
];
const WEEKDAYS = ['', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

function mondayOf(date: string) {
  return addDaysToDateKey(date, -(isoWeekdayOfDateKey(date) - 1));
}

type Props = {
  entries: PrintScheduleEntry[];
  gradeName: string;
  className: string;
  onClose: () => void;
  mode?: 'weekly' | 'major';
  title?: string;
};

export default function SchedulePrintPreview({ entries, gradeName, className, onClose, mode = 'weekly', title = '' }: Props) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(getShanghaiDateKey(Date.now())));
  const [titleFont, setTitleFont] = useState<FontKey>('smiley');
  const [bodyFont, setBodyFont] = useState<FontKey>('wenkai');
  const [numericFont, setNumericFont] = useState<FontKey>('source');
  const settings = getAppSettings().exam;
  const schoolName = settings.initialization.schoolFullName || settings.initialization.schoolName || '未设置学校名称';
  const instanceId = getClassBindingInstanceId();
  const exportedAt = useMemo(() => new Date().toLocaleString('zh-CN', { hour12: false }), []);
  const weekEnd = addDaysToDateKey(weekStart, 13);
  const visible = useMemo(() => entries
    .filter(item => !item.suppressed && (mode === 'major' || (item.date >= weekStart && item.date <= weekEnd)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)), [entries, mode, weekEnd, weekStart]);
  const groups = useMemo(() => [...new Set(visible.map(item => item.date))].map(date => ({ date, entries: visible.filter(item => item.date === date) })), [visible]);
  const dates = groups.map(group => group.date);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (fonts) void Promise.allSettled(['Exam Smiley', 'Exam Source Han', 'Exam Alibaba', 'Exam WenKai'].map(name => fonts.load(`16px "${name}"`)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const fontCss = (id: FontKey) => FONT_OPTIONS.find(item => item.id === id)?.css || FONT_OPTIONS[1].css;
  const periodText = mode === 'major' ? (dates.length ? `${dates[0]} 至 ${dates[dates.length - 1]}` : '尚未添加科目') : `${weekStart} 至 ${weekEnd}`;
  const sheetTitle = mode === 'major' ? `${title || '大型考试'} · 考试安排` : '考试看板 · 班级周测考试安排';
  const sheetStyle = { '--schedule-title-font': fontCss(titleFont), '--schedule-body-font': fontCss(bodyFont), '--schedule-numeric-font': fontCss(numericFont) } as React.CSSProperties;

  return <div className="schedule-preview" role="dialog" aria-modal="true" aria-label="A4 考试安排预览">
    <header className="schedule-preview__toolbar">
      <div className="schedule-preview__period">{mode === 'weekly' && <button title="前两周" aria-label="前两周" onClick={() => setWeekStart(value => addDaysToDateKey(value, -14))}><ChevronLeft /></button>}<strong>{periodText}</strong>{mode === 'weekly' && <button title="后两周" aria-label="后两周" onClick={() => setWeekStart(value => addDaysToDateKey(value, 14))}><ChevronRight /></button>}</div>
      <div className="schedule-preview__fonts"><label>标题<select value={titleFont} onChange={event => setTitleFont(event.target.value as FontKey)}>{FONT_OPTIONS.map(font => <option key={font.id} value={font.id}>{font.label}</option>)}</select></label><label>正文<select value={bodyFont} onChange={event => setBodyFont(event.target.value as FontKey)}>{FONT_OPTIONS.map(font => <option key={font.id} value={font.id}>{font.label}</option>)}</select></label><label>时间数字<select value={numericFont} onChange={event => setNumericFont(event.target.value as FontKey)}>{FONT_OPTIONS.map(font => <option key={font.id} value={font.id}>{font.label}</option>)}</select></label></div>
      <div><button onClick={() => window.print()}><Printer />打印 / 保存 PDF</button><button title="关闭预览" aria-label="关闭预览" onClick={onClose}><X /></button></div>
    </header>
    <main className="schedule-preview__stage">
      <article className={`schedule-sheet${visible.length > 12 ? ' is-dense' : ''}`} style={sheetStyle}>
        <header className="schedule-sheet__head"><img src="/icon-512.png" alt="考试看板图标" /><div><span>{schoolName}</span><h1>{sheetTitle}</h1></div></header>
        <dl className="schedule-sheet__meta"><div><dt>适用范围</dt><dd>{gradeName}{className && className !== '全年级' ? ` · ${className}` : ' · 全年级'}</dd></div><div><dt>安排日期</dt><dd>{periodText}</dd></div><div><dt>设备实例号</dt><dd>{instanceId}</dd></div><div><dt>导出时间</dt><dd>{exportedAt}</dd></div></dl>
        {groups.length ? <div className="schedule-sheet__days">{groups.map(group => <section className="schedule-day" key={group.date}><header className="schedule-day__date"><strong>{group.date.slice(5).replace('-', ' / ')}</strong><span>{WEEKDAYS[isoWeekdayOfDateKey(group.date)]}</span></header><div className="schedule-day__events">{group.entries.map((item, index) => <article className="schedule-event" key={`${item.date}-${item.name}-${item.startTime}-${index}`}><time>{item.startTime}<i>至</i>{item.endTime}</time><div><strong>{item.name}</strong>{item.note && <span>{item.note}</span>}</div></article>)}</div></section>)}</div> : <div className="schedule-sheet__empty"><strong>当前日期范围内暂无考试安排</strong><span>请返回管理后台添加考试后重新预览。</span></div>}
        <footer className="schedule-sheet__footer"><span>考试看板 Exam Board</span><span>Created By PikaNova</span></footer>
      </article>
    </main>
  </div>;
}
