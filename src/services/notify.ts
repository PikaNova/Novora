export type NoticeTone = 'error' | 'warning' | 'success';
export const NOTICE_EVENT = 'exam-board:notice';
export const NOTICE_DISMISS_EVENT = 'exam-board:notice-dismiss';

export type NoticeOptions = {
  id?: string;
  variant?: 'queue';
  durationMs?: number;
};

export function notify(tone: NoticeTone, message: string, title?: string, options: NoticeOptions = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: {
    id: options.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    tone,
    message,
    title,
    variant: options.variant,
    durationMs: options.durationMs,
  } }));
}

export function dismissNotice(id: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NOTICE_DISMISS_EVENT, { detail: { id } }));
}
