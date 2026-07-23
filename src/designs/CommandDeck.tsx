import React from 'react';
import type { DesignProps } from './types';
import { getSyncStatus } from '../utils/syncStatus';
import FitText from '../components/FitText';
import './CommandDeck.css';

/**
 * 方案 01 · 深色指挥舱
 * 默认推荐方案：多教室电视、监考室、中控 LED。
 */
export default function CommandDeck({ vm, onDismissNotification, onBack, onAdmin, onOpenAnnouncements, onSwitchDesign, isFullscreen, onToggleFullscreen }: DesignProps) {
  const {
    masterTitle, phase, clock, dateText, currentName, startHM, endHM,
    progressPct, elapsedText, remainingText, countdownText,
    nextName, nextStartHM, urgency, timeSynced, online, notification,
  } = vm;

  const urgencyClass = `cd cd--${phase} cd--${urgency}`;
  const sync = getSyncStatus(online, timeSynced);

  const headline = () => {
    if (phase === 'empty') return '暂未配置考试安排';
    if (phase === 'before') return currentName ? `下一科 ${currentName}` : '下一科待定';
    if (phase === 'ended') return currentName ? `${currentName} 考试已结束` : '今日考试已全部结束';
    return currentName ?? '';
  };

  const cards: Array<{ label: string; value: string; tone: 'ok' | 'warning' | 'next' | 'critical' }> = [];
  if (phase === 'before') {
    cards.push({ label: '当前状态', value: '候考中', tone: 'ok' });
    cards.push({ label: '距开考', value: countdownText, tone: 'warning' });
    cards.push({ label: '本场考试', value: startHM && endHM ? `${startHM}–${endHM}` : '—', tone: 'next' });
  } else if (phase === 'live') {
    cards.push({ label: '当前阶段', value: '已开始', tone: 'ok' });
    cards.push({ label: '距离交卷', value: remainingText, tone: urgency === 'critical' ? 'critical' : urgency === 'warn' ? 'warning' : 'ok' });
    cards.push({ label: '下一科目', value: nextName ? `${nextName}　${nextStartHM ?? ''}` : '无', tone: 'next' });
  } else if (phase === 'ended') {
    cards.push({ label: '当前状态', value: '已结束', tone: 'ok' });
    cards.push({ label: '下一场', value: nextName ? countdownText : '无', tone: nextName ? 'warning' : 'ok' });
    cards.push({ label: '下一科目', value: nextName ? `${nextName}　${nextStartHM ?? ''}` : '今日结束', tone: 'next' });
  }

  return (
    <div className={urgencyClass}>
      <div className="cd__grid" aria-hidden="true" />

      <header className="cd__top">
        <div className="cd__top-left">
          <button className="cd__ghost" onClick={onBack} aria-label="返回首页">←</button>
          <span className="cd__master">{masterTitle || '考试看板'}</span>
        </div>
        <div className="cd__top-right">
          <span className={`cd__sync cd__sync--${sync.tone}`}>
            {sync.text}
          </span>
          <button className="cd__ghost" onClick={onOpenAnnouncements} aria-label="查看公告" title="系统公告">📢</button>
          <button className="cd__ghost" onClick={onSwitchDesign} aria-label="切换设计" title="切换展示设计">▣</button>
          <button className="cd__ghost" onClick={onToggleFullscreen} aria-label={isFullscreen ? '退出全屏' : '进入全屏'} title={isFullscreen ? '退出全屏' : '进入全屏'}>{isFullscreen ? '✕' : '⛶'}</button>
          <button className="cd__ghost" onClick={onAdmin} aria-label="管理后台">⚙</button>
        </div>
      </header>

      {notification && (
        <div className="cd__notify" role="status">
          <span className="cd__notify-icon">{notification.icon}</span>
          <span className="cd__notify-msg">{notification.message}</span>
          <button className="cd__notify-close" onClick={onDismissNotification} aria-label="关闭提醒">×</button>
        </div>
      )}

      <main className="cd__center">
        {phase !== 'empty' && (
          <div className="cd__subject-block">
            <p className="cd__headline">{headline()}</p>
            {phase === 'live' && startHM && endHM && (
              <p className="cd__period">{startHM} — {endHM}</p>
            )}
          </div>
        )}

        <FitText className="cd__clock">{clock}</FitText>
        <p className="cd__date">{dateText}</p>

        {phase !== 'empty' ? (
          <>
            <div className="cd__track">
              <div className="cd__track-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="cd__track-meta">
              <span>考试进度 {Math.round(progressPct)}%</span>
              <span>
                {phase === 'live'
                  ? `已进行 ${elapsedText} · 剩余 ${remainingText}`
                  : phase === 'before'
                    ? `距开考 ${countdownText}`
                    : nextName ? `下一场 ${countdownText}` : '今日考试已结束'}
              </span>
            </div>
          </>
        ) : (
          <p className="cd__empty-hint">请在管理后台添加考试安排</p>
        )}
      </main>

      {phase !== 'empty' && (
        <section className="cd__cards">
          {cards.map((c, i) => (
            <div className={`cd__card cd__card--${c.tone}`} key={i}>
              <p className="cd__card-label">{c.label}</p>
              <p className="cd__card-value">{c.value}</p>
              <span className="cd__card-bar" />
            </div>
          ))}
        </section>
      )}

      <footer className="cd__foot">
        <span>{masterTitle}</span>
        <span>请保持安静 · 诚信应考</span>
      </footer>
    </div>
  );
}
