import { journal } from '../utils/runtimeJournal.js';
import { runtimeReference } from '../utils/runtimeDisplayState.js';
import { useEffect, useRef, useState } from 'react';
import type { ExamItem } from '../types';
import { subscribeClock, nowMs, nowWithoutBroadcastOffsetMs, parseZonedTime } from '../utils/timeSource';
import { runManualTimeSync } from '../utils/timeSync';
import { notify } from '../services/notify';

export type NotifyPhase = 'before15' | 'before5' | 'started' | 'ending15' | 'ended';
export type NotifyLevel = 'info' | 'warning' | 'critical' | 'success';

export interface ExamNotification {
  phase: NotifyPhase;
  level: NotifyLevel;
  title: string;
  message: string;
  color: string;
  icon: string;
  durationMs: number;
  exam: ExamItem;
  id: string;
}

const NOTIFY_CONFIG: Record<
  NotifyPhase,
  {
    title: string;
    level: NotifyLevel;
    message: (name: string) => string;
    color: string;
    icon: string;
    durationMs: number;
  }
> = {
  before15: {
    title: '开考提醒',
    level: 'warning',
    message: (n) => `「${n}」15分钟后开考，请提前准备`,
    color: '#ff9800',
    icon: '📣',
    durationMs: 15000,
  },
  before5: {
    title: '即将开考',
    level: 'critical',
    message: (n) => `「${n}」5分钟后开考，请立即就座`,
    color: '#ff5722',
    icon: '⏰',
    durationMs: 20000,
  },
  started: {
    title: '考试开始',
    level: 'critical',
    message: (n) => `「${n}」现在开始，请立即开始作答`,
    color: '#e53935',
    icon: '🚨',
    durationMs: 25000,
  },
  ending15: {
    title: '结束提醒',
    level: 'critical',
    message: (n) => `「${n}」距结束还15分钟，请尽快检查答卷`,
    color: '#d32f2f',
    icon: '⚠️',
    durationMs: 25000,
  },
  ended: {
    title: '考试结束',
    level: 'success',
    message: (n) => `「${n}」考试已结束，请立即停笔`,
    color: '#2e7d32',
    icon: '✅',
    durationMs: 25000,
  },
};

function getCheckpoints(exam: ExamItem) {
  const s = parseZonedTime(exam.startTime);
  const e = parseZonedTime(exam.endTime);
  return [
    { phase: 'before15' as NotifyPhase, triggerAt: s - 15 * 60000 },
    { phase: 'before5' as NotifyPhase, triggerAt: s - 5 * 60000 },
    { phase: 'started' as NotifyPhase, triggerAt: s },
    { phase: 'ending15' as NotifyPhase, triggerAt: e - 15 * 60000 },
    { phase: 'ended' as NotifyPhase, triggerAt: e },
  ];
}

export function useExamNotify(exam: ExamItem | null) {
  const [notification, setNotification] = useState<ExamNotification | null>(null);
  const examRef = useRef(exam);
  examRef.current = exam;
  const fired = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preSyncTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!examRef.current) {
      setNotification(null);
      return;
    }
    const check = () => {
      const currentExam = examRef.current;
      if (!currentExam) return;
      const now = nowMs();
      const scheduleNow = nowWithoutBroadcastOffsetMs();
      const startAt = parseZonedTime(currentExam.startTime);
      const preSyncKey = `novora:pre-exam-sync:${currentExam.id}:${startAt}`;
      if (
        Number.isFinite(startAt) &&
        scheduleNow >= startAt - 120_000 &&
        scheduleNow < startAt &&
        !fired.current.has(preSyncKey)
      ) {
        let alreadyRequested = false;
        try {
          alreadyRequested = localStorage.getItem(preSyncKey) === '1';
          if (!alreadyRequested) localStorage.setItem(preSyncKey, '1');
        } catch {
          // Keep the one-shot sync available when storage is blocked.
        }
        fired.current.add(preSyncKey);
        if (!alreadyRequested) {
          notify('warning', `「${currentExam.name}」即将开考，正在自动校时`, '开考前校时');
          preSyncTimer.current = window.setTimeout(() => {
            void runManualTimeSync().then((synced) => {
              notify(
                synced ? 'success' : 'error',
                synced
                  ? `「${currentExam.name}」开考前校时完成`
                  : `「${currentExam.name}」开考前校时失败，请检查校时配置`,
                '开考前校时',
              );
            });
          }, Math.random() * 3000);
        }
      }
      for (const { phase, triggerAt } of getCheckpoints(currentExam)) {
        // key 同时包含开考与结束时间：管理员修改任一时间后产生新 key，
        // 旧 fired 记录不会拦截新的开考、结束类提醒。
        const key = `${currentExam.id}_${phase}_${currentExam.name}_${currentExam.startTime}_${currentExam.endTime}`;
        if (fired.current.has(key)) continue;
        if (now < triggerAt) continue;
        if (now - triggerAt > 60000) {
          fired.current.add(key);
          journal(
            'notice.reminder_skipped',
            { phase, reason: 'trigger_expired', targetRef: runtimeReference(currentExam.id) },
            'info',
            'notice',
            '提醒时间窗已过，跳过播放',
          );
          continue;
        }
        fired.current.add(key);
        const cfg = NOTIFY_CONFIG[phase];
        journal(
          'notice.reminder_triggered',
          { phase, targetRef: runtimeReference(currentExam.id) },
          'info',
          'notice',
          '考试提醒触发',
        );
        setNotification({
          phase,
          level: cfg.level,
          title: cfg.title,
          message: cfg.message(currentExam.name),
          color: cfg.color,
          icon: cfg.icon,
          durationMs: cfg.durationMs,
          exam: currentExam,
          id: key,
        });
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setNotification(null), cfg.durationMs);
        break;
      }
    };
    check();
    const id = subscribeClock(check);
    return () => {
      id();
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (preSyncTimer.current) {
        window.clearTimeout(preSyncTimer.current);
        preSyncTimer.current = null;
      }
      // 考试数据改变时，不能继续展示按旧时间生成、且已失去自动关闭 timer 的通知。
      setNotification(null);
    };
    // ID、名称或任一时间变化时都重跑。其他无关属性变化不重置 1s 扫描；
    // examRef 保证回调读取的是最新对象。
  }, [exam?.id, exam?.name, exam?.startTime, exam?.endTime]);

  return {
    notification,
    dismiss: () => {
      setNotification(null);
      if (timer.current) clearTimeout(timer.current);
    },
  };
}
