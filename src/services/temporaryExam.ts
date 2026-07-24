import type { ExamItem } from '../types';

const KEY = 'exam_board_temporary_exam_v2';
export const TEMPORARY_EXAM_EVENT = 'exam-board:temporary-exam';
const localIso = (value: number) => new Date(value - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

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
  } catch { return null; }
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
    saveTemporaryExam({ ...exam, status: 'running', pausedAt: undefined, endTime: localIso(new Date(exam.endTime).getTime() + pausedFor) });
  } else saveTemporaryExam({ ...exam, status: 'paused', pausedAt: Date.now() });
}

export function setTemporaryExamPaused(paused: boolean) {
  const exam = getTemporaryExam();
  if (!exam || exam.status === 'ended' || (paused && exam.status === 'paused') || (!paused && exam.status !== 'paused')) return;
  toggleTemporaryExamPause();
}

export function resolveTemporaryItem(formalItems: ExamItem[], now = Date.now()): ExamItem | null {
  const exam = getTemporaryExam();
  if (!exam || exam.status === 'ended' || exam.status === 'paused') return null;
  const start = new Date(exam.startTime).getTime();
  const originalEnd = new Date(exam.endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(originalEnd) || originalEnd <= now) return null;
  let end = originalEnd;
  if (!exam.priorityOverFormal) {
    const activeFormal = formalItems.find(item => item.enabled && new Date(item.startTime).getTime() <= now && new Date(item.endTime).getTime() > now);
    if (activeFormal && start <= now) return null;
    const takeover = formalItems.filter(item => item.enabled).map(item => new Date(item.startTime).getTime()).filter(value => value > start && value < end).sort((a, b) => a - b)[0];
    if (takeover) end = takeover;
  }
  if (end <= start) return null;
  return { id: exam.id, name: exam.subject, startTime: exam.startTime, endTime: localIso(end), enabled: true, order: -1, kind: 'temporary' } as ExamItem;
}
