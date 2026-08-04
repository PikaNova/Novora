import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../styles/help-tip.css';

type Props = { title: string; children: React.ReactNode; label?: string };

const PANEL_WIDTH = 280;
const PANEL_MARGIN = 8;
const MOBILE_BREAKPOINT = 600;

export default function HelpTip({ title, children, label }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      if (window.innerWidth <= MOBILE_BREAKPOINT) {
        setPosition(null);
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const left = Math.min(
        Math.max(PANEL_MARGIN, rect.right - PANEL_WIDTH),
        window.innerWidth - PANEL_WIDTH - PANEL_MARGIN,
      );
      setPosition({ top: rect.bottom + 6, left });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  return <span className="help-tip">
    <button ref={triggerRef} type="button" className="help-tip__trigger" aria-label={label || `查看${title}说明`} aria-expanded={open} onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(value => !value); }}>i</button>
    {open && createPortal(<>
      <button type="button" className="help-tip__backdrop" aria-label="关闭说明" onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); }} />
      <span className="help-tip__panel" role="dialog" aria-label={title} style={position ? { top: position.top, left: position.left } : undefined} onClick={event => event.stopPropagation()}><strong>{title}</strong><span>{children}</span><button type="button" className="help-tip__close" onClick={() => setOpen(false)}>知道了</button></span>
    </>, document.body)}
  </span>;
}
