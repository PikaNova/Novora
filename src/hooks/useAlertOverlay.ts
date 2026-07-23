import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExamItem, AlertState, AlertsSettings, AlertStateConfig } from '../types';
import type { ExamNotification, NotifyPhase } from './useExamNotify';
import { nowMs, parseZonedTime, getZonedParts, DISPLAY_TIME_ZONE } from '../utils/timeSource';

/** 浮层当前展示项。 */
export interface AlertOverlayItem {
  key: string;
  state: AlertState;
  tone: AlertState;       // 语义色取用
  label: string;
  title: string;
  subtext: string;
  hero?: string;          // 静态主视觉文字（start/ended/next）
  countdownTo?: number;   // 若设置，主视觉文字为到该时刻的倒计时
  examLine: string;       // 科目 · 起—止
}

interface DriverInput {
  notification: ExamNotification | null;
  currentExam: ExamItem | null;
  nextExam: ExamItem | null;
  settings: AlertsSettings;
  masterTitle: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function hm(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const p = getZonedParts(ms, DISPLAY_TIME_ZONE);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

function examLineOf(exam: ExamItem | null, referenceExam?: ExamItem | null): string {
  if (!exam) return '';
  const s = hm(parseZonedTime(exam.startTime));
  if (referenceExam) {
    const current = getZonedParts(parseZonedTime(referenceExam.endTime), DISPLAY_TIME_ZONE);
    const next = getZonedParts(parseZonedTime(exam.startTime), DISPLAY_TIME_ZONE);
    if (current.year !== next.year || current.month !== next.month || current.day !== next.day) {
      return `${exam.name}  ·  ${next.month}月${next.day}日 ${s} 开考`;
    }
    return `${exam.name}  ·  ${s} 开考`;
  }
  const e = hm(parseZonedTime(exam.endTime));
  return `${exam.name}  ·  ${s} — ${e}`;
}

/** 文案占位符替换。 */
function fill(tpl: string, ctx: { subject: string; start: string; end: string; next: string; nextTime: string }): string {
  return (tpl || '')
    .replace(/\{subject\}/g, ctx.subject)
    .replace(/\{start\}/g, ctx.start)
    .replace(/\{end\}/g, ctx.end)
    .replace(/\{next\}/g, ctx.next)
    .replace(/\{nextTime\}/g, ctx.nextTime);
}

const PHASE_TO_STATE: Record<NotifyPhase, AlertState> = {
  before15: '15min', before5: '5min', started: 'start', ending15: 'end15', ended: 'ended',
};

/** 倒计时类状态（需要 countdownTo）。 */
const COUNTDOWN_STATES: AlertState[] = ['15min', '5min', 'end15'];

export function useAlertOverlay(input: DriverInput): AlertOverlayItem | null {
  const { notification, currentExam, nextExam, settings, masterTitle } = input;
  const [current, setCurrent] = useState<AlertOverlayItem | null>(null);
  // pump: 递增计数器，用于在入队时强制重新运行调度器 effect（current 不变时也能触发）
  const [pump, setPump] = useState(0);
  const queueRef = useRef<AlertOverlayItem[]>([]);
  const firedRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  const buildContext = useCallback((exam: ExamItem | null, referenceExam?: ExamItem | null) => {
    const nx = inputRef.current.nextExam;
    const start = exam ? hm(parseZonedTime(exam.startTime)) : '';
    const reference = referenceExam ? getZonedParts(parseZonedTime(referenceExam.endTime), DISPLAY_TIME_ZONE) : null;
    const target = exam ? getZonedParts(parseZonedTime(exam.startTime), DISPLAY_TIME_ZONE) : null;
    const displayStart = reference && target && (reference.year !== target.year || reference.month !== target.month || reference.day !== target.day)
      ? `${target.month}月${target.day}日 ${start}` : start;
    return {
      subject: exam?.name ?? '',
      start: displayStart,
      end: exam ? hm(parseZonedTime(exam.endTime)) : '',
      next: nx?.name ?? '',
      nextTime: nx ? hm(parseZonedTime(nx.startTime)) : '',
    };
  }, []);

  const makeBuiltIn = useCallback((state: AlertState, exam: ExamItem | null, keySuffix: string): AlertOverlayItem | null => {
    const cfg: AlertStateConfig | undefined = inputRef.current.settings.states[state];
    if (!cfg || !cfg.enabled) return null;
    const mode = inputRef.current.settings.silentMode ?? 'all';
    if (mode === 'keyOnly' && !['5min', 'start', 'ended', 'next'].includes(state)) return null;
    if (mode === 'pauseUntilExamEnd') {
      const ce = inputRef.current.currentExam;
      if (ce) { const nv = nowMs(); const st = parseZonedTime(ce.startTime); const en = parseZonedTime(ce.endTime); if (nv >= st && nv < en) return null; }
    }
    const isNext = state === 'next';
    const ctxExam = isNext ? inputRef.current.nextExam : exam;
    const ctx = buildContext(ctxExam, isNext ? exam : null);
    const item: AlertOverlayItem = {
      key: `${exam?.id ?? 'na'}_${state}_${keySuffix}`,
      state, tone: state,
      label: cfg.label,
      title: fill(cfg.title, ctx),
      subtext: fill(cfg.subtext, ctx),
      examLine: examLineOf(ctxExam, isNext ? exam : null),
    };
    if (COUNTDOWN_STATES.includes(state) && exam) {
      item.countdownTo = state === 'end15' ? parseZonedTime(exam.endTime) : parseZonedTime(exam.startTime);
    } else if (isNext) {
      item.hero = inputRef.current.nextExam?.name ?? '';
    } else {
      item.hero = cfg.hero ?? '';
    }
    return item;
  }, [buildContext]);

  const enqueue = useCallback((items: Array<AlertOverlayItem | null>) => {
    for (const it of items) {
      if (!it) continue;
      if (firedRef.current.has(it.key)) continue;
      firedRef.current.add(it.key);
      queueRef.current.push(it);
    }
    // 触发调度：用 pump 计数强制调度器 effect 重跑。
    // 注意：旧写法 setCurrent(c => c) 返回同一引用，React 会 bailout 不重渲染，
    // 导致空闲时（current === null）新入队的提醒永远不会弹出。
    setPump(p => p + 1);
  }, []);

  // 调度器：空闲且队列非空时弹出下一项
  useEffect(() => {
    if (current || queueRef.current.length === 0) return;
    if (!inputRef.current.settings.enabled) { queueRef.current = []; return; }
    const next = queueRef.current.shift()!;
    setCurrent(next);
    const base = inputRef.current.settings.durationSec * 1000;
    // start / ended 适当停留更久
    const dur = (next.state === 'start' || next.state === 'ended') ? Math.max(base, 10000) : base;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCurrent(null), dur);
  }, [current, pump]);

  // 内置事件：订阅 useExamNotify 产出的通知（不重建计时）
  useEffect(() => {
    if (!notification || !settings.enabled) return;
    const state = PHASE_TO_STATE[notification.phase];
    const items: Array<AlertOverlayItem | null> = [makeBuiltIn(state, notification.exam, notification.id)];
    // 结束且存在下一场 → 派生 next
    if (state === 'ended' && nextExam) {
      items.push(makeBuiltIn('next', notification.exam, notification.id));
    }
    enqueue(items);
  }, [notification?.id, settings.enabled, makeBuiltIn, enqueue, nextExam]);

  // 自定义提醒：基于当前科目的开考/结束时刻扫描触发（单独的 1s 扫描，不影响看板）
  useEffect(() => {
    if (!settings.enabled || settings.custom.length === 0) return;
    const scan = () => {
      const exam = inputRef.current.currentExam;
      if (!exam) return;
      if ((inputRef.current.settings.silentMode ?? 'all') === 'pauseUntilExamEnd') {
        const nv = nowMs(); const st0 = parseZonedTime(exam.startTime); const en0 = parseZonedTime(exam.endTime);
        if (nv >= st0 && nv < en0) return;
      }
      const start = parseZonedTime(exam.startTime);
      const end = parseZonedTime(exam.endTime);
      const now = nowMs();
      for (const c of inputRef.current.settings.custom) {
        if (!c.enabled) continue;
        const off = c.offsetMin * 60000;
        const trigger = c.anchor === 'beforeStart' ? start - off
          : c.anchor === 'afterStart' ? start + off
          : end - off;
        if (!Number.isFinite(trigger)) continue;
        // key 包含时间段：管理员改时间后，新时间 = 新 key，firedRef 不会拦截，自定义提醒可重新触发。
        const key = `${exam.id}_${c.id}_${exam.startTime}_${exam.endTime}`;
        if (firedRef.current.has(key)) continue;
        if (now < trigger) continue;
        if (now - trigger > 60000) { firedRef.current.add(key); continue; }
        const ctx = buildContext(exam);
        const item: AlertOverlayItem = {
          key, state: c.tone, tone: c.tone,
          label: c.label,
          title: fill(c.title, ctx),
          subtext: fill(c.subtext, ctx),
          examLine: examLineOf(exam),
          countdownTo: c.anchor === 'beforeEnd' ? end : start,
        };
        enqueue([item]);
      }
    };
    scan();
    const id = setInterval(scan, 1000);
    return () => clearInterval(id);
  }, [settings.enabled, settings.custom, buildContext, enqueue]);

  // 总开关关闭时立即清空
  useEffect(() => {
    if (!settings.enabled && current) { setCurrent(null); queueRef.current = []; }
  }, [settings.enabled, current]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return settings.enabled ? current : null;
}
