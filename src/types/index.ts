export type AppMode = 'clock' | 'countdown' | 'stopwatch' | 'study' | 'exam';

/** 分考试（单场科目），如：语文、数学。 */
export interface ExamItem {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  enabled: boolean;
  order: number;
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
