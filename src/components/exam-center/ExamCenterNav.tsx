import type { ExamCenterView } from '../../types/exam';

/** 全部内部视图（含不进导航的二级页面），深链校验用。 */
export const EXAM_CENTER_VIEWS: readonly ExamCenterView[] = ['current', 'schedule', 'history', 'weekly', 'editor'];

type NavItem = { id: ExamCenterView; label: string; permission: string };

/** 考试中心的四个板块；「编辑考试」是二级页面，不在这里出现。 */
const ITEMS: NavItem[] = [
  { id: 'current', label: '当前考试', permission: 'major.read' },
  { id: 'schedule', label: '考试安排', permission: 'major.read' },
  { id: 'history', label: '历史考试', permission: 'major.read' },
  { id: 'weekly', label: '周测计划', permission: 'weekly.read' },
];

export type ExamCenterNavProps = {
  view: ExamCenterView;
  can: (permission: string) => boolean;
  onSelect: (view: ExamCenterView) => void;
};

export function examCenterViews(can: (permission: string) => boolean): ExamCenterView[] {
  const visible = ITEMS.filter((item) => can(item.permission)).map((item) => item.id);
  // 大考列表视图都不可见时（只有 weekly.read）默认落到周测。
  return visible.length ? visible : ['weekly'];
}

export default function ExamCenterNav({ view, can, onSelect }: ExamCenterNavProps) {
  const visible = ITEMS.filter((item) => can(item.permission));
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
