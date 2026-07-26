import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { getClassBindingInstanceId } from '../services/classBinding';
import { getAppSettings } from '../utils/appSettings';
import { addDaysToDateKey, getShanghaiDateKey, isoWeekdayOfDateKey } from '../utils/weeklySchedule';
import InlineSelect from './InlineSelect';
import SubjectIcon from './SubjectIcon';

export interface PrintScheduleEntry {
  date: string;
  name: string;
  startTime: string;
  endTime: string;
  suppressed?: boolean;
  note?: string;
  kind?: 'major' | 'weekly' | 'temporary';
}
export interface PrintScheduleDocument { entries: PrintScheduleEntry[]; gradeName: string; className: string; }

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

function comparePrintEntries(a: PrintScheduleEntry, b: PrintScheduleEntry) {
  const aIsWeekend = isoWeekdayOfDateKey(a.date) > 5;
  const bIsWeekend = isoWeekdayOfDateKey(b.date) > 5;
  if (aIsWeekend !== bIsWeekend) return aIsWeekend ? 1 : -1;
  return a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime);
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

type Props = {
  entries: PrintScheduleEntry[];
  gradeName: string;
  className: string;
  onClose: () => void;
  mode?: 'weekly' | 'major' | 'combined';
  title?: string;
  schedules?: PrintScheduleDocument[];
};

