import React, { useEffect, useState } from 'react';
import type { AlertState } from '../types';
import type { AlertOverlayItem } from '../hooks/useAlertOverlay';
import '../styles/exam-alert-overlay.css';
import FitText from './FitText';

interface Props {
  item: AlertOverlayItem | null;
  now: number;
  designId: string;
  masterTitle: string;
  timeSynced: boolean;
}

type ThemeKey = 'cmd' | 'clean' | 'chalk' | 'emg' | 'edit' | 'sunrise' | 'palette' | 'orbit' | 'peach' | 'poster' | 'ice' | 'quartz' | 'cinema';
type Variant = 'centered' | 'emergency' | 'editorial';

const DESIGN_TO_THEME: Record<string, { theme: ThemeKey; variant: Variant }> = {
  'command-deck': { theme: 'cmd', variant: 'centered' },
  'clean-focus': { theme: 'clean', variant: 'centered' },
  'blackboard': { theme: 'chalk', variant: 'centered' },
  'emergency': { theme: 'emg', variant: 'emergency' },
  'editorial': { theme: 'edit', variant: 'editorial' },
  'sunrise-schedule': { theme: 'sunrise', variant: 'centered' },
  'palette-dashboard': { theme: 'palette', variant: 'centered' },
  'orbit-focus': { theme: 'orbit', variant: 'centered' },
  'peach-task-board': { theme: 'peach', variant: 'centered' },
  'poster-grid': { theme: 'poster', variant: 'centered' },
  'ice-columns': { theme: 'ice', variant: 'centered' },
  'neon-quartz': { theme: 'quartz', variant: 'centered' },
  'cinema-redline': { theme: 'cinema', variant: 'centered' },
};

// 各主题下的语义色（accent 主色 / soft 浅底）
const TONES: Record<ThemeKey, Record<AlertState, { accent: string; soft?: string }>> = {
  cmd: {
    '15min': { accent: '#ffca65' }, 'end15': { accent: '#ffca65' },
    '5min': { accent: '#ff7c70' }, 'start': { accent: '#5fe2a6' },
    'ended': { accent: '#8fb0d6' }, 'next': { accent: '#a78bfa' },
  },
  clean: {
    '15min': { accent: '#d38b2f', soft: '#fbf1e2' }, 'end15': { accent: '#d38b2f', soft: '#fbf1e2' },
    '5min': { accent: '#d0483a', soft: '#fbe7e4' }, 'start': { accent: '#146eb4', soft: '#e6f4ff' },
    'ended': { accent: '#2f7d59', soft: '#e5f1ea' }, 'next': { accent: '#6b57b8', soft: '#efe9f8' },
  },
  chalk: {
    '15min': { accent: '#f7e59b' }, 'end15': { accent: '#f7e59b' },
    '5min': { accent: '#f0a763' }, 'start': { accent: '#8fdca9' },
    'ended': { accent: '#b9d3c5' }, 'next': { accent: '#e6c98a' },
  },
  emg: {
    '15min': { accent: '#de9255' }, 'end15': { accent: '#de9255' },
    '5min': { accent: '#e7473d' }, 'start': { accent: '#46a171' },
    'ended': { accent: '#6b7580' }, 'next': { accent: '#4b90c4' },
  },
  edit: {
    '15min': { accent: '#c98a2b' }, 'end15': { accent: '#c98a2b' },
    '5min': { accent: '#d8422b' }, 'start': { accent: '#2f7d59' },
    'ended': { accent: '#565b58' }, 'next': { accent: '#6b57b8' },
  },
  sunrise: { '15min':{accent:'#d58b25',soft:'#fff1ca'},'end15':{accent:'#d58b25',soft:'#fff1ca'},'5min':{accent:'#d95048',soft:'#fde8e5'},start:{accent:'#2b9bcb',soft:'#e2f5ff'},ended:{accent:'#66869d',soft:'#e7f0f5'},next:{accent:'#6670bd',soft:'#e9eaff'} },
  palette: { '15min':{accent:'#d7832d',soft:'#fff0d7'},'end15':{accent:'#d7832d',soft:'#fff0d7'},'5min':{accent:'#d85148',soft:'#fbe7e4'},start:{accent:'#258f82',soft:'#dcf6ef'},ended:{accent:'#70849a',soft:'#eaf0f5'},next:{accent:'#6c64c0',soft:'#eeebff'} },
  orbit: { '15min':{accent:'#ce8b29',soft:'#fff2d4'},'end15':{accent:'#ce8b29',soft:'#fff2d4'},'5min':{accent:'#cf5850',soft:'#fde9e6'},start:{accent:'#23806e',soft:'#dff4ec'},ended:{accent:'#587a80',soft:'#e7f2f0'},next:{accent:'#536fc5',soft:'#e8eeff'} },
  peach: { '15min':{accent:'#d77d42',soft:'#fff0e7'},'end15':{accent:'#d77d42',soft:'#fff0e7'},'5min':{accent:'#d85650',soft:'#fde8e6'},start:{accent:'#478f82',soft:'#e0f3ed'},ended:{accent:'#717a8a',soft:'#eef0f4'},next:{accent:'#637cc9',soft:'#eceeff'} },
  poster: { '15min':{accent:'#d39a22',soft:'#fff3c8'},'end15':{accent:'#d39a22',soft:'#fff3c8'},'5min':{accent:'#df5b46',soft:'#ffeae4'},start:{accent:'#278f85',soft:'#ddf3ef'},ended:{accent:'#5c7483',soft:'#eaf0f4'},next:{accent:'#5e67bd',soft:'#ececff'} },
  ice: { '15min':{accent:'#d48335',soft:'#fff0db'},'end15':{accent:'#d48335',soft:'#fff0db'},'5min':{accent:'#db6254',soft:'#ffe9e5'},start:{accent:'#2585a8',soft:'#e1f5ff'},ended:{accent:'#668293',soft:'#eaf1f6'},next:{accent:'#5c71c2',soft:'#e9edff'} },
  quartz: { '15min':{accent:'#f0be5b'},'end15':{accent:'#f0be5b'},'5min':{accent:'#ff6b9d'},start:{accent:'#35e5dc'},ended:{accent:'#9aa4bf'},next:{accent:'#9d87ff'} },
  cinema: { '15min':{accent:'#f2a34d'},'end15':{accent:'#f2a34d'},'5min':{accent:'#f05b55'},start:{accent:'#6bd6a4'},ended:{accent:'#aab0b8'},next:{accent:'#a58cff'} },
};

