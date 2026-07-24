import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ellipsis, LogIn, MonitorCog, Play } from 'lucide-react';
import '../styles/exam-quick-menu.css';

type MenuPosition = { top: number; left: number; width: number };

export default function ExamQuickMenu({ onLocal, onAdmin, onTemporary }: { onLocal: () => void; onAdmin: () => void; onTemporary: () => void }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ top: 48, left: 12, width: 196 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(220, Math.max(188, window.innerWidth - 24));
    const estimatedHeight = menuRef.current?.offsetHeight || 150;
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));
    const below = rect.bottom + 8;
    const top = below + estimatedHeight <= window.innerHeight - 12
      ? below
      : Math.max(12, rect.top - estimatedHeight - 8);
    setPosition({ top, left, width });
  }, []);

  useLayoutEffect(() => { if (open) updatePosition(); }, [open, updatePosition]);
  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  const go = (fn: () => void, confirm?: string) => {
    if (!confirm || window.confirm(confirm)) { setOpen(false); fn(); }
  };

  const menu = open ? createPortal(
    <div ref={menuRef} className="exam-quick__menu" style={position} role="menu" aria-label="大屏更多功能">
      <button role="menuitem" onClick={() => go(onTemporary)}><Play />快速开始考试</button>
      <button role="menuitem" onClick={() => go(onLocal)}><MonitorCog />本地设置</button>
      <button role="menuitem" onClick={() => go(onAdmin, '进入管理后台？大屏将停止全屏展示。')}><LogIn />进入管理后台</button>
    </div>,
    document.body,
  ) : null;

  return <div className="exam-quick">
    <button ref={triggerRef} type="button" aria-label="更多" title="更多" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(value => !value)}><Ellipsis /></button>
    {menu}
  </div>;
}
