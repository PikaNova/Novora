import type { ExamCenterView } from '../../types/exam';

export type ExamCenterNavItem = { id: ExamCenterView; label: string; permission: string };

/**
 * 考试中心的三个板块（当前/安排/历史）；「编辑考试」是二级页面，
 * 「周测计划」并入「考试安排」，所以都不在这里出现。
 *
 * 桌面端这三个板块渲染成左侧主导航里的缩进子项（`AdminTabBar`），
 * 移动端左栏收起，本组件在内容区顶部作为横向分段条兜底。
 */
export const EXAM_CENTER_NAV_ITEMS: readonly ExamCenterNavItem[] = [
  { id: 'current', label: '当前考试', permission: 'major.read' },
  { id: 'schedule', label: '考试安排', permission: 'major.read' },
  { id: 'history', label: '历史考试', permission: 'major.read' },
];

export type ExamCenterNavProps = {
  view: ExamCenterView;
  can: (permission: string) => boolean;
  onSelect: (view: ExamCenterView) => void;
};

export function examCenterViews(can: (permission: string) => boolean): ExamCenterView[] {
  const visible = EXAM_CENTER_NAV_ITEMS.filter((item) => can(item.permission)).map((item) => item.id);
  if (visible.length) return can('weekly.read') ? [...visible, 'weekly'] : visible;
  // 大考列表视图都不可见时（只有 weekly.read）默认落到周测。
  return can('weekly.read') ? ['weekly'] : [];
}

export default function ExamCenterNav({ view, can, onSelect }: ExamCenterNavProps) {
  const visible = EXAM_CENTER_NAV_ITEMS.filter((item) => can(item.permission));
  if (visible.length <= 1) return null;
  return (
    <nav className="exam-center-nav" aria-label="考试中心板块">
      {visible.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`exam-center-nav__item${view === item.id ? ' is-active' : ''}`}
          onClick={() => onSelect(item.id)}
          aria-current={view === item.id ? 'page' : undefined}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
