import React, { useMemo, useState } from 'react';
import type { ScheduleMode, WeeklyWeekMode } from '../types/exam';
import { getShanghaiDateKey } from '../utils/weeklySchedule';
import { buildInitializationData, type InitializationResult, type SchoolDraftRow } from '../utils/initializationData';
import '../styles/initialization-wizard.css';

interface Props { open: boolean; onClose: () => void; onComplete: (result: InitializationResult) => void; }

const DEMO_SCHOOL: SchoolDraftRow[] = [
  { name: '高一', classes: '1班、2班' },
  { name: '高二', classes: '1班、2班' },
  { name: '高三', classes: '1班、2班' },
];

export default function InitializationWizard({ open, onClose, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<'blank' | 'demo'>('demo');
  const [school, setSchool] = useState<SchoolDraftRow[]>(DEMO_SCHOOL);
  const [termStart, setTermStart] = useState(getShanghaiDateKey(Date.now()));
  const [weekMode, setWeekMode] = useState<WeeklyWeekMode>('ab');
  const [excludeOfficialHolidays, setExcludeOfficialHolidays] = useState(true);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('automatic');
  const validSchool = useMemo(() => school.some(row => row.name.trim() && row.classes.trim()), [school]);
  if (!open) return null;

  const chooseMode = (next: 'blank' | 'demo') => {
    setMode(next);
    setSchool(next === 'demo' ? DEMO_SCHOOL : [{ name: '高一', classes: '1班' }]);
  };
  const finish = () => onComplete(buildInitializationData({ mode, school, termStart, weekMode, excludeOfficialHolidays, scheduleMode }));

  return <div className="init-overlay" role="dialog" aria-modal="true" aria-labelledby="init-title"><div className="init-window">
    <header className="init-head"><div><span>初始化向导 · {step + 1}/4</span><h2 id="init-title">{['选择初始化方式', '设置年级与班级', '设置学期规则', '确认并开始使用'][step]}</h2></div><button onClick={onClose} aria-label="关闭初始化向导">×</button></header>
    <div className="init-progress"><i style={{ width: `${(step + 1) * 25}%` }} /></div>
    <main className="init-body">
      {step === 0 && <div className="init-choice-grid"><button className={mode === 'demo' ? 'is-active' : ''} onClick={() => chooseMode('demo')}><strong>导入演示数据</strong><span>建立三个年级、六个班级、动态测试考试及 A/B 周周测。</span></button><button className={mode === 'blank' ? 'is-active' : ''} onClick={() => chooseMode('blank')}><strong>空白开始</strong><span>只建立基础年级和班级，考试与周测稍后配置。</span></button></div>}
      {step === 1 && <div className="init-school"><p>每行对应一个年级，班级之间使用逗号或顿号分隔。</p>{school.map((row, index) => <div className="init-school-row" key={index}><input value={row.name} onChange={event => setSchool(list => list.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} placeholder="年级，如：高一" /><input value={row.classes} onChange={event => setSchool(list => list.map((item, i) => i === index ? { ...item, classes: event.target.value } : item))} placeholder="班级，如：1班、2班" /><button onClick={() => setSchool(list => list.filter((_, i) => i !== index))} aria-label="删除此年级">×</button></div>)}<button className="init-add" onClick={() => setSchool(list => [...list, { name: '', classes: '' }])}>添加年级</button></div>}
      {step === 2 && <div className="init-form"><label><span>学期开始日期</span><input type="date" value={termStart} onChange={event => setTermStart(event.target.value)} /></label><label><span>周次模式</span><select value={weekMode} onChange={event => setWeekMode(event.target.value as WeeklyWeekMode)}><option value="single">统一周表</option><option value="ab">A/B 周交替</option></select></label><label className="init-check"><input type="checkbox" checked={excludeOfficialHolidays} onChange={event => setExcludeOfficialHolidays(event.target.checked)} />自动排除法定节假日</label><label><span>默认运行模式</span><select value={scheduleMode} onChange={event => setScheduleMode(event.target.value as ScheduleMode)}><option value="major-only">仅大型考试</option><option value="weekly-only">仅周测</option><option value="automatic">自动调度</option></select></label></div>}
      {step === 3 && <div className="init-summary"><strong>{mode === 'demo' ? '将导入一套可立即查看的演示数据' : '将创建空白学校结构'}</strong><p>{school.filter(row => row.name.trim()).length} 个年级 · 学期开始于 {termStart} · {weekMode === 'ab' ? 'A/B 周交替' : '统一周表'} · {scheduleMode === 'automatic' ? '自动调度' : scheduleMode === 'weekly-only' ? '仅周测' : '仅大型考试'}</p><small>完成后客户端回到首页选择年级和班级，不会在首次打开首页时被强制拦截。</small></div>}
    </main>
    <footer className="init-actions"><button onClick={onClose}>稍后设置</button>{step > 0 && <button onClick={() => setStep(value => value - 1)}>上一步</button>}<button className="is-primary" disabled={step === 1 && !validSchool} onClick={() => step < 3 ? setStep(value => value + 1) : finish()}>{step < 3 ? '下一步' : '完成初始化'}</button></footer>
  </div></div>;
}
