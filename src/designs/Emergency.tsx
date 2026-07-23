import React from 'react';
import type { DesignProps } from './types';
import { getSyncStatus } from '../utils/syncStatus';
import FitText from '../components/FitText';
import './Emergency.css';

/** 方案 04 · 高对比应急 — 高亮 LED、远距离极速辨识，顶部状态条。 */
export default function Emergency({ vm, onDismissNotification, onBack, onAdmin, onOpenAnnouncements, onSwitchDesign, isFullscreen, onToggleFullscreen }: DesignProps) {
  const {
    masterTitle, phase, clock, dateText, currentName, startHM, endHM,
    progressPct, elapsedText, remainingText, countdownText,
    nextName, nextStartHM, urgency, timeSynced, online, notification,
  } = vm;

  const barState = phase === 'ended' ? 'ended'
    : phase === 'before' ? 'before'
    : urgency === 'critical' ? 'crit' : urgency === 'warn' ? 'warn' : 'calm';
  const barText = phase === 'empty' ? '待命 · 无排期'
    : phase === 'before' ? `距开考 ${countdownText}`
    : phase === 'ended' ? '考试已结束'
    : urgency === 'critical' ? `即将交卷 · 剩余 ${remainingText}`
    : urgency === 'warn' ? `接近结束 · 剩余 ${remainingText}`
    : '考试进行中';
  const sync = getSyncStatus(online, timeSynced);

  const cards: Array<{ k: string; v: string; tone?: string }> = [];
  if (phase !== 'empty') {
    cards.push({ k: '当前状态', v: phase === 'before' ? '候考中' : phase === 'ended' ? '已结束' : '进行中' });
    cards.push({ k: '关键提醒', v: phase === 'live' ? remainingText : phase === 'before' ? countdownText : (nextName ? countdownText : '今日结束'), tone: barState });
    if (phase !== 'before') cards.push({ k: '下一科目', v: nextName ? `${nextName}　${nextStartHM ?? ''}` : '无' });
  }

  return (
    <div className={`em em--${phase} em--${barState}`}>
      <div className={`em__bar em__bar--${barState}`}>{barText}</div>
      <div className="em__body">
        <header className="em__head">
          <div className="em__head-left">
            <button className="em__ghost" onClick={onBack} aria-label="返回">←</button>
            <div>
              <p className="em__sys">{masterTitle || '考试看板系统'}</p>
              {phase !== 'empty' && <p className="em__subject">{currentName ?? ''}{startHM && endHM ? `　${startHM}–${endHM}` : ''}</p>}
            </div>
          </div>
          <div className="em__head-right">
            <span className={`em__sync is-${sync.tone}`}>{sync.text}</span>
            <button className="em__ghost" onClick={onOpenAnnouncements} aria-label="查看公告" title="系统公告">📢</button>
            <button className="em__ghost" onClick={onSwitchDesign} aria-label="切换设计" title="切换展示设计">▣</button>
            <button className="em__ghost" onClick={onToggleFullscreen} aria-label={isFullscreen ? '退出全屏' : '进入全屏'} title={isFullscreen ? '退出全屏' : '进入全屏'}>{isFullscreen ? '✕' : '⛶'}</button>
            <button className="em__ghost" onClick={onAdmin} aria-label="管理">⚙</button>
          </div>
        </header>

        {notification && (
          <div className="em__notify" role="status">
            <span>{notification.icon}</span><span>{notification.message}</span>
            <button onClick={onDismissNotification} aria-label="关闭">×</button>
          </div>
        )}

        <FitText className="em__clock">{clock}</FitText>
        <p className="em__date">{dateText}</p>

        {phase !== 'empty' ? (
          <>
            <div className="em__track"><div className={`em__track-fill is-${barState}`} style={{ width: `${phase === 'ended' ? 100 : progressPct}%` }} /></div>
            <div className="em__track-meta">
              <span>当前进度 {Math.round(phase === 'ended' ? 100 : progressPct)}%</span>
              <span>{phase === 'live' ? `剩余 ${remainingText}` : phase === 'before' ? `距开考 ${countdownText}` : (nextName ? `下一场 ${countdownText}` : '今日结束')}</span>
            </div>
            <section className="em__cards">
              {cards.map((c, i) => (
                <div className={`em__card ${c.tone ? `em__card--${c.tone}` : ''}`} key={i}>
                  <p className="em__card-k">{c.k}</p><p className="em__card-v">{c.v}</p>
                </div>
              ))}
            </section>
          </>
        ) : (
          <p className="em__empty">暂未配置考试安排</p>
        )}
      </div>
    </div>
  );
}
