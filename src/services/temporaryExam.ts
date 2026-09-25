import type { ExamItem } from '../types';
import type { DeviceCommand } from '../shared/deviceContracts';

const KEY = 'exam_board_temporary_exam_v2';
export const TEMPORARY_EXAM_EVENT = 'exam-board:temporary-exam';
const localIso = (value: number) =>
  new Date(value - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

export interface TemporaryExam {
  id: string;
  subject: string;
  startTime: string;
  endTime: string;
  priorityOverFormal: boolean;
  status: 'scheduled' | 'running' | 'paused' | 'ended';
  createdAt: number;
  pausedAt?: number;
}

export function getTemporaryExam(): TemporaryExam | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null') as TemporaryExam | null;
    return value?.id ? value : null;
  } catch {
    return null;
  }
}

export function saveTemporaryExam(exam: TemporaryExam) {
  localStorage.setItem(KEY, JSON.stringify(exam));
  window.dispatchEvent(new Event(TEMPORARY_EXAM_EVENT));
}

export function endTemporaryExam() {
  const exam = getTemporaryExam();
  if (exam) saveTemporaryExam({ ...exam, status: 'ended', endTime: localIso(Date.now()) });
}

export function extendTemporaryExam(minutes = 5) {
  const exam = getTemporaryExam();
  if (!exam || exam.status === 'ended') return;
  const end = new Date(exam.endTime).getTime() + Math.max(1, minutes) * 60_000;
  saveTemporaryExam({ ...exam, endTime: localIso(end) });
}

export function toggleTemporaryExamPause() {
  const exam = getTemporaryExam();
  if (!exam || exam.status === 'ended') return;
  if (exam.status === 'paused') {
    const pausedFor = Math.max(0, Date.now() - Number(exam.pausedAt || Date.now()));
    saveTemporaryExam({
      ...exam,
      status: 'running',
      pausedAt: undefined,
      endTime: localIso(new Date(exam.endTime).getTime() + pausedFor),
    });
  } else saveTemporaryExam({ ...exam, status: 'paused', pausedAt: Date.now() });
}

export function setTemporaryExamPaused(paused: boolean) {
  const exam = getTemporaryExam();
  if (!exam || exam.status === 'ended' || (paused && exam.status === 'paused') || (!paused && exam.status !== 'paused'))
    return;
  toggleTemporaryExamPause();
}

export type TemporaryExamCommandOutcome = { ok: true } | { ok: false; reason: string };

/**
 * 执行后台发来的本机临时考试指令，并**如实**返回是否真的执行了。
 *
 * 以前直接调用 setTemporaryExamPaused/extendTemporaryExam/endTemporaryExam：本机没有临时考试、
 * 或已经结束时它们是静默 no-op，但设备仍然回执"已执行"——后台看到成功，教室端什么都没有。
 */
export function applyTemporaryExamCommand(
  command: Pick<DeviceCommand, 'action' | 'minutes'>,
): TemporaryExamCommandOutcome {
  const exam = getTemporaryExam();
  if (!exam) return { ok: false, reason: '本机没有临时考试' };
  if (exam.status === 'ended') return { ok: false, reason: '本机临时考试已结束' };
  switch (command.action) {
    case 'pause':
      if (exam.status === 'paused') return { ok: false, reason: '本机临时考试已在暂停中' };
      setTemporaryExamPaused(true);
      return { ok: true };
    case 'resume':
      if (exam.status !== 'paused') return { ok: false, reason: '本机临时考试不在暂停中' };
      setTemporaryExamPaused(false);
      return { ok: true };
    case 'extend':
      extendTemporaryExam(command.minutes || 5);
      return { ok: true };
    case 'end':
      endTemporaryExam();
      return { ok: true };
    default:
      return { ok: false, reason: `未知指令：${String(command.action)}` };
  }
}

export function resolveTemporaryItem(formalItems: ExamItem[], now = Date.now()): ExamItem | null {
  const exam = getTemporaryExam();
  // 暂停中的临时考试仍然要给出去（带 pausedAt）：教室端据此显示「已暂停」并冻结倒计时，
  // 而不是像以前那样整场消失、屏幕变成"没有考试"。
  if (!exam || exam.status === 'ended') return null;
  const start = new Date(exam.startTime).getTime();
  const originalEnd = new Date(exam.endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(originalEnd) || originalEnd <= now) return null;
  let end = originalEnd;
  if (!exam.priorityOverFormal) {
    const activeFormal = formalItems.find(
      (item) => item.enabled && new Date(item.startTime).getTime() <= now && new Date(item.endTime).getTime() > now,
    );
    if (activeFormal && start <= now) return null;
    const takeover = formalItems
      .filter((item) => item.enabled)
      .map((item) => new Date(item.startTime).getTime())
      .filter((value) => value > start && value < end)
      .sort((a, b) => a - b)[0];
    if (takeover) end = takeover;
  }
  if (end <= start) return null;
  return {
    id: exam.id,
    name: exam.subject,
    startTime: exam.startTime,
    endTime: localIso(end),
    enabled: true,
    order: -1,
    kind: 'temporary',
    ...(exam.status === 'paused' ? { pausedAt: exam.pausedAt ?? now } : {}),
  } as ExamItem;
}
