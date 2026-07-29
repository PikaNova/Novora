import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleX, X, Copy } from 'lucide-react';
import { NOTICE_EVENT, type NoticeTone } from '../services/notify';

type NoticeMeta = { requestId?: string; actionLabel?: string; actionUrl?: string } | undefined;
type Notice = { id: string; tone: NoticeTone; title?: string; message: string; meta?: NoticeMeta };
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
      // 保留最后 3 条消息
      setItems(current => [...current.slice(-3), detail]);
      // 错误消息保留更久，且点击可手动关闭
      window.setTimeout(() => setItems(current => current.filter(item => item.id !== detail.id)), detail.tone === 'error' ? 8000 : 4200);
    };
    window.addEventListener(NOTICE_EVENT, receive);
    return () => window.removeEventListener(NOTICE_EVENT, receive);
  }, []);

  const copyRequestId = async (id?: string) => {
    if (!id) return;
    try { await navigator.clipboard.writeText(id); notify('success', '请求 ID 已复制到剪贴板'); }
    catch { notify('warning', '复制失败，请手动记录请求 ID'); }
  };

  return <div className="notice-host" aria-live="polite">{items.map(item => {
    const { Icon } = META[item.tone];
    return <article className={`notice-toast is-${item.tone}`} key={item.id} role="status" aria-atomic="true">
      <div className="notice-body">
        <div className="notice-icon"><Icon aria-hidden="true" /></div>
        <div className="notice-content">
          {item.title && <div className="notice-title">{item.title}</div>}
          <div className="notice-message">{item.message}</div>
          {item.meta?.requestId && <div className="notice-meta">请求 ID: <code>{item.meta.requestId}</code>
            <button className="notice-copy" aria-label="复制请求 ID" onClick={() => copyRequestId(item.meta?.requestId)}><Copy /></button>
          </div>}
          {item.meta?.actionLabel && item.meta?.actionUrl && <div className="notice-action">
            <button className="notice-action-btn" onClick={() => window.open(item.meta!.actionUrl, '_blank')}>{item.meta.actionLabel}</button>
          </div>}
        </div>
        <button className="notice-close" aria-label="关闭提醒" onClick={() => setItems(current => current.filter(x => x.id !== item.id))}><X /></button>
      </div>
    </article>;
  })}</div>;
}
