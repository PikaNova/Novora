import React, { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export default function SettingsCollapsibleCard({
  storageKey,
  title,
  icon,
  badge,
  danger = false,
  defaultOpen = false,
  children,
}: {
  storageKey: string;
  title: string;
  icon?: ReactNode;
  badge?: string;
  danger?: boolean;
  /** 存储里没有用户偏好时的初始展开状态；数据到达后才确定时可配合自动展开。 */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === '1') return true;
      if (stored === '0') return false;
    } catch {
      /* 忽略存储异常 */
    }
    return defaultOpen;
  });
  // 需要「首次进入就展开」的场景（例如平台凭据尚未配置）时，展开条件要等数据加载后才成立，
  // 因此这里补一次自动展开；用户手动收起过（存了 '0'）就不再打扰。
  useEffect(() => {
    if (!defaultOpen) return;
    try {
      if (localStorage.getItem(storageKey) === '0') return;
    } catch {
      /* 忽略存储异常 */
    }
    setOpen(true);
  }, [defaultOpen, storageKey]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, open ? '1' : '0');
    } catch {
      /* 忽略存储异常 */
    }
  }, [open, storageKey]);

  return (
    <section className={'set-card set-collapse' + (danger ? ' set-collapse--danger' : '')}>
      <button
        type="button"
        className="set-collapse__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="set-collapse__label">
          {icon}
          <span className="set-collapse__title">{title}</span>
          {badge ? <em className="set-collapse__badge">{badge}</em> : null}
        </span>
        <ChevronDown size={17} className={'set-collapse__chevron' + (open ? ' is-open' : '')} aria-hidden="true" />
      </button>
      {open && <div className="set-collapse__body">{children}</div>}
    </section>
  );
}
