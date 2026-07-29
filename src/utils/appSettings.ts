import type { ExamItem, MajorExam, AlertState, AlertStateConfig, CustomReminder, AlertsSettings } from '../types';
import type { DesignPolicy, ScheduleMode, WeeklyPlan, WeeklyConflictPolicy } from '../types/exam';
import { DEFAULT_WEEKLY_CONFLICT_POLICY, ALL_SCHEDULE_MODES, ALL_CONFLICT_SCOPES } from '../types/exam';
import { normalizeWeeklyPlan } from './weeklySchedule';
import { logger } from './logger';
import { normalizeExamItems } from './examSchedule';
import { mirrorAppSettings } from '../services/offlineStore';
import type { SchoolClass, SchoolGrade } from '../types/school';

export type { AlertState, AlertStateConfig, CustomReminder, AlertsSettings } from '../types';

export interface TimeSyncSettings {
  enabled: boolean;
  provider: 'httpDate' | 'timeApi' | 'ntp';
  httpDateUrl: string;
  timeApiUrl: string;
  ntpHost: string;
  ntpPort: number;
  manualOffsetMs: number;
  offsetMs: number;
  autoSyncEnabled: boolean;
  autoSyncIntervalSec: number;
  lastSyncAt: number;
  lastRttMs?: number;
  lastError?: string;
}

export interface ExamSettings {
  /** 当前激活的大型考试名称（= 大屏标题，为兼容旧版保留）。 */
  title: string;
  /** 当前激活大型考试的分考试列表（= majors 中激活项的镜像，供展示端直接消费）。 */
  items: ExamItem[];
  /** 全部大型考试。 */
  majors: MajorExam[];
  /** 当前激活的大型考试 id。 */
  activeMajorId: string;
  /** 大屏调度模式（v1.24.0 周测）。 */
  scheduleMode: ScheduleMode;
  /** 全部周测计划。 */
  weeklyPlans: WeeklyPlan[];
  /** 当前参与调度的周测计划 id（v1.24.0 仅单个计划参与）。 */
  activeWeeklyPlanId: string | null;
  activeWeeklyPlanIdByClassId: Record<string, string | null>;
  grades: SchoolGrade[];
  classes: SchoolClass[];
  selectedGradeId: string;
  selectedClassId: string;
  initialization: {
    completedAt: number;
    wizardVersion: number;
    demoDataImported: boolean;
    province: string;
    schoolName: string;
    schoolFullName: string;
  };
  /** 大型考试 vs 周测 的冲突处理策略（v1.24.0 全局默认）。 */
  weeklyConflictPolicy: WeeklyConflictPolicy;
  designPolicy: DesignPolicy;
  alertEnabled: boolean;
  announcementPermanentlyHidden: boolean;
  updatedAt?: number;
}

export interface MajorBatchSubjectGroup {
  id: string;
  name: string;
  subjects: string[];
  custom: true;
  updatedAt: number;
}

export interface MajorBatchTimeSlot {
  start: string;
  end: string;
  dayOffset?: number;
}

export interface MajorBatchTimeGroup {
  id: string;
  name: string;
  slots: MajorBatchTimeSlot[];
  custom: true;
  updatedAt: number;
}

export interface MajorBatchSettings {
  subjectGroups: MajorBatchSubjectGroup[];
  timeGroups: MajorBatchTimeGroup[];
}

export type TypographyFontId = 'design' | 'alibaba' | 'sourceHan' | 'smiley' | 'wenkai' | 'general' | 'jbmono';
export interface TypographySettings {
  navigation: TypographyFontId;
  display: TypographyFontId;
  content: TypographyFontId;
  numeric: TypographyFontId;
}
export const DEFAULT_TYPOGRAPHY: TypographySettings = {
  navigation: 'sourceHan', display: 'design', content: 'sourceHan', numeric: 'jbmono',
};

/** 动效模式：auto=跟随系统“减少动态效果”偏好；best-effects=开满动效；best-performance=关停动画/过渡/毛玻璃以省性能。 */
export type MotionMode = 'auto' | 'best-effects' | 'best-performance';

export interface AppSettings {
  version: number;
  hasVisited: boolean;
  general: {
    timeSync: TimeSyncSettings;
    typography: TypographySettings;
    /** 大屏与全局动效模式。 */
    motionMode: MotionMode;
  };
  exam: ExamSettings;
  majorBatch: MajorBatchSettings;
  /** 全屏提醒浮层的统一管理设置。 */
  alerts: AlertsSettings;
  study: {
    alerts: { errorCenterMode: 'off' | 'memory' | 'persist' };
  };
}

