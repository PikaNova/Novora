import React from 'react';
import type { DesignProps } from './types';
import { getSyncStatus } from '../utils/syncStatus';
import FitText from '../components/FitText';
import './CleanFocus.css';

const SEGMENTS = 20;

/** 方案 02 · 清爽聚焦 — 白底、考试蓝、低压力，适合明亮教室与投影。 */
export default function CleanFocus({ vm, onDismissNotification, onBack, onAdmin, onOpenAnnouncements, onSwitchDesign, isFullscreen, onToggleFullscreen }: DesignProps) {
  const {
    masterTitle, phase, clock, dateText, currentName, startHM, endHM,
    progressPct, elapsedText, remainingText, countdownText,
    nextName, nextStartHM, urgency, timeSynced, online, notification,
  } = vm;

  const filled = phase === 'ended' ? SEGMENTS
    : phase === 'before' ? 0
    : Math.round((progressPct / 100) * SEGMENTS);
  const remainWarn = urgency !== 'normal';
  const sync = getSyncStatus(online, timeSynced);

  const headline = phase === 'empty' ? '暂未配置考试安排'
    : phase === 'before' ? (currentName ? `下一科 ${currentName}` : '下一科待定')
    : phase === 'ended' ? (currentName ? `${currentName} 考试已结束` : '今日考试已全部结束')
    : currentName ?? '';

  return (
    <div className={`cf cf--${phase}`}>
      <div className="cf__panel">
        <header className="cf__top">
          <div className="cf__top-left">
            <button className="cf__ghost" onClick={onBack} aria-label="返回">←</button>
            <span className="cf__master">{masterTitle || '考试看板'}</span>
          </div>
          <div className="cf__top-right">
            <span className={`cf__sync is-${sync.tone}`}>{sync.text}</span>
            <button className="cf__ghost" onClick={onOpenAnnouncements} aria-label="查看公告" title="系统公告">📢</button>
            <button className="cf__ghost" onClick={onSwitchDesign} aria-label="切换设计" title="切换展示设计">▣</button>
            <button className="cf__ghost" onClick={onToggleFullscreen} aria-label={isFullscreen ? '退出全屏' : '进入全屏'} title={isFullscreen ? '退出全屏' : '进入全屏'}>{isFullscreen ? '✕' : '⛶'}</button>
            <button className="cf__ghost" onClick={onAdmin} aria-label="管理">⚙</button>
          </div>
        </header>

        {notification && (
          <div className="cf__notify" role="status">
            <span>{notification.icon}</span><span>{notification.message}</span>
            <button onClick={onDismissNotification} aria-label="关闭">×</button>
          </div>
        )}

        <main className="cf__center">
          {phase !== 'empty' && <p className="cf__headline">{headline}</p>}
          {phase === 'live' && startHM && endHM && <p className="cf__period">{startHM} — {endHM}</p>}
          <FitText className="cf__clock">{clock}</FitText>
          <p className="cf__date">{dateText}</p>

          {phase !== 'empty' ? (
            <>
              <div className="cf__segments">
                {Array.from({ length: SEGMENTS }).map((_, i) => (
                  <span key={i} className={`cf__seg ${i < filled ? 'is-on' : ''}`} />
                ))}
              </div>
              <div className="cf__meta">
                <div><span className="cf__meta-k">开始</span><span className="cf__meta-v">{startHM ?? '—'}</span></div>
                <div><span className="cf__meta-k">结束</span><span className="cf__meta-v">{endHM ?? '—'}</span></div>
                <div><span className="cf__meta-k">{phase === 'before' ? '距开考' : '已进行'}</span><span className="cf__meta-v">{phase === 'before' ? countdownText : elapsedText}</span></div>
                <div><span className="cf__meta-k">剩余</span><span className={`cf__meta-v ${remainWarn ? 'is-warn' : ''}`}>{phase === 'live' ? remainingText : '—'}</span></div>
              </div>
              {phase === 'ended' && nextName && (
                <p className="cf__next">下一科目　<b>{nextName}</b>　{nextStartHM}</p>
              )}
              {phase === 'ended' && !nextName && <p className="cf__next">今日考试已全部结束</p>}
            </>
          ) : (
            <p className="cf__next">请在管理后台添加考试安排</p>
          )}
        </main>
      </div>
    </div>
  );
}
