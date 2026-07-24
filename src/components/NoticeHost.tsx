import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleX, X } from 'lucide-react';
import { NOTICE_EVENT, type NoticeTone } from '../services/notify';

type Notice = { id: string; tone: NoticeTone; title?: string; message: string };
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
      setItems(current => [...current.slice(-3), detail]);
      window.setTimeout(() => setItems(current => current.filter(item => item.id !== detail.id)), detail.tone === 'error' ? 6500 : 4200);
    };
    window.addEventListener(NOTICE_EVENT, receive);
    return () => window.removeEventListener(NOTICE_EVENT, receive);
  }, []);
  return <div className="notice-host" aria-live="polite">{items.map(item => { const { Icon, label } = META[item.tone]; return <article className={`notice-toast is-${item.tone}`} key={item.id} role={item.tone === 'error' ? 'alert' : 'status'}><Icon /><div><strong>{item.title || label}</strong><p>{item.message}</p></div><button aria-label="关闭提醒" onClick={() => setItems(current => current.filter(value => value.id !== item.id))}><X /></button></article>; })}</div>;
}
