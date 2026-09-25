// api/_exams/plugin.ts
// ClassIsland 插件相关：凭据解析与哈希、API 元信息、班级标签、范围标签与有效考试解析。
// 从原 api/exams.ts 抽出，保持单一职责。

import { createHash, timingSafeEqual } from 'node:crypto';
import { resolveEffectiveSchedule } from '../../src/utils/scheduleConflict.js';
import { parseZonedTime } from '../../src/utils/zonedTime.js';
import type { AdminActor } from '../_auth.js';
import type { ExamPayload } from './payload.js';
import { asRecord } from '../../src/shared/typeGuards.js';
import { DEVICE_ONLINE_WINDOW_MS } from '../../src/shared/deviceContracts.js';
import type { MajorExam } from '../../src/types/index.js';
import type { ScheduleMode, WeeklyConflictPolicy, WeeklyPlan } from '../../src/types/exam.js';

export const PLUGIN_PAIR_TTL_MS = 5 * 60 * 1000;
export const PLUGIN_VIEWER_ONLINE_MS = DEVICE_ONLINE_WINDOW_MS;
export const CLASSISLAND_API_VERSION = 2;
export const CLASSISLAND_API_CAPABILITIES = [
  'pairing',
  'class-binding',
  'schedule-sync',
  'viewer-link',
  'exam-source',
] as const;
export const PLUGIN_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;
export const PLUGIN_SECRET_RE = /^[a-f0-9]{32,256}$/i;
export const PLUGIN_TOKEN_RE = /^[a-f0-9]{32,256}$/i;

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function equalHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function pluginCredentials(body: Record<string, unknown>): { instanceId: string; secret: string } | null {
  const instanceId = String(body.pluginInstanceId ?? '').trim();
  const secret = String(body.clientSecret ?? '').trim();
  return PLUGIN_ID_RE.test(instanceId) && PLUGIN_SECRET_RE.test(secret) ? { instanceId, secret } : null;
}

export function classIslandApiMeta() {
  return {
    apiVersion: CLASSISLAND_API_VERSION,
    minApiVersion: 1,
    capabilities: CLASSISLAND_API_CAPABILITIES,
  };
}

export function classLabel(payload: ExamPayload, gradeId: string, classId: string): string {
  const grades = (Array.isArray(payload.grades) ? payload.grades : []).map(asRecord);
  const classes = (Array.isArray(payload.classes) ? payload.classes : []).map(asRecord);
  const grade = grades.find((item) => String(item.id ?? '') === gradeId);
  const schoolClass = classes.find((item) => String(item.id ?? '') === classId);
  return [grade?.name, schoolClass?.name].filter(Boolean).map(String).join(' ');
}

export function actorScopeLabel(actor: AdminActor, payload: ExamPayload): string {
  if (actor.permissions.includes('*') || actor.scopes.some((scope) => scope.type === 'all')) return '全校';
  const grades = (Array.isArray(payload.grades) ? payload.grades : []).map(asRecord);
  const names = actor.scopes
    .map((scope) => {
      if (scope.type === 'grade')
        return String(grades.find((item) => String(item.id ?? '') === scope.gradeId)?.name ?? scope.gradeId);
      if (scope.type === 'class') return classLabel(payload, scope.gradeId, scope.classId).replace(' ', ' · ');
      return '';
    })
    .filter(Boolean);
  return names.join('、') || '未分配范围';
}

export function resolvePluginExams(payload: ExamPayload, gradeId: string, classId: string) {
  const now = Date.now();
  const schedule = resolveEffectiveSchedule(
    {
      scheduleMode: payload.scheduleMode as ScheduleMode,
      activeMajorId: payload.activeMajorId || null,
      activeWeeklyPlanId: payload.activeWeeklyPlanId || null,
      activeWeeklyPlanIdByClassId: payload.activeWeeklyPlanIdByClassId as Record<string, string | null>,
      selectedGradeId: gradeId,
      selectedClassId: classId,
      majors: payload.majors as MajorExam[],
      weeklyPlans: payload.weeklyPlans as WeeklyPlan[],
      weeklyConflictPolicy: payload.weeklyConflictPolicy as WeeklyConflictPolicy | undefined,
    },
    now,
    { daysBack: 1, daysForward: 30 },
  );
  return schedule.activeItems.flatMap((item) => {
    const start = parseZonedTime(item.startTime);
    const end = parseZonedTime(item.endTime);
    if (!item.enabled || !Number.isFinite(start) || !Number.isFinite(end) || end <= now - 2 * 60 * 1000) return [];
    const source = item as typeof item & {
      kind?: string;
      majorName?: string;
      note?: string;
    };
    return [
      {
        id: item.id,
        name: item.name,
        startAt: new Date(start).toISOString(),
        endAt: new Date(end).toISOString(),
        kind: source.kind || 'major',
        sourceName: source.majorName || '',
        note: source.note || '',
      },
    ];
  });
}