export default function SchedulePrintPreview({ entries, gradeName, className, onClose, mode = 'weekly', title = '', schedules }: Props) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(getShanghaiDateKey(Date.now())));
  const [titleFont, setTitleFont] = useState<FontKey>('smiley');
  const [bodyFont, setBodyFont] = useState<FontKey>('wenkai');
  const [numericFont, setNumericFont] = useState<FontKey>('source');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const exportSheetRefs = useRef<Array<HTMLElement | null>>([]);
  const settings = getAppSettings().exam;
  const schoolName = settings.initialization.schoolFullName || settings.initialization.schoolName || '未设置学校名称';
  const instanceId = getClassBindingInstanceId();
  const exportedAt = useMemo(() => new Date().toLocaleString('zh-CN', { hour12: false }), []);
  const weekEnd = addDaysToDateKey(weekStart, 6);
  const documents = useMemo<PrintScheduleDocument[]>(() => schedules?.length ? schedules : [{ entries, gradeName, className }], [className, entries, gradeName, schedules]);
  const visible = useMemo(() => documents[0].entries.filter(item => !item.suppressed && (mode === 'major' || (item.date >= weekStart && item.date <= weekEnd))).sort(comparePrintEntries), [documents, mode, weekEnd, weekStart]);
  const dateRange = useMemo(() => [...new Set(visible.map(item => item.date))].sort(), [visible]);
  const pages = useMemo(() => {
    return documents.flatMap(document => {
      const documentVisible = document.entries.filter(item => !item.suppressed && (mode === 'major' || (item.date >= weekStart && item.date <= weekEnd))).sort(comparePrintEntries);
      if (mode === 'major') {
        const dates = [...new Set(documentVisible.map(item => item.date))].sort();
        return [{ key: `major-${document.className}`, visible: documentVisible, groups: [...new Set(documentVisible.map(item => item.date))].map(date => ({ date, entries: documentVisible.filter(item => item.date === date) })), periodText: dates.length ? `${dates[0]} 至 ${dates[dates.length - 1]}` : '尚未添加科目', gradeName: document.gradeName, className: document.className }];
      }
      const pageVisible = documentVisible.filter(item => item.date >= weekStart && item.date <= weekEnd);
      const pageGroups = [...new Set(pageVisible.map(item => item.date))].map(date => ({ date, entries: pageVisible.filter(item => item.date === date) }));
      return [{ key: `${document.className}-${weekStart}`, visible: pageVisible, groups: pageGroups, periodText: `${weekStart} 至 ${weekEnd}`, gradeName: document.gradeName, className: document.className }];
    });
  }, [documents, mode, weekEnd, weekStart]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (fonts) void Promise.allSettled(['Exam Smiley', 'Exam Source Han', 'Exam Alibaba', 'Exam WenKai'].map(name => fonts.load(`16px "${name}"`)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    document.body.classList.add('preview-scroll-lock');
    return () => document.body.classList.remove('preview-scroll-lock');
  }, []);
  const fontCss = (id: FontKey) => FONT_OPTIONS.find(item => item.id === id)?.css || FONT_OPTIONS[1].css;
  const periodText = mode === 'major' ? (dateRange.length ? `${dateRange[0]} 至 ${dateRange[dateRange.length - 1]}` : '尚未添加科目') : `${weekStart} 至 ${weekEnd}`;
  const sheetTitle = mode === 'major' ? `${title || '大型考试'} · 考试安排` : mode === 'combined' ? 'Novora · 班级考试安排' : 'Novora · 班级周测考试安排';
  const sheetStyle = { '--schedule-title-font': fontCss(titleFont), '--schedule-body-font': fontCss(bodyFont), '--schedule-numeric-font': fontCss(numericFont) } as React.CSSProperties;

  const downloadPdf = async () => {
    const sheets = exportSheetRefs.current.filter((item): item is HTMLElement => !!item);
    if (!sheets.length || exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (fonts) await fonts.ready;
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      const pageWidth = 210;
      const pageHeight = 297;
      for (let index = 0; index < sheets.length; index += 1) {
        const sheet = sheets[index];
        const canvas = await html2canvas(sheet, {
          backgroundColor: '#ffffff',
          logging: false,
          scale: 2,
          useCORS: true,
          width: sheet.scrollWidth,
          height: sheet.scrollHeight,
          windowWidth: 1200,
          windowHeight: 1600,
          scrollX: 0,
          scrollY: 0,
        });
        if (index > 0) pdf.addPage('a4', 'portrait');
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
      }
      const firstDocument = documents[0];
      const fileTitle = mode === 'major' ? (title || '大型考试') : mode === 'combined' ? `${firstDocument.gradeName}-${firstDocument.className}` : documents.length > 1 ? `${firstDocument.gradeName}-${documents.length}个班级-周测` : `${firstDocument.gradeName}-${firstDocument.className}-周测`;
      pdf.save(`${safeFileName(fileTitle)}-考试安排-${getShanghaiDateKey(Date.now())}.pdf`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'PDF 生成失败，请重试');
    } finally {
      setExporting(false);
    }
  };

  return createPortal(<div className="schedule-preview" role="dialog" aria-modal="true" aria-label="A4 考试安排预览">
    <header className="schedule-preview__toolbar">
      <div className="schedule-preview__period">{mode !== 'major' && <button title="上一周" aria-label="上一周" onClick={() => setWeekStart(value => addDaysToDateKey(value, -7))}><ChevronLeft /></button>}<strong>{periodText}</strong>{mode !== 'major' && <button title="下一周" aria-label="下一周" onClick={() => setWeekStart(value => addDaysToDateKey(value, 7))}><ChevronRight /></button>}</div>
      <div className="schedule-preview__fonts"><label>标题<InlineSelect value={titleFont} onChange={value => setTitleFont(value as FontKey)} options={FONT_OPTIONS.map(font => ({ value: font.id, label: font.label }))} /></label><label>正文<InlineSelect value={bodyFont} onChange={value => setBodyFont(value as FontKey)} options={FONT_OPTIONS.map(font => ({ value: font.id, label: font.label }))} /></label><label>时间数字<InlineSelect value={numericFont} onChange={value => setNumericFont(value as FontKey)} options={FONT_OPTIONS.map(font => ({ value: font.id, label: font.label }))} /></label></div>
      <div className="schedule-preview__actions">{exportError && <span className="schedule-preview__error" role="alert">{exportError}</span>}<button disabled={exporting} onClick={() => void downloadPdf()}><Download />{exporting ? '正在生成 PDF' : '下载 PDF'}</button><button title="关闭预览" aria-label="关闭预览" onClick={onClose}><X /></button></div>
    </header>
    <main className="schedule-preview__stage">
      <div className="schedule-preview__pages">{pages.map(page => <ScheduleSheet key={page.key} visible={page.visible} groups={page.groups} schoolName={schoolName} sheetTitle={sheetTitle} gradeName={page.gradeName} className={page.className} periodText={page.periodText} instanceId={instanceId} exportedAt={exportedAt} sheetStyle={sheetStyle} />)}</div>
      <div className="schedule-export-host" aria-hidden="true">
      {pages.map((page, index) => <ScheduleSheet key={page.key} ref={element => { exportSheetRefs.current[index] = element; }} exportMode visible={page.visible} groups={page.groups} schoolName={schoolName} sheetTitle={sheetTitle} gradeName={page.gradeName} className={page.className} periodText={page.periodText} instanceId={instanceId} exportedAt={exportedAt} sheetStyle={sheetStyle} />)}
      </div>
    </main>
  </div>, document.body);
}

