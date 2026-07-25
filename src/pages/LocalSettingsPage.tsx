import React, { useEffect, useState } from 'react';
import { ArrowLeft, MonitorCog, Palette, School, Type } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DESIGNS } from '../designs/registry';
import { saveDeviceBinding } from '../services/classBinding';
import { useExamSync } from '../hooks/useExamSync';
import { notify } from '../services/notify';
import { DEFAULT_TYPOGRAPHY, getAppSettings, updateAppSettings, updateExamSettings, updateMotionMode, type MotionMode, type TypographyFontId, type TypographySettings } from '../utils/appSettings';
import { getDesignId, setDesignId } from '../utils/designPref';
import { applyMotionSettings } from '../utils/motionSettings';
import { applyTypographySettings } from '../utils/typographySettings';
import '../styles/settings.css';
import ClassMultiPicker from '../components/ClassMultiPicker';

const FONT_OPTIONS: Array<{ value: TypographyFontId; label: string }> = [{value:'alibaba',label:'阿里巴巴普惠体 3'},{value:'sourceHan',label:'思源黑体'},{value:'smiley',label:'得意黑'},{value:'wenkai',label:'霞鹜文楷'},{value:'general',label:'General Sans'}];
const NUMERIC_OPTIONS: Array<{ value: TypographyFontId; label: string }> = [{value:'jbmono',label:'JetBrains Mono'},{value:'sourceHan',label:'思源黑体'},...FONT_OPTIONS.filter(item=>item.value!=='sourceHan')];

export default function LocalSettingsPage(){
  const navigate=useNavigate(); const initial=getAppSettings();
  const [dataVersion,setDataVersion]=useState(0);
  const {syncState,refresh}=useExamSync({onUpdate:()=>setDataVersion(value=>value+1)});
  const exam=getAppSettings().exam;
  const [gradeId,setGradeId]=useState(initial.exam.selectedGradeId); const [classId,setClassId]=useState(initial.exam.selectedClassId);
  const [design,setDesign]=useState(getDesignId()); const [motion,setMotion]=useState<MotionMode>(initial.general.motionMode); const [fonts,setFonts]=useState<TypographySettings>(initial.general.typography);
  useEffect(()=>{const latest=getAppSettings().exam;setGradeId(value=>latest.grades.some(item=>item.id===value)?value:latest.selectedGradeId);setClassId(value=>latest.classes.some(item=>item.id===value)?value:latest.selectedClassId)},[dataVersion]);
  const patchFont=(key:keyof TypographySettings,value:TypographyFontId)=>{const next={...fonts,[key]:value};setFonts(next);updateAppSettings(current=>({general:{...current.general,typography:next}}));applyTypographySettings(next)};
  const bind=async(value:string)=>{setClassId(value);updateExamSettings({selectedGradeId:gradeId,selectedClassId:value});if(value){await saveDeviceBinding(gradeId,value);notify('success','本机班级绑定已更新。')}};
  const classOptions=exam.classes.map(item=>({id:item.id,gradeId:item.gradeId,gradeName:exam.grades.find(grade=>grade.id===item.gradeId)?.name||'未知年级',className:item.name}));
  return <div className="set-page"><header className="set-header"><div className="set-header__left"><button className="set-back set-back--icon" onClick={()=>navigate(-1)} aria-label="返回"><ArrowLeft/></button><div><h1 className="set-title">本地设置</h1><small>仅影响当前设备，无需登录</small></div></div><MonitorCog/></header><main className="set-body">
    <section className="set-card"><div className="set-card__head"><h2 className="set-card__title"><School/>班级选择</h2>{!exam.grades.length && <button className="set-btn set-btn--ghost" onClick={()=>void refresh(true)}>{syncState==='syncing'?'正在同步…':'重新同步'}</button>}</div>{!exam.grades.length && <p className="set-card__lead">{syncState==='local'||syncState==='syncing'?'正在从云端获取年级和班级…':'暂时没有可选择的班级，请检查网络或由管理员完成初始化。'}</p>}<div className="set-row"><label className="set-label">年级</label><select className="set-input" value={gradeId} disabled={!exam.grades.length} onChange={event=>{setGradeId(event.target.value);setClassId('');updateExamSettings({selectedGradeId:event.target.value,selectedClassId:''})}}><option value="">请选择年级</option>{exam.grades.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="set-row set-row--picker"><label className="set-label">班级</label><ClassMultiPicker options={classOptions} gradeId={gradeId} selectedIds={classId?[classId]:[]} onChange={ids=>void bind(ids[0]||'')} disabled={!gradeId} single /></div></section>
    <section className="set-card"><div className="set-card__head"><h2 className="set-card__title"><Palette/>显示设置</h2></div><div className="set-row"><label className="set-label">大屏设计</label><select className="set-input" value={design} onChange={event=>{setDesign(event.target.value);setDesignId(event.target.value)}}>{DESIGNS.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="set-row"><label className="set-label">动效模式</label><select className="set-input" value={motion} onChange={event=>{const value=event.target.value as MotionMode;setMotion(value);updateMotionMode(value);applyMotionSettings(value)}}><option value="auto">跟随系统</option><option value="best-effects">最佳效果</option><option value="best-performance">最佳性能</option></select></div></section>
    <section className="set-card"><div className="set-card__head"><h2 className="set-card__title"><Type/>字体分区</h2><button className="set-btn set-btn--ghost" onClick={()=>{setFonts(DEFAULT_TYPOGRAPHY);updateAppSettings(current=>({general:{...current.general,typography:DEFAULT_TYPOGRAPHY}}));applyTypographySettings(DEFAULT_TYPOGRAPHY)}}>恢复默认</button></div><div className="set-font-grid">{([['navigation','导航与标签',FONT_OPTIONS],['display','展示标题',[{value:'design',label:'按设计默认'},...FONT_OPTIONS]],['content','动态内容',FONT_OPTIONS],['numeric','时钟与数字',NUMERIC_OPTIONS]] as Array<[keyof TypographySettings,string,Array<{value:TypographyFontId;label:string}>]>).map(([key,label,options])=><label className="set-font-field" key={key}><span>{label}</span><select className="set-input" value={fonts[key]} onChange={event=>patchFont(key,event.target.value as TypographyFontId)}>{options.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>)}</div></section>
  </main></div>;
}
