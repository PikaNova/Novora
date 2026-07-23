import React from 'react';
import type { DesignProps } from './types';
import { getSyncStatus } from '../utils/syncStatus';
import './Editorial.css';

/** 方案 05 · 编辑排版 — 三栏构图，朱红竖条 + 暖米白主区 + 深墨绿信息栏，秒数朱红。 */
export default function Editorial({ vm, onDismissNotification, onBack, onAdmin, onOpenAnnouncements, onSwitchDesign, isFullscreen, onToggleFullscreen }: DesignProps) {
  const {
    masterTitle, phase, clock, dateText, currentName, startHM, endHM,
    progressPct, elapsedText, remainingText, countdownText,
    nextName, nextStartHM, urgency, timeSynced, online, notification,
  } = vm;

  const hm = clock.slice(0, 5);
  const ss = clock.slice(5); // ":ss"
  const year = (dateText.match(/(\d{4})\./)?.[1]) ?? '';
  // 通用刊头：取当前大型考试标题（去空格转大写），非高考专属；无标题时回退 EXAM。
  const brand = (masterTitle || '').replace(/\s+/g, '').toUpperCase() || 'EXAM';
  const kickerBrand = year ? `${brand} / ${year}` : brand;

  const kicker = phase === 'before' ? `距 ${currentName ?? ''} 开考`
    : phase === 'ended' ? (currentName ? `${currentName} 已结束` : '今日已结束')
    : phase === 'empty' ? '暂未配置考试' : (currentName ?? '');
  const sync = getSyncStatus(online, timeSynced);

  return (
    <div className={`ed ed--${phase}`}>
      <div className="ed__rail" aria-hidden="true" />
      <div className="ed__main">
        <header className="ed__head">
          <div className="ed__head-left">
            <button className="ed__ghost" onClick={onBack} aria-label="返回">←</button>
          </div>
          <span className="ed__gaokao" title={kickerBrand}>{kickerBrand}</span>
          <div className="ed__head-actions">
            <button className="ed__ghost" onClick={onOpenAnnouncements} aria-label="查看公告" title="系统公告">📢</button>
            <button className="ed__ghost" onClick={onSwitchDesign} aria-label="切换设计" title="切换展示设计">▣</button>
            <button className="ed__ghost" onClick={onToggleFullscreen} aria-label={isFullscreen ? '退出全屏' : '进入全屏'} title={isFullscreen ? '退出全屏' : '进入全屏'}>{isFullscreen ? '✕' : '⛶'}</button>
            <button className="ed__ghost" onClick={onAdmin} aria-label="管理">⚙</button>
          </div>
        </header>

        <p className="ed__masthead">{masterTitle || '考试看板'}</p>

        {notification && (
          <div className="ed__notify" role="status">
            <span>{notification.icon}</span><span>{notification.message}</span>
            <button onClick={onDismissNotification} aria-label="关闭">×</button>
          </div>
        )}

        <div className="ed__clock">
          <span className="ed__hm">{hm}</span>
          {phase === 'ended'
            ? <span className="ed__ended">已结束</span>
            : <span className="ed__ss">{ss}</span>}
        </div>

        <div className="ed__rule" />
        <p className="ed__kicker">{kicker}</p>
        <p className="ed__period">
          {phase === 'live' && startHM && endHM ? `${startHM} — ${endHM}`
            : phase === 'before' ? `距开考 ${countdownText}`
            : dateText}
        </p>
      </div>

      <aside className="ed__side">
        <div className="ed__side-row">
          <span className="ed__side-k">考试日</span>
          <span className="ed__side-v">{dateText.split('·').pop()?.trim() || '—'}</span>
          <span className={`ed__side-sync is-${sync.tone}`}>{sync.text}</span>
        </div>
        {phase !== 'empty' && <>
          <div className="ed__side-row">
            <span className="ed__side-k">当前进度</span>
            <span className="ed__side-v ed__side-v--big">{Math.round(phase === 'ended' ? 100 : progressPct)}%</span>
          </div>
          <div className="ed__side-row">
            <span className="ed__side-k">{phase === 'before' ? '距开考' : '剩余时间'}</span>
            <span className={`ed__side-v ed__side-v--big ${urgency !== 'normal' ? 'is-warn' : ''}`}>{phase === 'live' ? remainingText : phase === 'before' ? countdownText : '—'}</span>
          </div>
          {phase !== 'before' && (
            <div className="ed__side-row">
              <span className="ed__side-k">下一科目</span>
              <span className="ed__side-v">{nextName ? `${nextName}　${nextStartHM ?? ''}` : '无'}</span>
            </div>
          )}
        </>}
        <div className="ed__side-foot">请保持安静 · 诚信应考</div>
      </aside>
    </div>
  );
}
