import React, { useMemo, useState } from 'react';
import { Play, Plus, TimerReset } from 'lucide-react';
import type { ExamItem } from '../types';
import { endTemporaryExam, extendTemporaryExam, getTemporaryExam, saveTemporaryExam, toggleTemporaryExamPause } from '../services/temporaryExam';
import { notify } from '../services/notify';

const isoLocal = (value: number) => new Date(value - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export default function TemporaryExamLauncher({ formalItems, externalOpen = false, onExternalHandled }: { formalItems: ExamItem[]; externalOpen?: boolean; onExternalHandled?: () => void }) {
  const current = getTemporaryExam();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('数学');
  const [mode, setMode] = useState<'now' | 'delay'>('now');
  const [delay, setDelay] = useState(10);
  const [endTime, setEndTime] = useState(() => isoLocal(Date.now() + 45 * 60_000));
  const [priority, setPriority] = useState(false);
  const shouldOpen = open || externalOpen;
  const startMs = mode === 'now' ? Date.now() : Date.now() + delay * 60_000;
  const conflicts = useMemo(() => formalItems.filter(item => item.enabled && new Date(item.startTime).getTime() < new Date(endTime).getTime() && new Date(item.endTime).getTime() > startMs), [endTime, formalItems, startMs]);
  const close = () => { setOpen(false); onExternalHandled?.(); };
  const create = () => {
    const endMs = new Date(endTime).getTime();
    if (!subject.trim()) { notify('error', '请选择或填写考试科目。'); return; }
    if (!Number.isFinite(endMs) || endMs <= startMs) { notify('error', '结束时间必须晚于开始时间。'); return; }
    if (conflicts.length && !window.confirm(`${conflicts.map(item => item.name).join('、')} 将与临时考试时间重叠。${priority ? '临时考试将在本设备上优先显示。' : '正式考试开始时将自动接管。'}确认创建？`)) return;
    saveTemporaryExam({ id: `temp_${Date.now()}`, subject: subject.trim(), startTime: isoLocal(startMs), endTime, priorityOverFormal: priority, status: startMs <= Date.now() ? 'running' : 'scheduled', createdAt: Date.now() });
    notify('success', `${subject.trim()} - 临时考试已创建，仅应用于当前设备。`);
    close();
  };

  return <>
    <button className="temp-exam-fab" onClick={() => setOpen(true)}><Play />{current && current.status !== 'ended' ? '管理临时考试' : '快速开始考试'}</button>
    {shouldOpen && <div className="temp-exam-overlay" role="dialog" aria-modal="true"><section className="temp-exam-panel"><header><div><span>当前设备</span><h2>{current && current.status !== 'ended' ? '管理临时考试' : '新建临时考试'}</h2></div><button onClick={close} aria-label="关闭">×</button></header>{current && current.status !== 'ended' ? <div className="temp-exam-current"><TimerReset /><h3>{current.subject} - 临时考试</h3><p>{current.startTime.replace('T', ' ')} 至 {current.endTime.replace('T', ' ')}</p><div><button onClick={() => { toggleTemporaryExamPause(); notify('warning', current.status === 'paused' ? '临时考试已继续。' : '临时考试已暂停。'); close(); }}>{current.status === 'paused' ? '继续' : '暂停'}</button><button onClick={() => { extendTemporaryExam(5); notify('success', '临时考试已延长 5 分钟。'); close(); }}>增加 5 分钟</button><button className="is-danger" onClick={() => { if (window.confirm('确定提前结束当前临时考试？')) { endTemporaryExam(); notify('warning', '临时考试已提前结束。'); close(); } }}>提前结束</button></div></div> : <div className="temp-exam-form"><label>考试科目<input list="temporary-subjects" value={subject} onChange={event => setSubject(event.target.value)} /><datalist id="temporary-subjects"><option value="语文"/><option value="数学"/><option value="英语"/><option value="物理"/><option value="化学"/><option value="生物"/><option value="政治"/><option value="历史"/><option value="地理"/></datalist></label><fieldset><legend>开始方式</legend><button className={mode === 'now' ? 'is-active' : ''} onClick={() => setMode('now')}>立即开始</button><button className={mode === 'delay' ? 'is-active' : ''} onClick={() => setMode('delay')}>几分钟后开始</button></fieldset>{mode === 'delay' && <label>延迟分钟数<input type="number" min="1" max="180" value={delay} onChange={event => setDelay(Math.max(1, Number(event.target.value) || 1))} /></label>}<label>开始时间<input type="datetime-local" value={isoLocal(startMs)} readOnly /></label><label>结束时间<input type="datetime-local" value={endTime} onChange={event => setEndTime(event.target.value)} /></label><label className="temp-exam-priority"><input type="checkbox" checked={priority} onChange={event => setPriority(event.target.checked)} /><span><strong>临时考试优先于正式考试</strong><small>只覆盖当前设备显示，不修改统一下发的正式排期。</small></span></label>{conflicts.length > 0 && <div className="temp-exam-conflict">将与正式考试冲突：{conflicts.map(item => item.name).join('、')}</div>}<button className="temp-exam-submit" onClick={create}><Plus />创建临时考试</button></div>}</section></div>}
  </>;
}
