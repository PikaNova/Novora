import React, { useMemo, useState } from 'react';
import type { ScheduleMode, WeeklyWeekMode } from '../types/exam';
import { getShanghaiDateKey } from '../utils/weeklySchedule';
import { buildInitializationData, type InitializationResult, type SchoolDraftRow } from '../utils/initializationData';
import { CHINA_PROVINCES, schoolFullName } from '../data/provinces';
import '../styles/initialization-wizard.css';

interface Props { open: boolean; onClose: () => void; onComplete: (result: InitializationResult) => void; }

export default function InitializationWizard({ open, onClose, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [mode] = useState<'blank' | 'demo'>('blank');
  const [schoolName, setSchoolName] = useState('');
  const [province, setProvince] = useState('');
  const [school, setSchool] = useState<SchoolDraftRow[]>([{ name: '高一', classes: '1班' }]);
  const [quickCounts, setQuickCounts] = useState<Record<number, string>>({ 0: '10' });
  const [termStart, setTermStart] = useState(getShanghaiDateKey(Date.now()));
  const [weekMode, setWeekMode] = useState<WeeklyWeekMode>('ab');
  const [excludeOfficialHolidays, setExcludeOfficialHolidays] = useState(true);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('automatic');
  const validSchool = useMemo(() => school.some(row => row.name.trim() && row.classes.trim()), [school]);
  if (!open) return null;

  const quickClasses = (index: number, count: number) => setSchool(list => list.map((row, rowIndex) => rowIndex === index
    ? { ...row, classes: Array.from({ length: Math.max(1, Math.min(99, count)) }, (_, i) => `${i + 1}班`).join('、') }
    : row));
  const finish = () => onComplete(buildInitializationData({ mode, province, schoolName, school, termStart, weekMode, excludeOfficialHolidays, scheduleMode }));

  return <div className="init-overlay" role="dialog" aria-modal="true" aria-labelledby="init-title"><div className="init-window">
    <header className="init-head"><div><span>初始化向导 · {step + 1}/4</span><h2 id="init-title">{['填写学校信息', '设置年级与班级', '设置学期规则', '确认并开始使用'][step]}</h2></div><button onClick={onClose} aria-label="关闭初始化向导">×</button></header>
    <div className="init-progress"><i style={{ width: `${(step + 1) * 25}%` }} /></div>
    <main className="init-body">
      {step === 0 && <div className="init-form"><label><span>省份 / 地区</span><select autoFocus value={province} onChange={event => setProvince(event.target.value)}><option value="">请选择省份或地区</option>{CHINA_PROVINCES.map(item => <option key={item} value={item}>{item}</option>)}</select></label><label><span>学校名称</span><input value={schoolName} onChange={event => setSchoolName(event.target.value)} placeholder="如：第一中学" maxLength={80} /></label><div className="init-school-fullname"><span>完整校名</span><strong>{schoolFullName(province, schoolName) || '选择省份并填写学校名称后自动生成'}</strong></div><p className="init-note">完整校名将显示在考试安排预览和 A4 PDF 中，并在你同意遥测后与省份一起上报作者端。</p></div>}
      {step === 1 && <div className="init-school"><p>每行对应一个年级。每一行都可独立输入数量并生成 1 班至 X 班。</p>{school.map((row, index) => <div className="init-school-row" key={`grade-row-${index}`}><input value={row.name} onChange={event => setSchool(list => list.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} placeholder="年级，如：高一" /><input value={row.classes} onChange={event => setSchool(list => list.map((item, i) => i === index ? { ...item, classes: event.target.value } : item))} placeholder="班级，如：1班、2班" /><label className="init-quick-count"><input type="number" min="1" max="99" value={quickCounts[index] ?? '10'} onChange={event => setQuickCounts(value => ({ ...value, [index]: event.target.value }))} aria-label={`${row.name || '当前年级'}班级数量`} /><button type="button" onClick={() => quickClasses(index, Number(quickCounts[index] || 10))}>生成 1-X 班</button></label><button type="button" onClick={() => setSchool(list => list.filter((_, i) => i !== index))} aria-label="删除此年级">×</button></div>)}<button type="button" className="init-add" onClick={() => { const index=school.length; setSchool(list => [...list, { name: '', classes: '' }]); setQuickCounts(value => ({ ...value, [index]: '10' })); }}>添加年级</button></div>}
      {step === 2 && <div className="init-form"><label><span>学期开始日期</span><input type="date" value={termStart} onChange={event => setTermStart(event.target.value)} /></label><label><span>周次模式</span><select value={weekMode} onChange={event => setWeekMode(event.target.value as WeeklyWeekMode)}><option value="single">统一周表</option><option value="ab">A/B 周交替</option></select></label><label className="init-check"><input type="checkbox" checked={excludeOfficialHolidays} onChange={event => setExcludeOfficialHolidays(event.target.checked)} />自动排除法定节假日</label><label><span>默认运行模式</span><select value={scheduleMode} onChange={event => setScheduleMode(event.target.value as ScheduleMode)}><option value="major-only">仅大型考试</option><option value="weekly-only">仅周测</option><option value="automatic">自动调度</option></select></label></div>}
      {step === 3 && <div className="init-summary"><strong>{schoolFullName(province, schoolName)}</strong><p>{school.filter(row => row.name.trim()).length} 个年级 · 学期开始于 {termStart} · {weekMode === 'ab' ? 'A/B 周交替' : '统一周表'} · {scheduleMode === 'automatic' ? '自动调度' : scheduleMode === 'weekly-only' ? '仅周测' : '仅大型考试'}</p><small>完成后客户端回到首页选择年级和班级，不会在首次打开首页时被强制拦截。</small></div>}
    </main>
    <footer className="init-actions"><button onClick={onClose}>稍后设置</button>{step > 0 && <button onClick={() => setStep(value => value - 1)}>上一步</button>}<button className="is-primary" disabled={(step === 0 && (!province || !schoolName.trim())) || (step === 1 && !validSchool)} onClick={() => step < 3 ? setStep(value => value + 1) : finish()}>{step < 3 ? '下一步' : '完成初始化'}</button></footer>
  </div></div>;
}
