import { useEffect, useRef, useState } from 'react';
import type { ExamItem } from '../types';
import { nowMs, parseZonedTime } from '../utils/timeSource';

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

const NOTIFY_CONFIG: Record<NotifyPhase, {
  title: string; level: NotifyLevel;
  message: (name: string) => string;
  color: string; icon: string; durationMs: number;
}> = {
  before15: { title: '开考提醒', level: 'warning', message: n => `「${n}」15分钟后开考，请提前准备`, color: '#ff9800', icon: '📣', durationMs: 15000 },
  before5:  { title: '即将开考', level: 'critical', message: n => `「${n}」5分钟后开考，请立即就座`, color: '#ff5722', icon: '⏰', durationMs: 20000 },
  started:  { title: '考试开始', level: 'critical', message: n => `「${n}」现在开始，请立即开始作答`, color: '#e53935', icon: '🚨', durationMs: 25000 },
  ending15: { title: '结束提醒', level: 'critical', message: n => `「${n}」距结束还15分钟，请尽快检查答卷`, color: '#d32f2f', icon: '⚠️', durationMs: 25000 },
  ended:    { title: '考试结束', level: 'success',  message: n => `「${n}」考试已结束，请立即停笔`, color: '#2e7d32', icon: '✅', durationMs: 25000 },
};

function getCheckpoints(exam: ExamItem) {
  const s = parseZonedTime(exam.startTime);
  const e = parseZonedTime(exam.endTime);
  return [
    { phase: 'before15' as NotifyPhase, triggerAt: s - 15 * 60000 },
    { phase: 'before5'  as NotifyPhase, triggerAt: s - 5  * 60000 },
    { phase: 'started'  as NotifyPhase, triggerAt: s },
    { phase: 'ending15' as NotifyPhase, triggerAt: e - 15 * 60000 },
    { phase: 'ended'    as NotifyPhase, triggerAt: e },
  ];
}

export function useExamNotify(exam: ExamItem | null) {
  const [notification, setNotification] = useState<ExamNotification | null>(null);
  const fired = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!exam) { setNotification(null); return; }
    const check = () => {
      if (!exam) return;
      const now = nowMs();
      for (const { phase, triggerAt } of getCheckpoints(exam)) {
        // key 同时包含开考与结束时间：管理员修改任一时间后产生新 key，
        // 旧 fired 记录不会拦截新的开考、结束类提醒。
        const key = `${exam.id}_${phase}_${exam.startTime}_${exam.endTime}`;
        if (fired.current.has(key)) continue;
        if (now < triggerAt) continue;
        if (now - triggerAt > 60000) { fired.current.add(key); continue; }
        fired.current.add(key);
        const cfg = NOTIFY_CONFIG[phase];
        setNotification({ phase, level: cfg.level, title: cfg.title,
          message: cfg.message(exam.name), color: cfg.color, icon: cfg.icon,
          durationMs: cfg.durationMs, exam, id: key });
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setNotification(null), cfg.durationMs);
        break;
      }
    };
    check();
    const id = setInterval(check, 1000);
    return () => {
      clearInterval(id);
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      // 考试数据改变时，不能继续展示按旧时间生成、且已失去自动关闭 timer 的通知。
      setNotification(null);
    };
  // ID、名称或任一时间变化时都重跑：闭包始终使用最新考试数据生成提醒。
  }, [exam?.id, exam?.name, exam?.startTime, exam?.endTime]);

  return { notification, dismiss: () => { setNotification(null); if (timer.current) clearTimeout(timer.current); } };
}
