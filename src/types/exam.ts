import type { ExamItem, MajorExam } from './index.js';

/**
 * 周测（v1.24.0）相关类型定义。
 *
 * 设计原则：数据库只保存“周期规则”，客户端在运行时把规则展开成标准 ExamItem
 * 实例，最终统一交给大屏 / 首页 / 13 套设计 / 提醒系统消费——上层完全不理解周测结构。
 */

/** 大屏运行模式：决定“展示什么”，与后台“编辑哪个 tab”解耦。 */
export type ScheduleMode = 'major-only' | 'weekly-only' | 'automatic';

/** 后台当前编辑的模块（仅影响编辑界面，不决定大屏显示）。 */
export type AdminTab = 'overview' | 'dashboard' | 'major' | 'weekly' | 'classes' | 'devices' | 'users';

export type DesignRuleScope = 'school' | 'grade' | 'class' | 'device';
export interface DesignAssignmentRule {
  id: string;
  scope: DesignRuleScope;
  scopeId: string;
  designId: string;
}
export interface DesignPolicy {
  rules: DesignAssignmentRule[];
  updatedAt: number;
}

/** 大型考试与周测的冲突作用范围。 */
export type WeeklyConflictScope =
  | 'time-overlap'        // 仅实际时间段重叠时暂停周测（月考、部分时段考试）
  | 'whole-day'           // 当天存在大型考试即暂停当天全部周测（推荐默认）
  | 'whole-major-period'; // 从第一门到最后一门期间全部暂停周测（中高考、期末考试周）

/** 冲突处理策略。v1.24.0 作为全局默认策略存在 ExamBoardData 上。 */
export interface WeeklyConflictPolicy {
  enabled: boolean;
  scope: WeeklyConflictScope;
  /** 大型考试开始前多少分钟起停周测（仅 time-overlap 生效）。 */
  bufferBeforeMinutes: number;
  /** 大型考试结束后多少分钟内仍占用（仅 time-overlap 生效）。 */
  bufferAfterMinutes: number;
}

/** ISO 星期：1=周一 … 7=周日。 */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type WeeklyWeekMode = 'single' | 'ab';
export type WeeklyWeekType = 'all' | 'a' | 'b';

/** 单条周测规则（周期项，不含具体日期）。 */
export interface WeeklyExamItem {
  id: string;
  name: string;
  weekday: IsoWeekday;
  /** 'HH:mm' 本地（上海）时间。 */
  startTime: string;
  /** 'HH:mm' 本地（上海）时间。 */
  endTime: string;
  /** 结束时间落在第二天。 */
  endNextDay?: boolean;
  enabled: boolean;
  order: number;
  location?: string;
  note?: string;
  /** A/B 周模式下的适用周；旧数据默认 all。 */
  weekType?: WeeklyWeekType;
}

/** 单次例外：取消或临时修改某一天的某条周测（v1.24.1 起提供 UI，v1.24.0 解析器已支持）。 */
export interface WeeklyExamOverride {
  id: string;
  /** 指向 WeeklyExamItem.id。 */
  sourceItemId: string;
  /** 'YYYY-MM-DD'（上海日历日）。 */
  date: string;
  /** 临时调课后的实际日期；缺省时仍在原日期执行。 */
  targetDate?: string;
  action: 'cancel' | 'replace';
  name?: string;
  startTime?: string;
  endTime?: string;
  endNextDay?: boolean;
  /** 与大型考试冲突时强制保留本次。 */
  forceRunDuringMajorExam?: boolean;
  reason?: string;
}

