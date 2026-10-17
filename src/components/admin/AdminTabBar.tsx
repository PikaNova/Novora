// 后台主导航栏：只负责主功能切换。运行模式/年级/班级等页面状态由页面内的
// AdminContextBar 承载，导航栏不再挂页面控件。
import { ADMIN_NAV, canAccessAdminTab } from '../../hooks/admin/adminRoutes.js';
import type { AdminTab, ExamCenterView } from '../../types/exam';
import { EXAM_CENTER_NAV_ITEMS } from '../exam-center/ExamCenterNav.js';
import ModuleIcon from '../ModuleIcon.js';

export type AdminTabBarProps = {
  adminTab: AdminTab;
  can: (permission: string) => boolean;
  selectAdminTab: (item: (typeof ADMIN_NAV)[number]) => void;
  /** 考试中心内部板块：作为「考试中心」下面的缩进子项出现在左栏。 */
  examView?: ExamCenterView;
  onSelectExamView?: (view: ExamCenterView) => void;
};

export function AdminTabBar({ adminTab, can, selectAdminTab, examView, onSelectExamView }: AdminTabBarProps) {
  return (
    <nav className="admin-tabbar" aria-label="管理功能">
      <div className="admin-tabbar__tabs">
        {ADMIN_NAV.filter((item) => item.id === 'users' || canAccessAdminTab(item.id, can)).map((item) => (
          <div className="admin-tab-group" key={item.id}>
            <button
              className={`admin-tab${adminTab === item.id ? ' is-active' : ''}`}
              onClick={() => selectAdminTab(item)}
              aria-current={adminTab === item.id ? 'page' : undefined}
            >
              <span>
                <ModuleIcon module={item.id} size={16} />
              </span>
              {item.label}
            </button>
            {item.id === 'exam' && onSelectExamView && (
              /*
               * 子项的选中态只在「考试中心」板块内成立：别的板块下 adminTab !== 'exam'，
               * 这时即使上层把回落视图（当前考试）传进来，也不该有子项亮着。
               */
              <ExamSubNav view={adminTab === 'exam' ? examView : undefined} can={can} onSelect={onSelectExamView} />
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}

/**
 * 考试中心的三个板块：桌面端是左栏里缩进的一级子项，点击直接切板块并选中「考试中心」。
 * 只剩一个板块时（比如只有历史考试的权限）不渲染子项，父项点击即落到那一个。
 */
function ExamSubNav({
  view,
  can,
  onSelect,
}: {
  view: ExamCenterView | undefined;
  can: (permission: string) => boolean;
  onSelect: (view: ExamCenterView) => void;
}) {
  const items = EXAM_CENTER_NAV_ITEMS.filter((item) => can(item.permission));
  if (items.length <= 1) return null;
  return (
    <div className="admin-subnav" role="group" aria-label="考试中心板块">
      {items.map((item) => {
        const active = view === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={`admin-subnav__item${active ? ' is-active' : ''}`}
            onClick={() => onSelect(item.id)}
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
