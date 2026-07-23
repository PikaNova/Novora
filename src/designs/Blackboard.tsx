import React from 'react';
import type { DesignProps } from './types';
import { getSyncStatus } from '../utils/syncStatus';
import FitText from '../components/FitText';
import './Blackboard.css';

/** 方案 03 · 校园黑板 — 黑板绿 + 暖白，中央圆形进度环。 */
export default function Blackboard({ vm, onDismissNotification, onBack, onAdmin, onOpenAnnouncements, onSwitchDesign, isFullscreen, onToggleFullscreen }: DesignProps) {
  const {
    masterTitle, phase, clock, dateText, currentName, startHM, endHM,
    progressPct, elapsedText, remainingText, countdownText,
    nextName, nextStartHM, urgency, timeSynced, online, notification,
  } = vm;

  const pct = phase === 'ended' ? 100 : phase === 'before' ? 0 : Math.round(progressPct);
  const ringColor = phase === 'ended' ? '#72bc8f' : 'var(--yellow)';
  const centerLabel = phase === 'before' ? '距开考' : phase === 'ended' ? '已结束' : '当前进度';
  const centerValue = phase === 'live' ? `${pct}%` : phase === 'before' ? countdownText : phase === 'ended' ? '✓' : '—';
  const remindClass = urgency === 'critical' ? 'is-crit' : urgency === 'warn' ? 'is-warn' : '';
  const sync = getSyncStatus(online, timeSynced);

  return (
    <div className={`bb bb--${phase}`}>
      <div className="bb__frame">
        <header className="bb__top">
          <button className="bb__ghost" onClick={onBack} aria-label="返回">←</button>
          <div className="bb__title-col">
            <span className="bb__master">{masterTitle || '考试看板'}</span>
            {phase !== 'empty' && <span className="bb__subject">{currentName ?? ''}</span>}
          </div>
          <div className="bb__top-right">
            <span className={`bb__sync is-${sync.tone}`}>{sync.text}</span>
            <button className="bb__ghost" onClick={onOpenAnnouncements} aria-label="查看公告" title="系统公告">📢</button>
            <button className="bb__ghost" onClick={onSwitchDesign} aria-label="切换设计" title="切换展示设计">▣</button>
            <button className="bb__ghost" onClick={onToggleFullscreen} aria-label={isFullscreen ? '退出全屏' : '进入全屏'} title={isFullscreen ? '退出全屏' : '进入全屏'}>{isFullscreen ? '✕' : '⛶'}</button>
            <button className="bb__ghost" onClick={onAdmin} aria-label="管理">⚙</button>
          </div>
        </header>

        <FitText className="bb__clock">{clock}</FitText>
        <p className="bb__date">{dateText}</p>

        {notification && (
          <div className="bb__notify" role="status">
            <span>{notification.icon}</span><span>{notification.message}</span>
            <button onClick={onDismissNotification} aria-label="关闭">×</button>
          </div>
        )}

        {phase !== 'empty' ? (
          <div className="bb__lower">
            <div className="bb__side bb__side--left">
              <div><span className="bb__k">时段</span><span className="bb__v">{startHM && endHM ? `${startHM}–${endHM}` : '—'}</span></div>
              <div><span className="bb__k">已进行</span><span className="bb__v">{phase === 'live' ? elapsedText : '—'}</span></div>
              <div><span className="bb__k">剩余</span><span className={`bb__v ${remindClass}`}>{phase === 'live' ? remainingText : '—'}</span></div>
            </div>

            <div className="bb__ring" style={{ ['--pct' as any]: pct, ['--ring' as any]: ringColor }}>
              <div className="bb__ring-inner">
                <span className="bb__ring-label">{centerLabel}</span>
                <span className="bb__ring-value">{centerValue}</span>
              </div>
            </div>

            <div className="bb__side bb__side--right">
              <div><span className="bb__k">温馨提醒</span><span className={`bb__v bb__remind ${remindClass}`}>{urgency === 'critical' ? '即将交卷，请检查' : urgency === 'warn' ? '接近结束，合理安排' : '保持安静 · 诚信应考'}</span></div>
              {phase !== 'before' && (<div><span className="bb__k">下一科目</span><span className="bb__v">{nextName ? `${nextName}　${nextStartHM ?? ''}` : '无'}</span></div>)}
            </div>
          </div>
        ) : (
          <p className="bb__empty">暂未配置考试安排</p>
        )}
      </div>
    </div>
  );
}
