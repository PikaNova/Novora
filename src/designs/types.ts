import type React from 'react';
import type { ExamNotification } from '../hooks/useExamNotify';

export type ExamPhaseVM = 'before' | 'live' | 'ended' | 'empty';
export type Urgency = 'normal' | 'warn' | 'critical';

/**
 * 统一的考试展示视图模型。所有设计方案只消费这个模型，
 * 不直接访问同步 / 校时 / 通知 Hook，便于后续接入多版设计。
 */
export interface ExamViewModel {
  masterTitle: string;
  phase: ExamPhaseVM;
  clock: string;            // HH:mm:ss
  dateText: string;         // 北京时间 · 星期日 · 2026.06.07
  currentName: string | null;
  startHM: string | null;   // HH:mm
  endHM: string | null;     // HH:mm
  progressPct: number;      // 0 - 100
  elapsedText: string;      // HH:mm:ss
  remainingText: string;    // HH:mm:ss
  countdownText: string;    // 距开考倒计时 HH:mm:ss
  nextName: string | null;
  nextStartHM: string | null;
  urgency: Urgency;
  timeSynced: boolean;
  /** 当下真实网络在线状态（navigator.onLine + online/offline 事件实时维护）。 */
  online: boolean;
  notification: ExamNotification | null;
}

export interface DesignProps {
  vm: ExamViewModel;
  onDismissNotification: () => void;
  onBack: () => void;
  onAdmin: () => void;
  /** 打开作者端统一发布的 Markdown 公告。 */
  onOpenAnnouncements: () => void;
  /** 打开展示设计切换窗（入口位于各设计顶栏，避免悬浮按钮遮挡元素）。 */
  onSwitchDesign: () => void;
  /** 当前是否处于全屏展示状态。 */
  isFullscreen: boolean;
  /** 切换 / 退出全屏（入口位于各设计顶栏，与其它操作按钮同排，不遮挡元素）。 */
  onToggleFullscreen: () => void;
}

export type DesignComponent = React.ComponentType<DesignProps>;

export type DesignTheme = 'light' | 'dark';

export interface DesignMeta {
  id: string;
  name: string;
  description: string;
  /** 设计切换页的视觉分栏。 */
  theme: DesignTheme;
  component: DesignComponent;
  /** 样例缩略图（data URI），用于切换窗预览。 */
  thumb: string;
  /** 是否已针对手机端窄屏做过布局适配。未适配的设计在手机端会被切换窗置灰并提示“电脑端最佳”。 */
  mobileReady: boolean;
}
