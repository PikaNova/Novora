import type { AdminTab, ExamCenterView } from '../../types/exam';

/**
 * 后台一级板块与路由的对应关系。
 *
 * 每个板块都有自己的路径（`/admin/<板块>`），URL 是「当前在哪个板块」的唯一来源：
 * 刷新、收藏、分享链接、前进/后退、登录后回跳都落在同一页，而不是回到默认首页。
 * 这个模块保持纯函数（只依赖类型），便于单测直接覆盖解析与规范化规则。
 */
export const ADMIN_NAV: Array<{
  id: AdminTab;
  label: string;
  mobileLabel: string;
  permission: string;
}> = [
  { id: 'overview', label: '仪表盘', mobileLabel: '仪表盘', permission: 'overview.read' },
  { id: 'dashboard', label: '数据大屏', mobileLabel: '大屏', permission: 'overview.read' },
  { id: 'exam', label: '考试中心', mobileLabel: '考试', permission: 'major.read' },
  // 公告是学校自己发的公告（下发到教室大屏）；作者端统一公告仍在「更多 → 查看公告」里。
  { id: 'announcements', label: '公告', mobileLabel: '公告', permission: 'major.read' },
  { id: 'classes', label: '年级与班级', mobileLabel: '班级', permission: 'school.read' },
  { id: 'devices', label: '设备管理', mobileLabel: '设备', permission: 'device.read' },
  { id: 'users', label: '用户与权限', mobileLabel: '用户', permission: 'user.read' },
];

/** 板块 → 访问所需权限。数组顺序即「回落时的优先顺序」。 */
export const ADMIN_TAB_PERMISSIONS = Object.fromEntries(ADMIN_NAV.map((item) => [item.id, item.permission])) as Record<
  AdminTab,
  string
>;

/** 板块 → 展示名（权限拒绝提示、页头副标题用）。 */
export const ADMIN_TAB_LABELS = Object.fromEntries(ADMIN_NAV.map((item) => [item.id, item.label])) as Record<
  AdminTab,
  string
>;

/**
 * 考试中心内部视图：前三个是同一份列表的三个口径，
 * `weekly` / `editor` 复用现有面板（可深链，但不进左栏导航）。
 */
export const EXAM_CENTER_VIEWS: readonly ExamCenterView[] = ['current', 'schedule', 'history', 'weekly', 'editor'];

/** 考试中心不带视图段时的落点。 */
export const DEFAULT_EXAM_VIEW: ExamCenterView = 'current';

/** 一级菜单的路径段（旧链接里的 `?tab=` 取值）。 */
export const ADMIN_SECTIONS: readonly AdminTab[] = ADMIN_NAV.map((item) => item.id);

/**
 * 旧版一级菜单深链（`/admin?tab=major` 等）→ 板块/视图。
 * 概览快捷入口、考试详情页「编辑考试」等历史链接仍可能带这些值，
 * 解析后会被规范化成路径式路由，链接本身也就不会失效。
 */
export const LEGACY_TAB_VIEWS: Record<string, { tab: AdminTab; view?: ExamCenterView }> = {
  records: { tab: 'exam', view: 'current' },
  major: { tab: 'exam', view: 'editor' },
  weekly: { tab: 'exam', view: 'weekly' },
};

export function isAdminTab(value: string): value is AdminTab {
  return ADMIN_SECTIONS.includes(value as AdminTab);
}

export function isExamCenterView(value: string): value is ExamCenterView {
  return EXAM_CENTER_VIEWS.includes(value as ExamCenterView);
}

/** 板块（+考试中心视图）对应的规范路径。 */
export function adminSectionPath(tab: AdminTab, view?: ExamCenterView | null): string {
  if (tab !== 'exam') return `/admin/${tab}`;
  return `/admin/exam/${view ?? DEFAULT_EXAM_VIEW}`;
}

/**
 * 当前 query 里只有这些开关需要跨板块保留（初始化向导、公告/提醒弹窗、先配置后完善）。
 * `tab` / `view` 属于旧深链参数，`account` / `password` / `batch` 属于目标板块的一次性开关，
 * 换板块时都不应该继续跟着走。
 */
