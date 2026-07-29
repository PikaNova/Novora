export type NoticeTone = 'error' | 'warning' | 'success';
export const NOTICE_EVENT = 'exam-board:notice';

export function notify(tone: NoticeTone, message: string, title?: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, tone, message, title } }));
}