/** 一个周测计划（对应一个学期/年级/班级的固定安排）。 */
export interface WeeklyPlan {
  id: string;
  name: string;
  enabled: boolean;
  timezone: 'Asia/Shanghai';
  /** 'YYYY-MM-DD' 生效日期（含）。 */
  activeFrom: string;
  /** 'YYYY-MM-DD' 结束日期（含），null 表示长期有效。 */
  activeUntil: string | null;
  /** 每几周重复：1=每周，2=隔周，N=每 N 周。建议 1–8。 */
  repeatEveryWeeks: number;
  /** 'YYYY-MM-DD' 基准周锚点，用于隔周/每 N 周对齐。 */
  anchorDate: string;
  /** single=统一周表；ab=锚点周为 A 周、下一周为 B 周。 */
  weekMode?: WeeklyWeekMode;
  /** 自动排除内置的中国法定节假日放假日期。 */
  excludeOfficialHolidays?: boolean;
  items: WeeklyExamItem[];
  /** 整日排除（'YYYY-MM-DD' 列表）。 */
  excludedDates: string[];
  overrides: WeeklyExamOverride[];
  order: number;
  gradeId: string;
  classId: string;
}

/** 顶层 Novora 看板数据（schemaVersion 2）。 */
export interface ExamBoardData {
  schemaVersion: 3;
  scheduleMode: ScheduleMode;
  activeMajorId: string | null;
  activeWeeklyPlanId: string | null;
  majors: MajorExam[];
  weeklyPlans: WeeklyPlan[];
  /** 每个班级当前生效的周测计划。未分组仍回退 activeWeeklyPlanId。 */
  activeWeeklyPlanIdByClassId?: Record<string, string | null>;
  selectedGradeId?: string;
  selectedClassId?: string;
  /** v1.24.0：全局冲突策略（后续版本可下放到单个大型考试）。 */
  weeklyConflictPolicy: WeeklyConflictPolicy;
  designPolicy?: DesignPolicy;
  updatedAt: number;
}

/**
 * 周测被展开后的实例。结构上 **是** 一个标准 ExamItem（id = occurrenceId），
 * 因此可被现有展示 / 提醒系统直接消费；额外字段供后台预览与冲突处理使用。
 */
export interface WeeklyOccurrence extends ExamItem {
  kind: 'weekly';
  occurrenceId: string;
  weeklyPlanId: string;
  weeklyItemId: string;
  /** 'YYYY-MM-DD' 上海日历日。 */
  date: string;
  /** 由 override 标记的“强制保留”。 */
  forced: boolean;
}

/** 参与冲突判断的一个大型考试块。 */
export interface MajorScheduleBlock {
  id: string;
  name: string;
  items: ExamItem[];
  policy: WeeklyConflictPolicy;
}

/** 一条冲突记录。 */
export interface ScheduleConflict {
  id: string;
  type: 'time-overlap' | 'whole-day' | 'whole-major-period' | 'buffer-overlap';
  majorExamId: string;
  majorItemId?: string;
  weeklyPlanId: string;
  weeklyItemId: string;
  weeklyOccurrenceId: string;
  date: string;
  majorName: string;
  weeklyName: string;
  majorStartTime: string;
  majorEndTime: string;
  weeklyStartTime: string;
  weeklyEndTime: string;
  resolution: 'major-wins' | 'weekly-forced';
  message: string;
}

/** 统一调度解析结果。 */
export interface ResolvedSchedule {
  /** 最终参与大屏 / 首页 / 提醒的标准考试时间线（大型考试 + 生效周测，按时间排序）。 */
  activeItems: ExamItem[];
  /** 被大型考试暂停的周测实例（仅后台预览可见，不进提醒队列）。 */
  suppressedWeeklyItems: ExamItem[];
  /** 冲突记录（含 major-wins 与 weekly-forced）。 */
  conflicts: ScheduleConflict[];
}

/** 校验问题。 */
export interface ScheduleValidationIssue {
  level: 'error' | 'warn';
  code: string;
  message: string;
  itemId?: string;
}

/** v1.24.0 默认冲突策略：整日暂停、无缓冲。 */
export const DEFAULT_WEEKLY_CONFLICT_POLICY: WeeklyConflictPolicy = {
  enabled: true,
  scope: 'whole-day',
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
};

export const ALL_SCHEDULE_MODES: ScheduleMode[] = ['major-only', 'weekly-only', 'automatic'];
export const ALL_CONFLICT_SCOPES: WeeklyConflictScope[] = ['time-overlap', 'whole-day', 'whole-major-period'];
