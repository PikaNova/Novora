import React, { useMemo, useState } from 'react';
import type { MajorExam } from '../types';
import type { WeeklyPlan } from '../types/exam';

interface Props {
  classTags: string[];
  weeklyPlans: WeeklyPlan[];
  majors: MajorExam[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}

export default function ClassManagementPanel({ classTags, weeklyPlans, majors, onAdd, onRemove }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const usage = useMemo(() => new Map(classTags.map(tag => [tag, {
    plans: weeklyPlans.filter(plan => (plan.classTag || '') === tag).length,
    exams: majors.filter(major => major.targetClasses?.includes(tag)).length,
  }])), [classTags, weeklyPlans, majors]);

  const submit = () => {
    const tag = name.trim();
    if (!tag) { setError('请输入班级名称'); return; }
    if (tag.length > 40) { setError('班级名称不能超过 40 个字符'); return; }
    if (classTags.includes(tag)) { setError('这个班级已经存在'); return; }
    onAdd(tag); setName(''); setError('');
  };

  return <main className="class-management">
    <div className="class-management__heading"><div><h2>班级管理</h2><p>班级创建后可用于大型考试、周测计划和设备绑定。</p></div></div>
    <section className="class-management__add" aria-label="添加班级">
      <label className="admin-label">班级名称<input className="admin-input" value={name} onChange={event => { setName(event.target.value); setError(''); }} onKeyDown={event => { if (event.key === 'Enter') submit(); }} placeholder="如：高三（1）班" /></label>
      <button className="admin-btn admin-btn--primary" onClick={submit}>添加班级</button>
      {error && <div className="admin-error">{error}</div>}
    </section>
    {classTags.length === 0 ? <div className="admin-empty"><p>还没有班级，先添加一个班级。</p></div> : <div className="class-management__list">
      {classTags.map(tag => { const count = usage.get(tag) ?? { plans: 0, exams: 0 }; const inUse = count.plans + count.exams > 0; return <article className="class-management__row" key={tag}>
        <div><strong>{tag}</strong><span>{count.plans} 个周测计划 · {count.exams} 个大型考试</span></div>
        <button className="admin-btn admin-btn--danger" disabled={inUse} title={inUse ? '请先移除关联的周测计划和大型考试班级设置' : '删除班级'} onClick={() => onRemove(tag)}>删除</button>
      </article>; })}
    </div>}
  </main>;
}
