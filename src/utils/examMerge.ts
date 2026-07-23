import type { AlertsSettings, ExamItem, MajorExam } from '../types';

export interface MergeableExamPayload {
  items: ExamItem[];
  title: string;
  majors: MajorExam[];
  activeMajorId: string;
  alerts: AlertsSettings | null;
  updatedAt: number;
}

export interface ExamMergeResult {
  payload: MergeableExamPayload;
  /** 同一字段被两端同时改成不同值时的数量；自动合并时保留本机值。 */
  conflictCount: number;
}

const MISSING = Symbol('missing');
type MergeValue = unknown | typeof MISSING;
type MergeContext = { conflicts: number };

function equal(a: MergeValue, b: MergeValue): boolean {
  if (a === MISSING || b === MISSING) return a === b;
  if (Object.is(a, b)) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

function clone<T>(value: T): T {
  if (value === MISSING || value == null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function isObject(value: MergeValue): value is Record<string, unknown> {
  return value !== MISSING && value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIdArray(value: MergeValue): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every(entry => isObject(entry) && typeof entry.id === 'string');
}

function mergeIdArray(base: Array<Record<string, unknown>>, local: Array<Record<string, unknown>>, remote: Array<Record<string, unknown>>, ctx: MergeContext): Array<Record<string, unknown>> {
  const byId = (list: Array<Record<string, unknown>>) => new Map(list.map(item => [String(item.id), item]));
  const baseById = byId(base);
  const localById = byId(local);
  const remoteById = byId(remote);
  // 先遵从本机顺序，再补入远端新增项，最后保留基线中仍存在的项目。
  const ids = [...local, ...remote, ...base].map(item => String(item.id)).filter((id, index, all) => all.indexOf(id) === index);
  const merged: Array<Record<string, unknown>> = [];
  for (const id of ids) {
    const value = mergeValue(
      baseById.has(id) ? baseById.get(id)! : MISSING,
      localById.has(id) ? localById.get(id)! : MISSING,
      remoteById.has(id) ? remoteById.get(id)! : MISSING,
      ctx,
    );
    if (value !== MISSING) merged.push(value as Record<string, unknown>);
  }
  return merged;
}

function mergeObject(base: Record<string, unknown>, local: Record<string, unknown>, remote: Record<string, unknown>, ctx: MergeContext): Record<string, unknown> {
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  const merged: Record<string, unknown> = {};
  for (const key of keys) {
    const value = mergeValue(
      Object.prototype.hasOwnProperty.call(base, key) ? base[key] : MISSING,
      Object.prototype.hasOwnProperty.call(local, key) ? local[key] : MISSING,
      Object.prototype.hasOwnProperty.call(remote, key) ? remote[key] : MISSING,
      ctx,
    );
    if (value !== MISSING) merged[key] = value;
  }
  return merged;
}

/**
 * 标准三方合并：base 为最近一次成功同步的云端快照，local 为本机待保存数据，remote 为 409 返回的云端新版本。
 * - 只有一端变更某字段：采用变更值。
 * - 两端各自新增不同 id 的大型考试/科目/提醒：保留两边。
 * - 同一字段同时改成不同值：保留本机值并计数，避免用户当前编辑被静默覆盖。
 */
function mergeValue(base: MergeValue, local: MergeValue, remote: MergeValue, ctx: MergeContext): MergeValue {
  if (equal(local, base)) return clone(remote);
  if (equal(remote, base)) return clone(local);
  if (equal(local, remote)) return clone(local);

  if (isObject(base) && isObject(local) && isObject(remote)) return mergeObject(base, local, remote, ctx);
  if (isIdArray(base) && isIdArray(local) && isIdArray(remote)) return mergeIdArray(base, local, remote, ctx);

  // 无可识别 id 的并发数组/标量冲突采用本机优先，确保当前操作者的未保存编辑不丢失。
  ctx.conflicts += 1;
  return clone(local);
}

export function threeWayMergeExam(base: MergeableExamPayload, local: MergeableExamPayload, remote: MergeableExamPayload): ExamMergeResult {
  const ctx: MergeContext = { conflicts: 0 };
  const majors = mergeValue(base.majors, local.majors, remote.majors, ctx) as MajorExam[];
  let activeMajorId = mergeValue(base.activeMajorId, local.activeMajorId, remote.activeMajorId, ctx) as string;
  if (!majors.some(major => major.id === activeMajorId)) activeMajorId = majors[0]?.id ?? '';
  const active = majors.find(major => major.id === activeMajorId) ?? majors[0];
  const alerts = mergeValue(base.alerts, local.alerts, remote.alerts, ctx) as AlertsSettings | null;

  return {
    payload: {
      // 始终由激活大型考试生成镜像字段，避免旧 items/title 与 majors 脱节。
      items: active?.items ?? [],
      title: active?.name || local.title || remote.title,
      majors,
      activeMajorId,
      alerts,
      updatedAt: remote.updatedAt,
    },
    conflictCount: ctx.conflicts,
  };
}
