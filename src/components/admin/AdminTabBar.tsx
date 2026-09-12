// 后台主导航栏：只负责主功能切换。运行模式/年级/班级等页面状态由页面内的
// AdminContextBar 承载，导航栏不再挂页面控件。
import { ADMIN_NAV } from '../../hooks/admin/useAdminModals';
import type { AdminTab } from '../../types/exam';
import ModuleIcon from '../ModuleIcon';

export type AdminTabBarProps = {
  adminTab: AdminTab;
  can: (permission: string) => boolean;
  selectAdminTab: (item: (typeof ADMIN_NAV)[number]) => void;
  visibleWeeklyPlans: unknown[];
};

export function AdminTabBar({ adminTab, can, selectAdminTab, visibleWeeklyPlans }: AdminTabBarProps) {
  return (
    <nav className="admin-tabbar" aria-label="管理功能">
      <div className="admin-tabbar__tabs">
        {ADMIN_NAV.filter((item) => item.id === 'users' || can(item.permission)).map((item) => (
          <button
            key={item.id}
            className={`admin-tab${adminTab === item.id ? ' is-active' : ''}`}
            onClick={() => selectAdminTab(item)}
            aria-current={adminTab === item.id ? 'page' : undefined}
          >
            <span>
              <ModuleIcon module={item.id} size={16} />
            </span>
            {item.label}
            {item.id === 'weekly' && visibleWeeklyPlans.length ? `（${visibleWeeklyPlans.length}）` : ''}
          </button>
        ))}
      </div>
    </nav>
  );
}