const ADMIN_PERSISTENT_QUERY_KEYS = ['allowIncomplete', 'initialize', 'alerts', 'announce'];

/**
 * 生成板块链接：路径 + 需要保留的 query + 本次追加的开关。
 * 页内切板块、打开「我的账户」等入口统一走这里，避免各处手写 URL。
 */
export function adminSectionUrl(input: {
  tab: AdminTab;
  view?: ExamCenterView | null;
  search?: string;
  extra?: Record<string, string>;
}): string {
  const source = new URLSearchParams(input.search ?? '');
  const params = new URLSearchParams();
  for (const key of ADMIN_PERSISTENT_QUERY_KEYS) {
    const value = source.get(key);
    if (value !== null) params.set(key, value);
  }
  for (const [key, value] of Object.entries(input.extra ?? {})) params.set(key, value);
  const query = params.toString();
  return adminSectionPath(input.tab, input.view) + (query ? `?${query}` : '');
}

/** 未指定板块（`/admin`、旧链接、无效板块）时的落点：第一个有权限的板块。 */
export function firstPermittedAdminTab(can: (permission: string) => boolean, fallback: AdminTab): AdminTab {
  return ADMIN_SECTIONS.find((tab) => can(ADMIN_TAB_PERMISSIONS[tab])) ?? fallback;
}

export type AdminRouteState = {
  /** 渲染用的板块。 */
  tab: AdminTab;
  /** 考试中心内部视图；非考试中心为 null。 */
  examView: ExamCenterView | null;
  /** URL 是否明确请求了某个板块（含旧 `?tab=` 深链）。 */
  explicit: boolean;
  /** 规范路径（不含 query）。 */
  path: string;
  /** 当前 URL 是否需要规范化到 `path`（补默认视图、纠正无效板块、旧深链改写）。 */
  redirect: boolean;
};

/**
 * 把 URL 解析成板块/视图，并给出规范路径。
 *
 * `section` / `view` 来自路由参数；`legacyTab` / `legacyView` 来自旧的 `?tab=` 深链。
 * URL 没写板块时先用 `fallbackTab` 占位，真正的落点由页面在拿到权限后
 * 用 `firstPermittedAdminTab` 决定——所以这里只负责「说清楚 URL 请求了什么」。
 */
export function resolveAdminRoute(input: {
  section?: string;
  view?: string;
  legacyTab?: string;
  legacyView?: string;
  fallbackTab: AdminTab;
}): AdminRouteState {
  const section = (input.section ?? '').trim();
  const view = (input.view ?? '').trim();
  const legacyTab = (input.legacyTab ?? '').trim();
  const legacyView = (input.legacyView ?? '').trim();

  const incoming = section ? `/admin/${section}${view ? `/${view}` : ''}` : '/admin';
  // 旧深链的两种写法：`?tab=major`（别名）与 `?tab=devices`（板块名本身）。
  const alias = section ? LEGACY_TAB_VIEWS[section] : LEGACY_TAB_VIEWS[legacyTab];
  const legacySection = !section && !alias && isAdminTab(legacyTab) ? (legacyTab as AdminTab) : null;

  let tab: AdminTab;
  let examView: ExamCenterView | null;
  const explicit = section ? isAdminTab(section) : Boolean(alias ?? legacySection);
  if (section && isAdminTab(section)) {
    tab = section;
    examView = section === 'exam' && isExamCenterView(view) ? (view as ExamCenterView) : null;
  } else if (alias) {
    tab = alias.tab;
    examView = alias.view ?? null;
  } else if (legacySection) {
    tab = legacySection;
    examView = legacySection === 'exam' && isExamCenterView(legacyView) ? (legacyView as ExamCenterView) : null;
  } else {
    tab = input.fallbackTab;
    examView = null;
  }

  const path = adminSectionPath(tab, examView);
  return { tab, examView, explicit, path, redirect: path !== incoming };
}
