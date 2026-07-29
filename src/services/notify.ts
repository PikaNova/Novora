export type NoticeTone = 'error' | 'warning' | 'success';
export const NOTICE_EVENT = 'exam-board:notice';

export type NoticeMeta = {
  requestId?: string; // 后端返回的请求 ID，便于复制与追踪
  actionLabel?: string; // 例如："重试"、"查看详情"
  actionUrl?: string; // 可选的外部链接或内部页面地址
};

export function notify(tone: NoticeTone, message: string, title?: string, meta?: NoticeMeta) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, tone, message, title, meta } }));
}