type ScheduleSheetProps = {
  visible: PrintScheduleEntry[];
  groups: Array<{ date: string; entries: PrintScheduleEntry[] }>;
  schoolName: string; sheetTitle: string; gradeName: string; className: string;
  periodText: string; instanceId: string; exportedAt: string; sheetStyle: React.CSSProperties;
  exportMode?: boolean;
};

const ScheduleSheet = React.forwardRef<HTMLElement, ScheduleSheetProps>(function ScheduleSheet({ visible, groups, schoolName, sheetTitle, gradeName, className, periodText, instanceId, exportedAt, sheetStyle, exportMode = false }, ref) {
  return <article ref={ref} className={`schedule-sheet${visible.length > 12 ? ' is-dense' : ''}${exportMode ? ' schedule-sheet--export' : ''}`} style={sheetStyle}>
    <header className="schedule-sheet__head"><img src="/icon-512-rounded.png" alt="Novora 图标" /><div><span>{schoolName}</span><h1>{sheetTitle}</h1></div></header>
    <dl className="schedule-sheet__meta"><div><dt>适用范围</dt><dd>{gradeName}{className && className !== '全年级' ? ` · ${className}` : ' · 全年级'}</dd></div><div><dt>安排日期</dt><dd>{periodText}</dd></div><div><dt>设备实例号</dt><dd>{instanceId}</dd></div><div><dt>导出时间</dt><dd>{exportedAt}</dd></div></dl>
    {groups.length ? <div className="schedule-sheet__days">{groups.map(group => <section className="schedule-day" key={group.date} style={{ '--schedule-day-min-height': `${Math.max(66, group.entries.length * 68 + 14)}px` } as React.CSSProperties}><header className="schedule-day__date"><strong>{group.date.slice(5).replace('-', ' / ')}</strong><span>{WEEKDAYS[isoWeekdayOfDateKey(group.date)]}</span></header><div className="schedule-day__events">{group.entries.map((item, index) => <article className="schedule-event" key={`${item.date}-${item.name}-${item.startTime}-${index}`}><time>{item.startTime}<i>至</i>{item.endTime}</time><div><strong className="schedule-event__subject"><SubjectIcon subject={item.name} size={15} />{item.name}</strong>{item.note && <span>{item.note}</span>}</div></article>)}</div></section>)}</div> : <div className="schedule-sheet__empty"><strong>当前日期范围内暂无考试安排</strong><span>请返回管理后台添加考试后重新预览。</span></div>}
    <footer className="schedule-sheet__footer"><span>Novora · 考试管理与教室大屏</span><span>Created By PikaNova</span></footer>
  </article>;
});
