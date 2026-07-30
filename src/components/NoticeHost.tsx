import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleX, RefreshCw, X } from 'lucide-react';
import { NOTICE_DISMISS_EVENT, NOTICE_EVENT, type NoticeTone } from '../services/notify';

type Notice = { id: string; tone: NoticeTone; title?: string; message: string; variant?: 'queue'; durationMs?: number; updatedAt?: number };
const META = {
  error: { label: '错误提醒', Icon: CircleX },
  warning: { label: '提示', Icon: AlertTriangle },
  success: { label: '成功提醒', Icon: CheckCircle2 },
};

export default function NoticeHost() {
  const [items, setItems] = useState<Notice[]>([]);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<Notice>).detail;
      if (!detail?.message || !META[detail.tone]) return;
      const updatedAt = Date.now();
      setItems(current => {
        const exists = current.some(item => item.id === detail.id);
        return exists
          ? current.map(item => item.id === detail.id ? { ...item, ...detail, updatedAt } : item)
          : [...current.slice(-3), { ...detail, updatedAt }];
      });
      window.setTimeout(() => setItems(current => current.filter(item => item.id !== detail.id || item.updatedAt !== updatedAt)), detail.durationMs ?? (detail.tone === 'error' ? 6500 : 4200));
    };
    const dismiss = (event: Event) => {
      const { id } = (event as CustomEvent<{ id: string }>).detail || {};
      if (id) setItems(current => current.filter(item => item.id !== id));
    };
    window.addEventListener(NOTICE_EVENT, receive);
    window.addEventListener(NOTICE_DISMISS_EVENT, dismiss);
    return () => { window.removeEventListener(NOTICE_EVENT, receive); window.removeEventListener(NOTICE_DISMISS_EVENT, dismiss); };
  }, []);
  return <div className="notice-host" aria-live="polite">{items.map(item => {
    const isQueue = item.variant === 'queue';
    const { Icon, label } = isQueue ? { Icon: RefreshCw, label: '同步中' } : META[item.tone];
    return <article className={`notice-toast is-${item.tone}${isQueue ? ' is-queue' : ''}`} key={item.id} role={item.tone === 'error' ? 'alert' : 'status'}><Icon /><div><strong>{item.title || label}</strong><p>{item.message}</p>{isQueue && <span className="notice-toast__queue-bar" aria-hidden="true" />}</div><button aria-label="关闭提醒" onClick={() => setItems(current => current.filter(value => value.id !== item.id))}><X /></button></article>;
  })}</div>;
}
