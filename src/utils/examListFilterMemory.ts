/**
 * 考试中心列表筛选条件的记忆。
 *
 * 板块切换（当前考试 / 考试安排 / 历史考试）以及「详情 → 编辑考试」都会卸载列表面板，
 * 面板里的 useState 因此清零——用户回来时筛选条件被悄悄重置，看到的是另一个列表。
 * 这里按板块口径存一份内存快照，面板挂载时读回。
 *
 * 只活在当前页面生命周期内（刷新即清空），不落 localStorage：
 * 它要解决的是「同一屏来回切」的连续性，不是跨会话记忆。
 * 分页刻意不记：回来时回到第一页，避免筛完只剩两页却停在第三页的空列表。
 */
export type ExamListFilters = {
  query: string;
  gradeId: string;
  source: '' | 'regular' | 'quick';
  createdBy: string;
  showArchived: boolean;
  draftsOpen: boolean;
  createOpen: boolean;
};

const memory = new Map<string, ExamListFilters>();
/** 分组折叠状态：与筛选条件同一套「切板块回来还在」的语义，单独存以免污染筛选项。 */
const collapsedMemory = new Map<string, string[]>();

export function readExamListFilters(key: string): ExamListFilters | null {
  return memory.get(key) ?? null;
}

export function writeExamListFilters(key: string, value: ExamListFilters): void {
  memory.set(key, value);
}

/** 测试与退出登录时清空；普通使用不需要调用。 */
export function resetExamListFilterMemory(): void {
  memory.clear();
  collapsedMemory.clear();
}

/** 返回 null 表示「这个板块还没被用户调过」，调用方可以据此套用默认展开策略。 */
export function readExamListCollapsed(key: string): string[] | null {
  return collapsedMemory.get(key) ?? null;
}

export function writeExamListCollapsed(key: string, value: string[]): void {
  collapsedMemory.set(key, value);
}
