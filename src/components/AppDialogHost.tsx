import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CircleAlert, Info, X } from 'lucide-react';
import { APP_DIALOG_EVENT, type AppDialogRequest } from '../services/appDialog';

const ICONS = { info: Info, warning: AlertTriangle, danger: CircleAlert };

export default function AppDialogHost() {
  const [queue, setQueue] = useState<AppDialogRequest[]>([]);
  const dialogRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const active = queue[0];

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<AppDialogRequest>).detail;
      if (detail?.id && detail.title && detail.message && typeof detail.resolve === 'function') {
        setQueue(current => [...current, detail]);
      }
    };
    window.addEventListener(APP_DIALOG_EVENT, receive);
    return () => window.removeEventListener(APP_DIALOG_EVENT, receive);
  }, []);

  useEffect(() => {
    if (!active) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && active.cancelLabel) {
        event.preventDefault();
        settle(false);
      } else if (event.key === 'Tab') {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? []);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active?.id]);

  const settle = (confirmed: boolean) => {
    if (!active) return;
    active.resolve(confirmed);
    setQueue(current => {
      const next = current.filter(item => item.id !== active.id);
      if (!next.length) window.setTimeout(() => previousFocus.current?.focus(), 0);
      return next;
    });
  };

  if (!active) return null;
  const tone = active.tone ?? 'info';
  const Icon = ICONS[tone];
  return <div className="app-dialog-overlay" role="presentation" onPointerDown={event => {
    event.stopPropagation();
  }} onMouseDown={event => {
    event.stopPropagation();
    if (event.target === event.currentTarget && active.cancelLabel) settle(false);
  }} onClick={event => {
    event.stopPropagation();
  }}>
    <section ref={dialogRef} className={`app-dialog is-${tone}`} role="alertdialog" aria-modal="true" aria-labelledby="app-dialog-title" aria-describedby="app-dialog-message">
      <header className="app-dialog__header">
        <span className="app-dialog__icon"><Icon aria-hidden="true" /></span>
        <div><span>{tone === 'danger' ? '高风险操作' : tone === 'warning' ? '请确认操作' : '系统提示'}</span><h2 id="app-dialog-title">{active.title}</h2></div>
        {active.cancelLabel && <button className="app-dialog__close" aria-label="关闭对话框" onClick={() => settle(false)}><X /></button>}
      </header>
      <p id="app-dialog-message" className="app-dialog__message">{active.message}</p>
      <footer className="app-dialog__actions">
        {active.cancelLabel && <button className="app-dialog__button is-secondary" onClick={() => settle(false)}>{active.cancelLabel}</button>}
        <button ref={confirmRef} className={`app-dialog__button is-primary${tone === 'danger' ? ' is-danger' : ''}`} onClick={() => settle(true)}>{active.confirmLabel ?? '确定'}</button>
      </footer>
    </section>
  </div>;
}
