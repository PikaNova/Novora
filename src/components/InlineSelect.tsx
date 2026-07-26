import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { createPortal } from 'react-dom';
import '../styles/inline-select.css';

export type InlineSelectOption = { value: string; label: React.ReactNode; disabled?: boolean };

type Props = {
  value: string;
  options: InlineSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

export default function InlineSelect({ value, options, onChange, placeholder = '请选择', disabled = false, className = '', ariaLabel }: Props) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const selected = options.find(option => option.value === value);

  const place = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, Math.min(320, window.innerWidth - 24));
    const estimatedHeight = Math.min(320, options.length * 42 + 12);
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    const up = below < Math.min(estimatedHeight, 180) && above > below;
    setStyle({ position: 'fixed', width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), ...(up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }), maxHeight: `min(320px, ${Math.max(160, (up ? above : below) - 12)}px)` });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const close = (event: PointerEvent) => { if (!triggerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const reposition = () => place();
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  }, [open, options.length]);

  return <span className={`inline-select ${className}${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}>
    <button ref={triggerRef} type="button" className="inline-select__trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => { if (!open) place(); setOpen(value => !value); }}><span>{selected?.label ?? placeholder}</span><ChevronDown aria-hidden="true" size={16} /></button>
    {open && typeof document !== 'undefined' && createPortal(<div ref={menuRef} className="inline-select__menu" style={style} role="listbox" aria-label={ariaLabel}>{options.map(option => <button type="button" key={option.value} role="option" aria-selected={option.value === value} disabled={option.disabled} className={option.value === value ? 'is-selected' : ''} onClick={() => { if (!option.disabled) { onChange(option.value); setOpen(false); } }}><span>{option.label}</span>{option.value === value && <Check aria-hidden="true" size={15} />}</button>)}</div>, document.body)}
  </span>;
}