/** 六种内置提醒的默认文案（与效果图一致）。 */
export const DEFAULT_ALERT_STATES: Record<AlertState, AlertStateConfig> = {
  '15min': { enabled: true, label: '准备', title: '距开考 15 分钟', subtext: '请尽快进入考场并对号入座' },
  '5min':  { enabled: true, label: '即将开考', title: '距开考 5 分钟', subtext: '请停止交谈，检查证件与文具' },
  'start': { enabled: true, label: '进行中', title: '开始考试', subtext: '请听从监考安排，开始作答', hero: '现在开始' },
  'end15': { enabled: true, label: '注意', title: '本场剩余 15 分钟', subtext: '请抓紧作答，注意填涂答题卡' },
  'ended': { enabled: true, label: '已结束', title: '本场考试结束', subtext: '请立即停笔，原地等待收卷', hero: '考试结束' },
  'next':  { enabled: true, label: '下一科', title: '下一科目：{subject}', subtext: '{subject} {start} 开考 · 请提前到场候考' },
};

export const DEFAULT_ALERTS: AlertsSettings = {
  enabled: true,
  durationSec: 8,
  states: DEFAULT_ALERT_STATES,
  custom: [],
  silentMode: 'all',
  updatedAt: 0,
};

export function genReminderId(): string {
  return `rmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 规范化任意新旧版提醒设置，补齐缺失字段。 */
export function normalizeAlerts(raw: unknown): AlertsSettings {
  const src = (raw ?? {}) as Partial<AlertsSettings>;
  const states = {} as Record<AlertState, AlertStateConfig>;
  (Object.keys(DEFAULT_ALERT_STATES) as AlertState[]).forEach(k => {
    states[k] = { ...DEFAULT_ALERT_STATES[k], ...((src.states?.[k]) ?? {}) };
  });
  const custom: CustomReminder[] = Array.isArray(src.custom)
    ? src.custom.filter(Boolean).map((c, i) => ({
        id: c.id || `rmd_${i}`,
        name: c.name || `自定义提醒${i + 1}`,
        enabled: c.enabled !== false,
        anchor: c.anchor === 'afterStart' || c.anchor === 'beforeEnd' ? c.anchor : 'beforeStart',
        offsetMin: Number.isFinite(c.offsetMin) ? Math.max(0, Math.round(c.offsetMin)) : 10,
        tone: (['15min','5min','start','end15','ended','next'] as AlertState[]).includes(c.tone) ? c.tone : '15min',
        label: c.label || '提醒',
        title: c.title || '',
        subtext: c.subtext || '',
      }))
    : [];
  return {
    enabled: src.enabled !== false,
    durationSec: Number.isFinite(src.durationSec) ? Math.min(20, Math.max(3, src.durationSec as number)) : 8,
    states,
    custom,
    silentMode: (['all', 'keyOnly', 'pauseUntilExamEnd'] as const).includes(src.silentMode as never) ? (src.silentMode as 'all' | 'keyOnly' | 'pauseUntilExamEnd') : 'all',
    updatedAt: Number(src.updatedAt ?? 0),
  };
}

export const APP_SETTINGS_KEY = 'AppSettings';
/** 同一页面内 localStorage 写入不会触发 storage 事件，使用此事件通知正在运行的页面。 */
export const APP_SETTINGS_CHANGED_EVENT = 'exam-board:settings-changed';

const MAJOR_BATCH_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const DEFAULT_MAJOR_BATCH_SETTINGS: MajorBatchSettings = {
  subjectGroups: [],
  timeGroups: [],
};

function genMajorBatchPresetId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeMajorBatchSubjectGroups(raw: unknown): MajorBatchSubjectGroup[] {
  return (Array.isArray(raw) ? raw : [])
    .filter(Boolean)
    .map((item, index) => {
      const source = item as Partial<MajorBatchSubjectGroup>;
      const subjects = Array.isArray(source.subjects)
        ? [...new Set(source.subjects.map(value => String(value).trim()).filter(Boolean))]
        : [];
      return {
        id: String(source.id || genMajorBatchPresetId('batch_subject_group')),
        name: String(source.name || `自定义科目组 ${index + 1}`).trim(),
        subjects,
        custom: true as const,
        updatedAt: Number.isFinite(source.updatedAt) ? Number(source.updatedAt) : 0,
      };
    })
    .filter(item => item.name && item.subjects.length > 0)
    .slice(0, 24);
}

function normalizeMajorBatchTimeSlots(raw: unknown): MajorBatchTimeSlot[] {
  return (Array.isArray(raw) ? raw : [])
    .filter(Boolean)
    .map((item) => {
      const source = item as Partial<MajorBatchTimeSlot>;
      const dayOffset = Number(source.dayOffset ?? 0);
      return {
        start: String(source.start ?? '').trim(),
        end: String(source.end ?? '').trim(),
        dayOffset: Number.isFinite(dayOffset) ? Math.max(0, Math.min(30, Math.round(dayOffset))) : 0,
      };
    })
    .filter(item => MAJOR_BATCH_TIME_RE.test(item.start) && MAJOR_BATCH_TIME_RE.test(item.end))
    .slice(0, 40);
}

export function normalizeMajorBatchSettings(raw: unknown): MajorBatchSettings {
  const source = (raw ?? {}) as Partial<MajorBatchSettings>;
  const timeGroups = (Array.isArray(source.timeGroups) ? source.timeGroups : [])
    .filter(Boolean)
    .map((item, index) => {
      const value = item as Partial<MajorBatchTimeGroup>;
      return {
        id: String(value.id || genMajorBatchPresetId('batch_time_group')),
        name: String(value.name || `自定义时间组 ${index + 1}`).trim(),
        slots: normalizeMajorBatchTimeSlots(value.slots),
        custom: true as const,
        updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : 0,
      };
    })
    .filter(item => item.name && item.slots.length > 0)
    .slice(0, 24);
  return {
    subjectGroups: normalizeMajorBatchSubjectGroups(source.subjectGroups),
    timeGroups,
  };
}

export function genMajorId(): string {
  return `major_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const DEFAULT_SETTINGS: AppSettings = {
  version: 4,
  hasVisited: false,
  general: {
    typography: DEFAULT_TYPOGRAPHY,
    motionMode: 'auto',
    timeSync: {
      enabled: true,
      provider: 'timeApi',
      httpDateUrl: '/',
      timeApiUrl: '/api/time',
      ntpHost: 'ntp.aliyun.com',
      ntpPort: 123,
      manualOffsetMs: 0,
      offsetMs: 0,
      autoSyncEnabled: true,
      autoSyncIntervalSec: 900,
      lastSyncAt: 0,
    },
  },
  exam: {
    title: '2026年高考',
    items: [],
    majors: [],
    activeMajorId: '',
    scheduleMode: 'major-only',
    weeklyPlans: [],
    activeWeeklyPlanId: null,
    activeWeeklyPlanIdByClassId: {},
    grades: [],
    classes: [],
    selectedGradeId: '',
    selectedClassId: '',
    initialization: { completedAt: 0, wizardVersion: 2, demoDataImported: false, province: '', schoolName: '', schoolFullName: '' },
    weeklyConflictPolicy: DEFAULT_WEEKLY_CONFLICT_POLICY,
    designPolicy: { rules: [], updatedAt: 0 },
    alertEnabled: true,
    announcementPermanentlyHidden: false,
    updatedAt: 0,
  },
  majorBatch: DEFAULT_MAJOR_BATCH_SETTINGS,
  alerts: DEFAULT_ALERTS,
  study: {
    alerts: { errorCenterMode: 'off' },
  },
};

/**
 * 将任意新旧版 exam 数据规范化为含 majors/activeMajorId 的新结构，
 * 并保证 items/title 与激活大型考试保持一致（镜像）。
 */
export function normalizeExam(raw: unknown): ExamSettings {
  const src = (raw ?? {}) as Partial<ExamSettings> & { items?: ExamItem[]; title?: string };
  const base: ExamSettings = {
    ...DEFAULT_SETTINGS.exam,
    ...(src as object),
  };

  let majors: MajorExam[] = Array.isArray(src.majors) ? src.majors.filter(Boolean) : [];

  // 旧版迁移：仅有 items/title 时，包装为单个大型考试。
  if (majors.length === 0) {
    const legacyItems = Array.isArray(src.items) ? src.items : [];
    majors = [{
      id: genMajorId(),
      name: (src.title && src.title.trim()) || '2026年高考',
      items: legacyItems,
      order: 0,
    }];
  }

  majors = majors
    .map((m, i) => ({
      id: m.id || genMajorId(),
      name: m.name || `考试${i + 1}`,
      items: normalizeExamItems(Array.isArray(m.items) ? m.items : []),
      order: typeof m.order === 'number' ? m.order : i,
      targetGradeIds: Array.isArray(m.targetGradeIds) ? m.targetGradeIds.map(String).filter(Boolean) : [],
      targetClassIds: Array.isArray(m.targetClassIds) ? m.targetClassIds.map(String).filter(Boolean) : [],
      source: m.source === 'quick' ? 'quick' as const : 'regular' as const,
      temporary: m.temporary === true || m.source === 'quick',
      priorityOverSchedule: m.priorityOverSchedule === true,
      createdAt: Number.isFinite(m.createdAt) ? Number(m.createdAt) : undefined,
      createdBy: Number.isFinite(m.createdBy) ? Number(m.createdBy) : undefined,
      endedAt: Number.isFinite(m.endedAt) ? Number(m.endedAt) : null,
    }))
    .sort((a, b) => a.order - b.order)
    .map((m, i) => ({ ...m, order: i }));

  let activeMajorId = src.activeMajorId || '';
  if (!majors.some(m => m.id === activeMajorId)) activeMajorId = majors[0].id;
  const active = majors.find(m => m.id === activeMajorId) ?? majors[0];

  // ===== v1.24.0 周测字段 =====
  const scheduleMode: ScheduleMode = ALL_SCHEDULE_MODES.includes(src.scheduleMode as ScheduleMode)
    ? (src.scheduleMode as ScheduleMode)
    : 'major-only';
  const weeklyPlans: WeeklyPlan[] = (Array.isArray(src.weeklyPlans) ? src.weeklyPlans : [])
    .filter(Boolean)
    .map((p, i) => normalizeWeeklyPlan(p, i))
    .sort((a, b) => a.order - b.order)
    .map((p, i) => ({ ...p, order: i }));
  let activeWeeklyPlanId: string | null = src.activeWeeklyPlanId ?? null;
  if (activeWeeklyPlanId && !weeklyPlans.some(p => p.id === activeWeeklyPlanId)) activeWeeklyPlanId = null;
  if (!activeWeeklyPlanId && weeklyPlans.length) activeWeeklyPlanId = weeklyPlans[0].id;
  const grades = (Array.isArray(src.grades) ? src.grades : []).filter(Boolean).map((grade, index) => ({ id: String(grade.id), name: String(grade.name), order: Number.isFinite(grade.order) ? grade.order : index, enabled: grade.enabled !== false }));
  const classes = (Array.isArray(src.classes) ? src.classes : []).filter(Boolean).map((item, index) => ({ id: String(item.id), gradeId: String(item.gradeId), name: String(item.name), order: Number.isFinite(item.order) ? item.order : index, enabled: item.enabled !== false })).filter(item => grades.some(grade => grade.id === item.gradeId));
  const rawByClass = src.activeWeeklyPlanIdByClassId && typeof src.activeWeeklyPlanIdByClassId === 'object' ? src.activeWeeklyPlanIdByClassId : {};
  const activeWeeklyPlanIdByClassId: Record<string, string | null> = {};
  for (const item of classes) {
    const value = rawByClass[item.id];
    activeWeeklyPlanIdByClassId[item.id] = typeof value === 'string' && weeklyPlans.some(plan => plan.id === value && plan.classId === item.id) ? value : (weeklyPlans.find(plan => plan.classId === item.id)?.id ?? null);
  }
  const selectedGradeId = grades.some(grade => grade.id === src.selectedGradeId) ? String(src.selectedGradeId) : '';
  const selectedClassId = classes.some(item => item.id === src.selectedClassId && item.gradeId === selectedGradeId) ? String(src.selectedClassId) : '';
  const rawInitialization = (src.initialization && typeof src.initialization === 'object' ? src.initialization : {}) as Partial<ExamSettings['initialization']>;
  const initialization = {
    completedAt: Number(rawInitialization.completedAt ?? 0),
    wizardVersion: Math.max(1, Number(rawInitialization.wizardVersion ?? 1)),
    demoDataImported: rawInitialization.demoDataImported === true,
    province: String(rawInitialization.province ?? '').trim(),
    schoolName: String(rawInitialization.schoolName ?? '').trim(),
    schoolFullName: String(rawInitialization.schoolFullName ?? rawInitialization.schoolName ?? '').trim(),
  };
  base.designPolicy = {
    rules: Array.isArray(src.designPolicy?.rules) ? src.designPolicy.rules.filter(rule => rule && typeof rule.designId === 'string') : [],
    updatedAt: Number(src.designPolicy?.updatedAt ?? 0),
  };
  const weeklyConflictPolicy = normalizeConflictPolicy(src.weeklyConflictPolicy);

  return {
    ...base,
    majors,
    activeMajorId,
    scheduleMode,
    weeklyPlans,
    activeWeeklyPlanId,
    activeWeeklyPlanIdByClassId,
    grades,
    classes,
    selectedGradeId,
    selectedClassId,
    initialization,
    weeklyConflictPolicy,
    // items/title 始终镜像激活大型考试，保证展示端无需改动。
    title: active.name,
    items: active.items,
  };
}

/** 规范化冲突策略，补齐缺省并纠正非法值。 */
export function normalizeConflictPolicy(raw: unknown): WeeklyConflictPolicy {
  const s = (raw ?? {}) as Partial<WeeklyConflictPolicy>;
  const scope = ALL_CONFLICT_SCOPES.includes(s.scope as never)
    ? (s.scope as WeeklyConflictPolicy['scope'])
    : DEFAULT_WEEKLY_CONFLICT_POLICY.scope;
  return {
    enabled: s.enabled !== false,
    scope,
    bufferBeforeMinutes: Number.isFinite(s.bufferBeforeMinutes) ? Math.max(0, Math.round(s.bufferBeforeMinutes as number)) : 0,
    bufferAfterMinutes: Number.isFinite(s.bufferAfterMinutes) ? Math.max(0, Math.round(s.bufferAfterMinutes as number)) : 0,
  };
}

export function getAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    const settings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      general: {
        ...DEFAULT_SETTINGS.general,
        ...parsed.general,
        timeSync: { ...DEFAULT_SETTINGS.general.timeSync, ...(parsed.general?.timeSync ?? {}) },
        typography: { ...DEFAULT_TYPOGRAPHY, ...(parsed.general?.typography ?? {}) },
      },
      exam: normalizeExam(parsed.exam),
      majorBatch: normalizeMajorBatchSettings(parsed.majorBatch),
      alerts: normalizeAlerts(parsed.alerts),
      study: {
        ...DEFAULT_SETTINGS.study,
        ...parsed.study,
        alerts: { ...DEFAULT_SETTINGS.study.alerts, ...(parsed.study?.alerts ?? {}) },
      },
    };
    // 自动把旧 localStorage 数据迁移为 IndexedDB 持久镜像；失败不影响旧版读取。
    void mirrorAppSettings(settings);
    return settings;
  } catch (e) {
    logger.error('Failed to load AppSettings', e);
    return DEFAULT_SETTINGS;
  }
}

