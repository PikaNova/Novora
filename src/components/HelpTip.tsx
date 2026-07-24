import React, { useState } from 'react';
import '../styles/help-tip.css';

type Props = { title: string; children: React.ReactNode; label?: string };

export default function HelpTip({ title, children, label }: Props) {
  const [open, setOpen] = useState(false);
  return <span className="help-tip">
    <button type="button" className="help-tip__trigger" aria-label={label || `查看${title}说明`} aria-expanded={open} onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(value => !value); }}>i</button>
    {open && <>
      <button type="button" className="help-tip__backdrop" aria-label="关闭说明" onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); }} />
      <span className="help-tip__panel" role="dialog" aria-label={title} onClick={event => event.stopPropagation()}><strong>{title}</strong><span>{children}</span><button type="button" className="help-tip__close" onClick={() => setOpen(false)}>知道了</button></span>
    </>}
  </span>;
}
