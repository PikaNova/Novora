import React, { useMemo, useState } from 'react';
import type { MajorExam } from '../types';
import type { WeeklyPlan } from '../types/exam';
import type { SchoolClass, SchoolGrade } from '../types/school';
import { sortedClasses, sortedGrades } from '../utils/classSettings';

interface Props {
  grades: SchoolGrade[];
  classes: SchoolClass[];
  weeklyPlans: WeeklyPlan[];
  majors: MajorExam[];
  onAddGrade: (name: string) => void;
  onRemoveGrade: (id: string) => void;
  onAddClass: (gradeId: string, name: string) => void;
  onRemoveClass: (id: string) => void;
  readOnly?: boolean;
}

export default function ClassManagementPanel({ grades, classes, weeklyPlans, majors, onAddGrade, onRemoveGrade, onAddClass, onRemoveClass, readOnly = false }: Props) {
  const orderedGrades = useMemo(() => sortedGrades(grades), [grades]);
  const [selectedGradeId, setSelectedGradeId] = useState(orderedGrades[0]?.id ?? '');
  const [gradeName, setGradeName] = useState('');
  const [className, setClassName] = useState('');
  const selectedGrade = orderedGrades.find(item => item.id === selectedGradeId) ?? orderedGrades[0];
  const gradeId = selectedGrade?.id ?? '';
  const gradeClasses = sortedClasses(classes, gradeId);

  const addGrade = () => { const name = gradeName.trim(); if (!name) return; onAddGrade(name); setGradeName(''); };
  const addClass = () => { const name = className.trim(); if (!name || !gradeId) return; onAddClass(gradeId, name); setClassName(''); };
  const removeGrade = (id: string, name: string) => {
    const count = classes.filter(item => item.gradeId === id).length;
    if (!window.confirm(`删除“${name}”及其 ${count} 个班级？相关周测计划和考试范围也会一并清理。`)) return;
    onRemoveGrade(id);
    setSelectedGradeId(orderedGrades.find(item => item.id !== id)?.id ?? '');
  };
  const removeClass = (id: string, name: string) => {
    const plans = weeklyPlans.filter(item => item.classId === id).length;
    const exams = majors.filter(item => item.targetClassIds?.includes(id)).length;
    if (!window.confirm(`删除“${name}”？${plans || exams ? `将同步清理 ${plans} 个周测计划和 ${exams} 个考试范围引用。` : ''}`)) return;
    onRemoveClass(id);
  };

  return <main className="class-management">
    <div className="device-status__heading"><div><h2>年级与班级</h2><p>{readOnly ? '当前账号可以查看学校结构，但不能增删年级或班级。' : '先建立年级，再在年级下管理班级。客户端将按两级选项完成绑定。'}</p></div></div>
    {!readOnly && <div className="class-management__add"><input className="admin-input" value={gradeName} onChange={event => setGradeName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addGrade(); }} placeholder="如：高三" /><button className="admin-btn admin-btn--primary" onClick={addGrade}>添加年级</button></div>}
    {orderedGrades.length === 0 ? <div className="admin-empty"><p>首次使用请先添加年级。</p></div> : <>
      <div className="device-status__toolbar"><label><span>当前年级</span><select className="admin-input" value={gradeId} onChange={event => setSelectedGradeId(event.target.value)}>{orderedGrades.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{!readOnly && <button className="admin-btn admin-btn--danger" onClick={() => removeGrade(gradeId, selectedGrade.name)}>删除年级</button>}</div>
      {!readOnly && <div className="class-management__add"><input className="admin-input" value={className} onChange={event => setClassName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addClass(); }} placeholder="如：1班" /><button className="admin-btn admin-btn--primary" onClick={addClass}>添加班级</button></div>}
      {gradeClasses.length === 0 ? <div className="admin-empty"><p>当前年级还没有班级。</p></div> : <div className="class-management__list">{gradeClasses.map(item => <article className="class-management__row" key={item.id}><div><strong>{item.name}</strong><span>{weeklyPlans.filter(plan => plan.classId === item.id).length} 个周测计划</span></div>{!readOnly && <button className="admin-btn admin-btn--danger" onClick={() => removeClass(item.id, item.name)}>删除</button>}</article>)}</div>}
    </>}
  </main>;
}