export function updateAppSettings(partial: Partial<AppSettings> | ((c: AppSettings) => Partial<AppSettings>)): void {
  try {
    const current = getAppSettings();
    const updates = typeof partial === 'function' ? partial(current) : partial;
    const next: AppSettings = {
      ...current,
      ...updates,
      general: updates.general
        ? { ...current.general, ...updates.general,
            timeSync: { ...current.general.timeSync, ...(updates.general.timeSync ?? {}) },
            typography: { ...current.general.typography, ...(updates.general.typography ?? {}) } }
        : current.general,
      exam: updates.exam ? normalizeExam({ ...current.exam, ...updates.exam }) : current.exam,
      majorBatch: updates.majorBatch ? normalizeMajorBatchSettings({ ...current.majorBatch, ...updates.majorBatch }) : current.majorBatch,
      alerts: updates.alerts ? normalizeAlerts({ ...current.alerts, ...updates.alerts }) : current.alerts,
    };
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
    void mirrorAppSettings(next);
    // storage 事件只会通知其他同源窗口；当前窗口也必须立即收到本地数据变更。
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(APP_SETTINGS_CHANGED_EVENT));
  } catch (e) {
    logger.error('Failed to save AppSettings', e);
  }
}

export function updateExamSettings(updates: Partial<ExamSettings>): void {
  updateAppSettings(c => ({ exam: normalizeExam({ ...c.exam, ...updates }) }));
}

export function updateMajorBatchSettings(updates: Partial<MajorBatchSettings>): void {
  updateAppSettings(c => ({ majorBatch: normalizeMajorBatchSettings({ ...c.majorBatch, ...updates }) }));
}

export function updateAlertsSettings(updates: Partial<AlertsSettings>): void {
  updateAppSettings(c => ({ alerts: normalizeAlerts({ ...c.alerts, ...updates }) }));
}

export function updateMotionMode(mode: MotionMode): void {
  updateAppSettings(c => ({ general: { ...c.general, motionMode: mode } }));
}

export function updateTimeSyncSettings(
  updates: Partial<TimeSyncSettings> | ((c: TimeSyncSettings) => Partial<TimeSyncSettings>)
): void {
  updateAppSettings(c => {
    const base = c.general.timeSync;
    const patch = typeof updates === 'function' ? updates(base) : updates;
    return { general: { ...c.general, timeSync: { ...base, ...patch } } };
  });
}
