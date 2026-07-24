import React, { useMemo, useState } from 'react';
import { CalendarDays, Download, LogIn } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SchedulePrintPreview, { type PrintScheduleEntry } from '../components/SchedulePrintPreview';
import { useExamSync } from '../hooks/useExamSync';
import { getAdminUser, hasValidLocalToken } from '../services/examService';
import { getAppSettings } from '../utils/appSettings';
import { classDisplayName } from '../utils/classSettings';
import { addDaysToDateKey, getShanghaiDateKey, resolveWeeklyOccurrences } from '../utils/weeklySchedule';
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
  const activePlanId = exam.activeWeeklyPlanIdByClassId[exam.selectedClassId] ?? exam.activeWeeklyPlanId;
  const plan = exam.weeklyPlans.find(item => item.id === activePlanId && item.classId === exam.selectedClassId) ?? exam.weeklyPlans.find(item => item.classId === exam.selectedClassId);
  const entries = useMemo<PrintScheduleEntry[]>(() => plan ? resolveWeeklyOccurrences(plan, Date.now(), { daysBack: 0, daysForward: 27 }).map(item => ({ date: item.date, name: item.name, startTime: item.startTime.slice(11, 16), endTime: item.endTime.slice(11, 16), note: item.forced ? '冲突时保留' : '' })) : [], [plan]);
  const today = getShanghaiDateKey(Date.now());
  const days = Array.from({ length: 14 }, (_, index) => addDaysToDateKey(today, index));

  return <div className="set-page client-readonly">
    <header className="set-header"><div className="set-header__left"><button className="set-back" onClick={() => navigate('/')}>返回首页</button><div><h1 className="set-title">排班预览</h1><small>设备只读模式</small></div></div><button className="set-btn set-btn--primary" onClick={() => navigate(hasValidLocalToken() ? '/admin' : '/login?next=/admin')}><LogIn />{user ? `${user.displayName} · 进入后台` : '登录账户'}</button></header>
    <main className="set-body">
      <section className="set-card client-readonly__summary"><div><span>{exam.initialization.schoolFullName || exam.initialization.schoolName || '考试看板'}</span><h2>{schoolClass ? classDisplayName(exam.grades, exam.classes, schoolClass.id) : '当前设备尚未绑定班级'}</h2><p>{plan ? plan.name : '绑定班级并由管理员创建周测计划后，可在此预览和导出。'}</p></div>{plan && <button className="set-btn set-btn--primary" onClick={() => setPrintOpen(true)}><Download />A4 预览与导出</button>}</section>
      <section className="set-card"><div className="set-card__head"><h2 className="set-card__title"><CalendarDays />本周与未来计划</h2></div><div className="client-calendar">{days.map(date => { const dateEntries = entries.filter(item => item.date === date); return <article className={dateEntries.length ? 'has-events' : ''} key={date}><header><strong>{date.slice(5)}</strong><span>{new Date(`${date}T00:00:00`).toLocaleDateString('zh-CN', { weekday: 'short' })}</span></header>{dateEntries.length ? dateEntries.map(item => <div key={`${item.name}-${item.startTime}`}><b>{item.name}</b><span>{item.startTime}–{item.endTime}</span></div>) : <small>无安排</small>}</article>; })}</div></section>
    </main>
    {printOpen && <SchedulePrintPreview entries={entries} gradeName={grade?.name || '未选择年级'} className={schoolClass?.name || '未选择班级'} onClose={() => setPrintOpen(false)} />}
  </div>;
}
