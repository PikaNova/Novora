export type AppMode = 'clock' | 'countdown' | 'stopwatch' | 'study' | 'exam';

/** 分考试（单场科目），如：语文、数学。 */
export interface ExamItem {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  enabled: boolean;
  order: number;
  /** 该分考试额外限定的适用年级；为空表示沿用所属大型考试范围。 */
  targetGradeIds?: string[];
  /** 该分考试额外限定的适用班级；为空表示沿用所属大型考试范围。 */
  targetClassIds?: string[];
  kind?: 'major' | 'weekly' | 'temporary';
  majorExamId?: string;
  majorName?: string;
}

/**
 * 大型考试（考试场次容器），如：2026年高考、期中考试。
 * 每个大型考试拥有自己独立的一组分考试（items）。
 */
export interface MajorExam {
  id: string;
  name: string;
  items: ExamItem[];
  order: number;
  /** 适用年级；为空表示所有年级。 */
  targetGradeIds?: string[];
  /** 适用班级；为空表示所选年级下全部班级。 */
  targetClassIds?: string[];
  /** regular 为常规考试；quick 为后台临时下发的统一考试。 */
  source?: 'regular' | 'quick';
  /** 临时统一考试结束后仍保留记录，便于后台追溯或转存为正式考试。 */
  temporary?: boolean;
  /** 仅临时统一考试可用：在同一时间段优先展示本次安排。 */
  priorityOverSchedule?: boolean;
  createdAt?: number;
  createdBy?: number;
  /**
   * 考试窗口（毫秒时间戳）。正式考试由「开始/结束时间」写入，快速考试在发布时按科目时间算出；
   * 服务端据此推导 `exam_records.start_at / end_at`，记录层（列表、进行中判定、延长）都靠它。
   */
  startAt?: number | null;
  endAt?: number | null;
  /** 实际开考时刻；服务端生命周期操作写入，用于「已进行时长」口径。 */
  actualStartAt?: number | null;
  /** 实际结束时刻；快速考试提前结束时写入，与服务端 record-end 的 actual_end_at 对齐。 */
  actualEndAt?: number | null;
  /** 暂停起始时刻；非空表示当前处于暂停中，倒计时冻结并顺延结束时间。 */
  pausedAt?: number | null;
  /** 累计暂停时长（毫秒）；倒计时按 `endAt + pausedMs` 计算。 */
  pausedMs?: number;
  /** 发布时刻；非空表示这场考试已经下发到教室大屏。 */
  publishedAt?: number | null;
  endedAt?: number | null;
  /** 归档时刻；非空表示这场考试已进入只读历史，需先取消归档才能再编辑。 */
  archivedAt?: number | null;
}

/** 六种内置提醒状态（与设计思路文档一一对应）。 */
export type AlertState = '15min' | '5min' | 'start' | 'end15' | 'ended' | 'next';

/** 内置提醒的可配置文案。 */
export interface AlertStateConfig {
  enabled: boolean;
  /** 胶囊 / 方括号状态标签，如：准备、即将开考。 */
  label: string;
  /** 语义色主文案，如：距开考 15 分钟。支持占位符 {subject}/{start}/{end}/{next}/{nextTime}。 */
  title: string;
  /** 底部副提示条。同样支持占位符。 */
  subtext: string;
  /** 仅 start/ended 使用的超大主视觉文字（倒计时类状态无需）。 */
  hero?: string;
}

/** 自定义提醒：相对当前科目的开考/结束时刻偏移触发。 */
export interface CustomReminder {
  id: string;
  name: string;
  enabled: boolean;
  /** 锤点：开考前 / 开考后 / 结束前。 */
  anchor: 'beforeStart' | 'afterStart' | 'beforeEnd';
  /** 偏移分钟数。 */
  offsetMin: number;
  /** 借用哪个语义色调。 */
  tone: AlertState;
  label: string;
  title: string;
  subtext: string;
}

/** 统一提醒管理设置。 */
export interface AlertsSettings {
  /** 总开关：是否启用全屏提醒浮层。 */
  enabled: boolean;
  /** 默认停留时长（秒，6–12）。 */
  durationSec: number;
  /** 六种内置状态配置。 */
  states: Record<AlertState, AlertStateConfig>;
  /** 用户自定义提醒。 */
  custom: CustomReminder[];
  /** 静默模式：all=全部；keyOnly=仅关键（5分钟/开考/结束/下一科）；pauseUntilExamEnd=本场进行中暂停提醒。 */
  silentMode?: 'all' | 'keyOnly' | 'pauseUntilExamEnd';
  updatedAt?: number;
}
