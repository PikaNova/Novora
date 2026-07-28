import React, { useEffect, useState } from 'react';
import { ArrowLeft, MonitorCog, Palette, School, Type } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DESIGNS } from '../designs/registry';
import { fetchOccupiedClassIds, saveDeviceBinding } from '../services/classBinding';
import { useExamSync } from '../hooks/useExamSync';
import { notify } from '../services/notify';
import { confirmDialog } from '../services/appDialog';
import { DEFAULT_TYPOGRAPHY, getAppSettings, updateAppSettings, updateExamSettings, updateMotionMode, type MotionMode, type TypographyFontId, type TypographySettings } from '../utils/appSettings';
import { getDesignId, setDesignId } from '../utils/designPref';
import { applyMotionSettings } from '../utils/motionSettings';
import { applyTypographySettings } from '../utils/typographySettings';
import '../styles/settings.css';
import ClassMultiPicker from '../components/ClassMultiPicker';
import InlineSelect from '../components/InlineSelect';

const FONT_OPTIONS: Array<{ value: TypographyFontId; label: string }> = [{value:'alibaba',label:'阿里巴巴普惠体 3'},{value:'sourceHan',label:'思源黑体'},{value:'smiley',label:'得意黑'},{value:'wenkai',label:'霞鹜文楷'},{value:'general',label:'General Sans'}];
const NUMERIC_OPTIONS: Array<{ value: TypographyFontId; label: string }> = [{value:'jbmono',label:'JetBrains Mono'},{value:'sourceHan',label:'思源黑体'},...FONT_OPTIONS.filter(item=>item.value!=='sourceHan')];

