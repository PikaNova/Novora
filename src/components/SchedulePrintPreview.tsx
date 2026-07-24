import React, { useMemo, useState } from 'react';
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

const WEEKDAYS = ['', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

function mondayOf(date: string) {
  const weekday = isoWeekdayOfDateKey(date);
  return addDaysToDateKey(date, -(weekday - 1));
}

export default function SchedulePrintPreview({ entries, gradeName, className, onClose }: { entries: PrintScheduleEntry[]; gradeName: string; className: string; onClose: () => void }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(getShanghaiDateKey(Date.now())));
  const schoolName = getAppSettings().exam.initialization.schoolFullName || getAppSettings().exam.initialization.schoolName || '未设置学校名称';
  const instanceId = getClassBindingInstanceId();
  const exportedAt = useMemo(() => new Date().toLocaleString('zh-CN', { hour12: false }), []);
  const weekEnd = addDaysToDateKey(weekStart, 6);
  const visible = entries.filter(item => item.date >= weekStart && item.date <= weekEnd && !item.suppressed).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const dates = Array.from({ length: 7 }, (_, index) => addDaysToDateKey(weekStart, index));

  return <div className="schedule-preview" role="dialog" aria-modal="true" aria-label="A4 排班预览">
    <header className="schedule-preview__toolbar">
      <div><button title="上一周" aria-label="上一周" onClick={() => setWeekStart(value => addDaysToDateKey(value, -7))}><ChevronLeft /></button><strong>{weekStart} 至 {weekEnd}</strong><button title="下一周" aria-label="下一周" onClick={() => setWeekStart(value => addDaysToDateKey(value, 7))}><ChevronRight /></button></div>
      <div><button onClick={() => window.print()}><Printer />打印 / 保存 PDF</button><button title="关闭预览" aria-label="关闭预览" onClick={onClose}><X /></button></div>
    </header>
    <main className="schedule-preview__stage">
      <article className="schedule-sheet">
        <header className="schedule-sheet__head"><img src="/icon-512.png" alt="考试看板图标" /><div><span>{schoolName}</span><h1>考试看板 · 班级周测排班表</h1></div></header>
        <dl className="schedule-sheet__meta"><div><dt>年级与班级</dt><dd>{gradeName} · {className}</dd></div><div><dt>排班周次</dt><dd>{weekStart} 至 {weekEnd}</dd></div><div><dt>设备实例号</dt><dd>{instanceId}</dd></div><div><dt>导出时间</dt><dd>{exportedAt}</dd></div></dl>
        <table><thead><tr><th>日期</th><th>星期</th><th>时间</th><th>考试科目</th><th>状态 / 备注</th></tr></thead><tbody>{dates.flatMap(date => {
          const dayEntries = visible.filter(item => item.date === date);
          return dayEntries.length ? dayEntries.map((item, index) => <tr key={`${date}-${item.name}-${item.startTime}`}><td>{index === 0 ? date : ''}</td><td>{index === 0 ? WEEKDAYS[isoWeekdayOfDateKey(date)] : ''}</td><td>{item.startTime}–{item.endTime}</td><td>{item.name}</td><td>{item.note || '正常安排'}</td></tr>) : [<tr className="is-empty" key={date}><td>{date}</td><td>{WEEKDAYS[isoWeekdayOfDateKey(date)]}</td><td>—</td><td>无周测安排</td><td>—</td></tr>];
        })}</tbody></table>
        <footer className="schedule-sheet__footer"><span>考试看板 Exam Board</span><span>Created By PikaNova</span></footer>
      </article>
    </main>
  </div>;
}
