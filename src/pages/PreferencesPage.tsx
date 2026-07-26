import React, { useMemo, useState } from 'react';
import { CalendarDays, Download, LogIn, School } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SchedulePrintPreview, { type PrintScheduleEntry } from '../components/SchedulePrintPreview';
import { useExamSync } from '../hooks/useExamSync';
import { getAdminUser, hasValidLocalToken } from '../services/examService';
import { getAppSettings } from '../utils/appSettings';
import { classDisplayName } from '../utils/classSettings';
import { addDaysToDateKey, getShanghaiDateKey } from '../utils/weeklySchedule';
import { getResolvedExamItems } from '../utils/appSchedule';
import '../styles/settings.css';

export default function PreferencesPage() {
  const navigate = useNavigate();
  const [, setRefresh] = useState(0);
  useExamSync({ onUpdate: () => setRefresh(value => value + 1) });
  const exam = getAppSettings().exam;
  const user = getAdminUser();
  const [printOpen, setPrintOpen] = useState(false);
  const grade = exam.grades.find(item => item.id === exam.selectedGradeId);
  const schoolClass = exam.classes.find(item => item.id === exam.selectedClassId);
  const entries = useMemo<PrintScheduleEntry[]>(() => getResolvedExamItems(Date.now(), { daysBack: 0, daysForward: 27 }, 'automatic').map(item => ({
    date: item.startTime.slice(0, 10),
    name: item.name,
    startTime: item.startTime.slice(11, 16),
    endTime: item.endTime.slice(11, 16),
    kind: item.kind ?? 'major',
    note: item.kind === 'weekly' ? '周测' : item.kind === 'temporary' ? '本机临时考试' : item.majorName || '大型考试',
  })), [exam.updatedAt, exam.selectedGradeId, exam.selectedClassId]);
  const majorCount = entries.filter(item => item.kind === 'major').length;
  const weeklyCount = entries.filter(item => item.kind === 'weekly').length;
  const temporaryCount = entries.filter(item => item.kind === 'temporary').length;
  const today = getShanghaiDateKey(Date.now());
  const days = Array.from({ length: 14 }, (_, index) => addDaysToDateKey(today, index));

  return <div className="set-page client-readonly">
    <header className="set-header"><div className="set-header__left"><button className="set-back" onClick={() => navigate('/')}>返回首页</button><div><h1 className="set-title">考试安排预览</h1><small>设备只读模式</small></div></div><button className="set-btn set-btn--primary" onClick={() => navigate(hasValidLocalToken() ? '/admin' : '/login?next=/admin')}><LogIn />{user ? `${user.displayName} · 进入后台` : '登录账户'}</button></header>
    <main className="set-body">
      <section className="set-card client-readonly__summary"><div><span>{exam.initialization.schoolFullName || exam.initialization.schoolName || 'Novora'}</span><h2>{schoolClass ? classDisplayName(exam.grades, exam.classes, schoolClass.id) : '当前设备尚未绑定班级'}</h2><p>{entries.length ? `${majorCount} 场大型考试科目 · ${weeklyCount} 场周测${temporaryCount ? ` · ${temporaryCount} 场临时考试` : ''}` : '当前班级暂无可预览的考试安排。'}</p></div>{schoolClass ? <button className="set-btn set-btn--primary" disabled={!entries.length} title={entries.length ? '预览并下载 PDF' : '当前班级还没有考试安排'} onClick={() => entries.length && setPrintOpen(true)}><Download />A4 预览与下载 PDF</button> : <button className="set-btn set-btn--primary" onClick={() => navigate('/?selectClass=1')}><School />选择本机班级</button>}</section>
      <section className="set-card"><div className="set-card__head"><h2 className="set-card__title"><CalendarDays />本周与未来考试安排</h2></div><div className="client-calendar">{days.map(date => { const dateEntries = entries.filter(item => item.date === date); return <article className={dateEntries.length ? 'has-events' : ''} key={date}><header><strong>{date.slice(5)}</strong><span>{new Date(`${date}T00:00:00`).toLocaleDateString('zh-CN', { weekday: 'short' })}</span></header>{dateEntries.length ? dateEntries.map(item => <div className={`is-${item.kind || 'major'}`} key={`${item.name}-${item.startTime}`}><b>{item.name}</b><span>{item.startTime}–{item.endTime}</span><em>{item.note}</em></div>) : <small>无安排</small>}</article>; })}</div></section>
    </main>
    {printOpen && <SchedulePrintPreview entries={entries} gradeName={grade?.name || '未选择年级'} className={schoolClass?.name || '未选择班级'} mode="combined" onClose={() => setPrintOpen(false)} />}
  </div>;
}
