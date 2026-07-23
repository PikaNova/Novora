import React from 'react';
import type { DesignProps, ExamViewModel } from './types';
import { getSyncStatus } from '../utils/syncStatus';
import FitText from '../components/FitText';
import './DarkDesigns.css';

type Variant = 'quartz' | 'cinema';
const title=(v:ExamViewModel)=>v.phase==='empty'?'暂未配置考试安排':v.phase==='before'?(v.currentName?`距 ${v.currentName} 开考`:'下一科待定'):v.phase==='ended'?(v.currentName?`${v.currentName} 已结束`:'今日考试已全部结束'):(v.currentName??'考试进行中');
const pct=(v:ExamViewModel)=>v.phase==='ended'?100:v.phase==='live'?Math.max(0,Math.min(100,v.progressPct)):0;
function Controls(p:Pick<DesignProps,'onBack'|'onOpenAnnouncements'|'onSwitchDesign'|'onAdmin'|'isFullscreen'|'onToggleFullscreen'>){return <div className="nd-actions"><button onClick={p.onBack} aria-label="返回">←</button><button onClick={p.onOpenAnnouncements} aria-label="公告">📢</button><button onClick={p.onSwitchDesign} aria-label="切换设计">▣</button><button onClick={p.onToggleFullscreen} aria-label={p.isFullscreen ? '退出全屏' : '进入全屏'} title={p.isFullscreen ? '退出全屏' : '进入全屏'}>{p.isFullscreen ? '✕' : '⛶'}</button><button onClick={p.onAdmin} aria-label="管理">⚙</button></div>}
function DarkDesign({variant,...p}:DesignProps&{variant:Variant}){const {vm,onDismissNotification}=p;const sync=getSyncStatus(vm.online,vm.timeSynced);const progress=pct(vm);const remaining=vm.phase==='live'?vm.remainingText:vm.countdownText;return <div className={`nd nd-${variant}`}>
<header className="nd-head"><div className="nd-brand">{variant==='quartz'?'EXAM MODE / 01':'EXAM ALERT SYSTEM'}</div><div className="nd-head-right"><span className={`nd-sync is-${sync.tone}`}>{sync.text}</span><Controls {...p}/></div></header>
{vm.notification&&<div className="nd-notice"><span>{vm.notification.icon}</span><span>{vm.notification.message}</span><button onClick={onDismissNotification} aria-label="关闭">×</button></div>}
<main className="nd-main"><section className="nd-primary"><FitText className="nd-subject">{title(vm)}</FitText><p className="nd-period">{vm.startHM&&vm.endHM?`${vm.startHM} — ${vm.endHM}`:vm.dateText}</p><FitText className="nd-clock">{vm.clock}</FitText><div className="nd-track"><i style={{width:`${progress}%`}}/></div><div className="nd-track-meta"><span>当前进度 {Math.round(progress)}%</span><span>{vm.phase==='live'?`剩余 ${vm.remainingText}`:`距开考 ${vm.countdownText}`}</span></div></section>
<section className="nd-cards"><div><span>状态</span><b>{vm.phase==='live'?'进行中':vm.phase==='before'?'候考中':vm.phase==='ended'?'已结束':'待配置'}</b></div><div><span>下一科</span><b>{vm.nextName?`${vm.nextName}${vm.nextStartHM?` · ${vm.nextStartHM}`:''}`:'暂无下一科'}</b></div><div><span>{vm.phase==='before'?'距开考':'剩余时间'}</span><b className="nd-card-number">{remaining}</b></div></section></main></div>}
export const NeonQuartz=(p:DesignProps)=><DarkDesign variant="quartz" {...p}/>;
export const CinemaRedline=(p:DesignProps)=><DarkDesign variant="cinema" {...p}/>;
