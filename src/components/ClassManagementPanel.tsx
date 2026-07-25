import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MajorExam } from '../types';
import type { WeeklyPlan } from '../types/exam';
import type { SchoolClass, SchoolGrade } from '../types/school';
import { sortedClasses, sortedGrades } from '../utils/classSettings';
import { confirmDialog } from '../services/appDialog';

interface Props {
  grades: SchoolGrade[];
  classes: SchoolClass[];
  weeklyPlans: WeeklyPlan[];
  majors: MajorExam[];
  onAddGrade: (name: string) => void;
  onRemoveGrade: (id: string) => void;
  onAddClass: (gradeId: string, name: string) => void;
  onAddClasses: (gradeId: string, names: string[]) => void;
  onRemoveClass: (id: string) => void;
  onRemoveClasses: (ids: string[]) => void;
  canManageGrades?: boolean;
  canManageClasses?: boolean;
}

export default function ClassManagementPanel({ grades, classes, weeklyPlans, majors, onAddGrade, onRemoveGrade, onAddClass, onAddClasses, onRemoveClass, onRemoveClasses, canManageGrades = false, canManageClasses = false }: Props) {
  const readOnly = !canManageGrades && !canManageClasses;
  const orderedGrades = useMemo(() => sortedGrades(grades), [grades]);
  const [selectedGradeId, setSelectedGradeId] = useState(orderedGrades[0]?.id ?? '');
  const [gradeName, setGradeName] = useState('');
  const [className, setClassName] = useState('');
  const [bulkCount, setBulkCount] = useState('10');
  const [rangeStart, setRangeStart] = useState('1');
  const [rangeEnd, setRangeEnd] = useState('10');
  const [query, setQuery] = useState('');
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [pendingGradeName, setPendingGradeName] = useState('');
  const bulkCountRef = useRef<HTMLInputElement>(null);
  const selectedGrade = orderedGrades.find(item => item.id === selectedGradeId) ?? orderedGrades[0];
  const gradeId = selectedGrade?.id ?? '';
  const gradeClasses = sortedClasses(classes, gradeId);
  const visibleGradeClasses = gradeClasses.filter(item => !query.trim() || item.name.toLowerCase().includes(query.trim().toLowerCase()));

  const addGrade = () => { const name = gradeName.trim(); if (!name) return; setPendingGradeName(name); onAddGrade(name); setGradeName(''); };
  useEffect(() => { if (!pendingGradeName) return; const created=[...orderedGrades].reverse().find(item=>item.name===pendingGradeName); if(created){setSelectedGradeId(created.id);setPendingGradeName('');window.setTimeout(()=>{bulkCountRef.current?.focus();bulkCountRef.current?.select();},0);} }, [orderedGrades, pendingGradeName]);
  const addClass = () => { const name = className.trim(); if (!name || !gradeId) return; onAddClass(gradeId, name); setClassName(''); };
  const createClasses = () => { const count=Math.max(1,Math.min(99,Number(bulkCount)||10)); const existing=new Set(gradeClasses.map(item=>item.name)); onAddClasses(gradeId,Array.from({length:count},(_,index)=>`${index+1}班`).filter(name=>!existing.has(name))); };
  const createRange = () => { const start=Math.max(1,Math.min(999,Number(rangeStart)||1)); const end=Math.max(start,Math.min(999,Number(rangeEnd)||start)); const existing=new Set(gradeClasses.map(item=>item.name)); onAddClasses(gradeId,Array.from({length:end-start+1},(_,index)=>`${start+index}班`).filter(name=>!existing.has(name))); };
  const removeGrade = async (id: string, name: string) => {
    const count = classes.filter(item => item.gradeId === id).length;
    if (!await confirmDialog({ title: `删除“${name}”`, message: `将删除该年级及其 ${count} 个班级，相关周测计划和考试范围也会一并清理。`, tone: 'danger', confirmLabel: '删除年级' })) return;
    onRemoveGrade(id);
    setSelectedGradeId(orderedGrades.find(item => item.id !== id)?.id ?? '');
  };
  const removeClass = async (id: string, name: string) => {
    const plans = weeklyPlans.filter(item => item.classId === id).length;
    const exams = majors.filter(item => item.targetClassIds?.includes(id)).length;
    if (!await confirmDialog({ title: `删除“${name}”`, message: plans || exams ? `将同步清理 ${plans} 个周测计划和 ${exams} 个考试范围引用。` : '删除后该班级需要重新创建。', tone: 'danger', confirmLabel: '删除班级' })) return;
    onRemoveClass(id);
  };
  const removeSelected = async () => {
    if (!selectedClassIds.length) return;
    const plans = weeklyPlans.filter(item => selectedClassIds.includes(item.classId)).length;
    if (!await confirmDialog({ title: `删除 ${selectedClassIds.length} 个班级`, message: `将同步清理 ${plans} 个周测计划和相关考试范围引用。`, tone: 'danger', confirmLabel: '批量删除' })) return;
    onRemoveClasses(selectedClassIds);
    setSelectedClassIds([]);
  };

  return <main className="class-management">
    <div className="device-status__heading"><div><h2>年级与班级</h2><p>{readOnly ? '当前账号可以查看学校结构，但不能增删年级或班级。' : '先建立年级，再在年级下管理班级。客户端将按两级选项完成绑定。'}</p></div></div>
    {canManageGrades && <div className="class-management__add"><input className="admin-input" value={gradeName} onChange={event => setGradeName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addGrade(); }} placeholder="如：高三" /><button className="admin-btn admin-btn--primary" onClick={addGrade}>添加年级</button></div>}
    {orderedGrades.length === 0 ? <div className="admin-empty"><p>首次使用请先添加年级。</p></div> : <>
      <div className="device-status__toolbar"><label><span>当前年级</span><select className="admin-input" value={gradeId} onChange={event => { setSelectedGradeId(event.target.value); setSelectedClassIds([]); }}><option value="">请选择年级</option>{orderedGrades.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>搜索班级</span><input className="admin-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="输入班级名称" /></label>{canManageGrades && <button className="admin-btn admin-btn--danger" onClick={() => removeGrade(gradeId, selectedGrade.name)}>删除年级</button>}</div>
      {canManageClasses && <><div className="admin-info-banner">{pendingGradeName ? `已新建 ${pendingGradeName}，请继续设置班级数量。` : canManageGrades ? '支持从 1 班开始生成，也可指定任意编号区间。' : '当前账号可管理授权年级下的班级，但不能增删年级。'}</div><div className="class-management__add"><input ref={bulkCountRef} className="admin-input" type="number" min="1" max="99" value={bulkCount} onChange={event=>setBulkCount(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')createClasses();}} aria-label="快速创建班级数量"/><button className="admin-btn admin-btn--primary" onClick={createClasses}>生成 1班至{Math.max(1,Number(bulkCount)||10)}班</button></div><div className="class-management__add class-management__range"><input className="admin-input" type="number" min="1" max="999" value={rangeStart} onChange={event=>setRangeStart(event.target.value)} aria-label="起始班级编号"/><span>至</span><input className="admin-input" type="number" min="1" max="999" value={rangeEnd} onChange={event=>setRangeEnd(event.target.value)} aria-label="结束班级编号"/><button className="admin-btn" onClick={createRange}>按编号区间创建</button></div><div className="class-management__add"><input className="admin-input" value={className} onChange={event => setClassName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addClass(); }} placeholder="如：实验班" /><button className="admin-btn" onClick={addClass}>单独添加班级</button></div></>}
      {gradeClasses.length === 0 ? <div className="admin-empty"><p>当前年级还没有班级。</p></div> : <><div className="class-management__batch"><label><input type="checkbox" checked={visibleGradeClasses.length > 0 && visibleGradeClasses.every(item => selectedClassIds.includes(item.id))} onChange={event => setSelectedClassIds(event.target.checked ? [...new Set([...selectedClassIds, ...visibleGradeClasses.map(item => item.id)])] : selectedClassIds.filter(id => !visibleGradeClasses.some(item => item.id === id)))} />选择当前结果</label><span>已选择 {selectedClassIds.length} 个</span>{canManageClasses && <button className="admin-btn admin-btn--danger" disabled={!selectedClassIds.length} onClick={removeSelected}>批量删除</button>}</div><div className="class-management__list">{visibleGradeClasses.map(item => <article className="class-management__row" key={item.id}>{canManageClasses && <input type="checkbox" checked={selectedClassIds.includes(item.id)} onChange={event => setSelectedClassIds(value => event.target.checked ? [...value, item.id] : value.filter(id => id !== item.id))} aria-label={`选择${item.name}`} />}<div><strong>{item.name}</strong><span>{weeklyPlans.filter(plan => plan.classId === item.id).length} 个周测计划</span></div>{canManageClasses && <button className="admin-btn admin-btn--danger" onClick={() => removeClass(item.id, item.name)}>删除</button>}</article>)}</div></>}
    </>}
  </main>;
}
