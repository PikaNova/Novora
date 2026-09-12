// 设置页左侧分组栏（桌面）+ 顶部横向分组条（移动端）。
// 分组是路由：点一下切换整个视图，而不是在长页面里滚动定位。
import type { ReactNode } from 'react';

export type SettingsRailGroup = { id: string; label: string; icon?: ReactNode };

export default function SettingsRail({
  groups,
  footer,
  active,
  onSelect,
}: {
  groups: SettingsRailGroup[];
  footer: SettingsRailGroup;
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <nav className="set-rail" aria-label="设置分组">
        <div className="set-rail__list">
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              className={`set-rail__item${active === group.id ? ' is-active' : ''}`}
              aria-current={active === group.id ? 'page' : undefined}
              onClick={() => onSelect(group.id)}
            >
              {group.icon}
              <span>{group.label}</span>
            </button>
          ))}
        </div>
        <div className="set-rail__footer">
          <button
            type="button"
            className={`set-rail__item${active === footer.id ? ' is-active' : ''}`}
            aria-current={active === footer.id ? 'page' : undefined}
            onClick={() => onSelect(footer.id)}
          >
            {footer.icon}
            <span>{footer.label}</span>
          </button>
        </div>
      </nav>
      {/* 移动端：左栏隐藏，改用吸顶横向分组条 */}
      <nav className="set-group-nav" aria-label="设置分组">
        {[...groups, footer].map((group) => (
          <button
            key={group.id}
            type="button"
            className={active === group.id ? 'is-active' : ''}
            aria-current={active === group.id ? 'page' : undefined}
            onClick={() => onSelect(group.id)}
          >
            {group.label}
          </button>
        ))}
      </nav>
    </>
  );
}