export default function LocalSettingsPage(){
  const navigate=useNavigate(); const initial=getAppSettings();
  const [dataVersion,setDataVersion]=useState(0);
  const {syncState,refresh}=useExamSync({onUpdate:()=>setDataVersion(value=>value+1)});
  const exam=getAppSettings().exam;
  const [gradeId,setGradeId]=useState(initial.exam.selectedGradeId); const [classId,setClassId]=useState(initial.exam.selectedClassId);
  const [occupiedClassIds,setOccupiedClassIds]=useState<string[]>([]); const [bindingClassId,setBindingClassId]=useState('');
  const [design,setDesign]=useState(getDesignId()); const [motion,setMotion]=useState<MotionMode>(initial.general.motionMode); const [fonts,setFonts]=useState<TypographySettings>(initial.general.typography);
  useEffect(()=>{const latest=getAppSettings().exam;setGradeId(value=>latest.grades.some(item=>item.id===value)?value:latest.selectedGradeId);setClassId(value=>latest.classes.some(item=>item.id===value)?value:latest.selectedClassId)},[dataVersion]);
  useEffect(()=>{let active=true;void fetchOccupiedClassIds().then(ids=>{if(active)setOccupiedClassIds(ids)}).catch(()=>{if(active)setOccupiedClassIds([])});return()=>{active=false}},[dataVersion]);
  const patchFont=(key:keyof TypographySettings,value:TypographyFontId)=>{const next={...fonts,[key]:value};setFonts(next);updateAppSettings(current=>({general:{...current.general,typography:next}}));applyTypographySettings(next)};
  const bind=async(value:string)=>{
    if(!value||bindingClassId)return;
    setBindingClassId(value);
    try{
      let replaceExisting=occupiedClassIds.includes(value);
      if(replaceExisting&&!(await confirmDialog({title:'该班级已绑定其他设备',message:'继续后将解除原考试端及其 ClassIsland 配对，并将当前设备设为该班级的新考试端。',tone:'warning',confirmLabel:'解除旧设备并绑定本机'})))return;
      let result=await saveDeviceBinding(gradeId,value,replaceExisting);
      if(!result.ok&&result.conflict&&!replaceExisting){replaceExisting=await confirmDialog({title:'该班级已绑定其他设备',message:'继续后将解除原考试端及其 ClassIsland 配对，并将当前设备设为该班级的新考试端。',tone:'warning',confirmLabel:'解除旧设备并绑定本机'});if(!replaceExisting)return;result=await saveDeviceBinding(gradeId,value,true)}
      if(!result.ok){notify('error',result.error);return}
      setClassId(value);updateExamSettings({selectedGradeId:gradeId,selectedClassId:value});setOccupiedClassIds(ids=>ids.filter(id=>id!==value));notify('success',result.replaced?'已解除旧设备并将本机绑定为新的班级考试端。':'本机已切换为该班级考试端。')
    }finally{setBindingClassId('')}
  };
  const classOptions=exam.classes.map(item=>({id:item.id,gradeId:item.gradeId,gradeName:exam.grades.find(grade=>grade.id===item.gradeId)?.name||'未知年级',className:item.name,statusLabel:occupiedClassIds.includes(item.id)?'已绑定':undefined}));
  return <div className="set-page"><header className="set-header"><div className="set-header__left"><button className="set-back set-back--icon" onClick={()=>navigate(-1)} aria-label="返回"><ArrowLeft/></button><div><h1 className="set-title">本地设置</h1><small>仅影响当前设备，无需登录</small></div></div><MonitorCog/></header><main className="set-body">
    <section className="set-card"><div className="set-card__head"><h2 className="set-card__title"><School/>班级选择</h2>{!exam.grades.length && <button className="set-btn set-btn--ghost" onClick={()=>void refresh(true)}>{syncState==='syncing'?'正在同步…':'重新同步'}</button>}</div>{!exam.grades.length && <p className="set-card__lead">{syncState==='local'||syncState==='syncing'?'正在从云端获取年级和班级…':'暂时没有可选择的班级，请检查网络或由管理员完成初始化。'}</p>}<div className="set-row"><label className="set-label">年级</label><InlineSelect className="set-input" value={gradeId} disabled={!exam.grades.length} onChange={value=>{setGradeId(value);setClassId('');updateExamSettings({selectedGradeId:value,selectedClassId:''})}} options={[{value:'',label:'请选择年级'},...exam.grades.map(item=>({value:item.id,label:item.name}))]} /></div><div className="set-row set-row--picker"><label className="set-label">班级</label><ClassMultiPicker options={classOptions} gradeId={gradeId} selectedIds={bindingClassId?[bindingClassId]:classId?[classId]:[]} onChange={ids=>void bind(ids[0]||'')} disabled={!gradeId||Boolean(bindingClassId)} single /></div></section>
    <section className="set-card"><div className="set-card__head"><h2 className="set-card__title"><Palette/>显示设置</h2></div><div className="set-row"><label className="set-label">大屏设计</label><InlineSelect className="set-input" value={design} onChange={value=>{setDesign(value);setDesignId(value)}} options={DESIGNS.map(item=>({value:item.id,label:item.name}))} /></div><div className="set-row"><label className="set-label">动效模式</label><InlineSelect className="set-input" value={motion} onChange={value=>{const next=value as MotionMode;setMotion(next);updateMotionMode(next);applyMotionSettings(next)}} options={[{value:'auto',label:'跟随系统'},{value:'best-effects',label:'最佳效果'},{value:'best-performance',label:'最佳性能'}]} /></div></section>
    <section className="set-card"><div className="set-card__head"><h2 className="set-card__title"><Type/>字体分区</h2><button className="set-btn set-btn--ghost" onClick={()=>{setFonts(DEFAULT_TYPOGRAPHY);updateAppSettings(current=>({general:{...current.general,typography:DEFAULT_TYPOGRAPHY}}));applyTypographySettings(DEFAULT_TYPOGRAPHY)}}>恢复默认</button></div><div className="set-font-grid">{([['navigation','导航与标签',FONT_OPTIONS],['display','展示标题',[{value:'design',label:'按设计默认'},...FONT_OPTIONS]],['content','动态内容',FONT_OPTIONS],['numeric','时钟与数字',NUMERIC_OPTIONS]] as Array<[keyof TypographySettings,string,Array<{value:TypographyFontId;label:string}>]>).map(([key,label,options])=><label className="set-font-field" key={key}><span>{label}</span><InlineSelect className="set-input" value={fonts[key]} onChange={value=>patchFont(key,value as TypographyFontId)} options={options.map(item=>({value:item.value,label:item.label}))} /></label>)}</div></section>
  </main></div>;
}
