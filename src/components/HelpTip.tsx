import React, { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import '../styles/help-tip.css';

type Props = { title: string; children: React.ReactNode; label?: string };

export default function HelpTip({ title, children, label }: Props) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeOnEscape); };
  }, [open]);

  return <span className="help-tip">
    <button type="button" className="help-tip__trigger" aria-label={label || `查看${title}说明`} aria-expanded={open} onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(true); }}>i</button>
    {open && createPortal(
      <div className="help-tip__layer" role="presentation" onClick={() => setOpen(false)}>
        <div className="help-tip__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={event => event.stopPropagation()}>
          <strong id={titleId}>{title}</strong>
          <div className="help-tip__content">{children}</div>
          <button type="button" className="help-tip__close" autoFocus onClick={() => setOpen(false)}>知道了</button>
        </div>
      </div>,
      document.body,
    )}
  </span>;
}