const EN_LABEL: Record<AlertState, string> = {
  '15min': 'NOTICE', '5min': 'NOTICE', 'start': 'NOW', 'end15': 'NOTICE', 'ended': 'FINISH', 'next': 'NEXT',
};

const pad2 = (n: number) => String(n).padStart(2, '0');
function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

function heroSizeClass(text: string): string {
  const len = [...text].length;
  if (len <= 5) return 'eao-hero--xl';
  if (len <= 8) return 'eao-hero--lg';
  return 'eao-hero--md';
}

export default function ExamAlertOverlay({ item, now, designId, masterTitle, timeSynced }: Props) {
  const [visible, setVisible] = useState(false);

  // 淡入 / 淡出
  useEffect(() => {
    if (item) { const t = setTimeout(() => setVisible(true), 20); return () => clearTimeout(t); }
    setVisible(false);
  }, [item?.key]);

  if (!item) return null;

  const map = DESIGN_TO_THEME[designId] ?? DESIGN_TO_THEME['command-deck'];
  const tone = TONES[map.theme][item.tone] ?? TONES[map.theme]['15min'];
  const hero = item.countdownTo != null ? fmtCountdown(item.countdownTo - now) : (item.hero ?? '');
  const syncText = timeSynced ? '已校时同步' : '未校时';
  const year = new Date(now).getFullYear();
  const brand = (masterTitle || '').replace(/\s+/g, '').toUpperCase() || 'EXAM';

  const styleVars = {
    ['--accent' as any]: tone.accent,
    ['--soft' as any]: tone.soft ?? 'transparent',
  } as React.CSSProperties;

  const rootCls = `eao eao--${map.theme} eao--${map.variant}${visible ? ' is-visible' : ''}`;

  // ——— 高对比应急（上下色条） ———
  if (map.variant === 'emergency') {
    return (
      <div className={rootCls} style={styleVars} role="alert" aria-live="assertive">
        <div className="eao-emg-bar eao-emg-bar--top">
          <span className="eao-emg-brand">EXAM ALERT · {masterTitle || '考试提醒'}</span>
          <span className="eao-emg-label">{item.label}</span>
        </div>
        <div className="eao-emg-body">
          <FitText className="eao-title">{item.title}</FitText>
          <FitText className={`eao-hero ${heroSizeClass(hero)}`}>{hero}</FitText>
          {item.examLine && <FitText className="eao-examline">{item.examLine}</FitText>}
        </div>
        <div className="eao-emg-bar eao-emg-bar--bottom">
          <FitText as="span" className="eao-emg-sub">{item.subtext}</FitText>
        </div>
      </div>
    );
  }

  // ——— 编辑排版（左对齐） ———
  if (map.variant === 'editorial') {
    return (
      <div className={rootCls} style={styleVars} role="alert" aria-live="assertive">
        <div className="eao-edit-rail eao-edit-rail--left" aria-hidden="true" />
        <div className="eao-edit-main">
          <FitText className="eao-edit-kicker">{brand} / {year}</FitText>
          <FitText className="eao-edit-en">{EN_LABEL[item.tone]} / {item.label}</FitText>
          <FitText className="eao-title">{item.title}</FitText>
          <FitText className={`eao-hero ${heroSizeClass(hero)}`}>{hero}</FitText>
          <div className="eao-edit-line" aria-hidden="true" />
          {item.examLine && <FitText className="eao-examline">{item.examLine}</FitText>}
          {item.subtext && <FitText className="eao-edit-sub">{item.subtext}</FitText>}
        </div>
        <div className="eao-edit-rail eao-edit-rail--right" aria-hidden="true">
          <span className="eao-edit-vtext">{EN_LABEL[item.tone]}</span>
        </div>
      </div>
    );
  }

  // ——— 居中类（深色指挥舱 / 清爽聚焦 / 校园黑板） ———
  const showBrackets = map.theme === 'chalk';
  return (
    <div className={rootCls} style={styleVars} role="alert" aria-live="assertive">
      {map.theme === 'cmd' && <><span className="eao-side eao-side--l" /><span className="eao-side eao-side--r" /></>}
      <div className="eao-topbar">
        <span className="eao-master">{masterTitle || '考试提醒'}</span>
        <span className={`eao-sync${timeSynced ? ' is-ok' : ''}`}><span className="eao-sync-dot" />{syncText}</span>
      </div>
      <div className="eao-center">
        <span className="eao-capsule">{showBrackets ? `【 ${item.label} 】` : item.label}</span>
        <FitText className="eao-title">{item.title}</FitText>
        <FitText className={`eao-hero ${heroSizeClass(hero)}`}>{hero}</FitText>
        <div className="eao-divider" aria-hidden="true" />
        {item.examLine && <FitText className="eao-examline">{item.examLine}</FitText>}
      </div>
      {item.subtext && <div className="eao-subbar"><span>{item.subtext}</span></div>}
    </div>
  );
}
