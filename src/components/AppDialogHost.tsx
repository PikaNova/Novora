import React, { useEffect, useRef, useState } from 'react';
import { computePosition, autoUpdate, offset, flip, shift, size } from '@floating-ui/dom';
import { APP_DIALOG_EVENT, type AppDialogRequest } from '../services/appDialog';

export default function AppDialogHost() {
  const [queue, setQueue] = useState<AppDialogRequest[]>([]);
  const dialogRef = useRef<HTMLElement | null>(null);
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

  // computePosition + autoUpdate to position floating dialog relative to anchor (if provided)
  useEffect(() => {
    if (!active) return;
    const floatingEl = dialogRef.current;
    if (!floatingEl) return;

    const anchor = (active as any).anchor as (HTMLElement | undefined);
    // virtual center reference when no anchor provided
    const virtualCenter = {
      getBoundingClientRect: (): DOMRect => ({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
        left: window.innerWidth / 2,
        top: window.innerHeight / 2,
        right: window.innerWidth / 2,
        bottom: window.innerHeight / 2,
        width: 0,
        height: 0,
        toJSON() { return {}; }
      } as unknown as DOMRect)
    };

    const reference: Element | { getBoundingClientRect: () => DOMRect } = anchor ?? virtualCenter;

    const cleanup = autoUpdate(reference as any, floatingEl, async () => {
      const middles = [
        offset(8),
        flip(),
        shift({ padding: 8 }),
        size({
          apply({ availableHeight, elements }) {
            elements.floating.style.maxHeight = `${Math.max(150, availableHeight - 24)}px`;
          },
          padding: 8
        })
      ];

      const pos = await computePosition(reference as any, floatingEl, {
        middleware: middles,
        strategy: 'fixed'
      });

      Object.assign(floatingEl.style, {
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        position: pos.strategy,
        transform: 'translate(0,0)'
      });
    });

    return () => cleanup();
  }, [active?.id]);

  // focus and keyboard handling
  useEffect(() => {
    if (!active) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const confirmBtn = dialogRef.current?.querySelector<HTMLButtonElement>('button.is-primary');
    confirmBtn?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && active.cancelLabel) {
        event.preventDefault();
        settle(false);
      } else if (event.key === 'Tab') {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]') || []);
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

  return <div className="app-dialog-overlay" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget && active.cancelLabel) settle(false);
  }} style={{ position: 'fixed', inset: 0, zIndex: 19000, pointerEvents: 'auto' }}>
    <section ref={dialogRef} className={`app-dialog is-${tone}`} role="alertdialog" aria-modal="true" aria-labelledby="app-dialog-title" aria-describedby="app-dialog-message">
      <header className="app-dialog__header">
        <div>
          <h2 id="app-dialog-title">{active.title}</h2>
        </div>
        {active.cancelLabel && <button className="app-dialog__close" aria-label="关闭对话框" onClick={() => settle(false)}>×</button>}
      </header>
      <p id="app-dialog-message" className="app-dialog__message">{active.message}</p>
      <footer className="app-dialog__actions">
        {active.cancelLabel && <button className="app-dialog__button is-secondary" onClick={() => settle(false)}>{active.cancelLabel}</button>}
        <button className={`app-dialog__button is-primary`} onClick={() => settle(true)}>{active.confirmLabel ?? '确定'}</button>
      </footer>
    </section>
  </div>;
}
