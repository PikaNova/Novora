// api/_exams/diff.ts
// payload diff 工具：规范化比较、记录级 diff、周测生效映射清理。
// 从原 api/exams.ts 抽出，保持单一职责，不依赖数据库或鉴权。

import { canonicalizeForCompare, sameJson } from '../../src/shared/jsonCompare.js';

export { canonicalizeForCompare, sameJson };

type IdentifiedRecord = { id?: unknown };

export function changedRecords<T extends IdentifiedRecord>(before: T[], after: T[]): T[] {
  const left = new Map((Array.isArray(before) ? before : []).map((item) => [String(item?.id ?? ''), item]));
  const right = new Map((Array.isArray(after) ? after : []).map((item) => [String(item?.id ?? ''), item]));
  const ids = new Set([...left.keys(), ...right.keys()]);
  const changed: T[] = [];
  for (const id of ids) {
    const beforeItem = left.get(id);
    const afterItem = right.get(id);
    if (sameJson(beforeItem, afterItem)) continue;
    if (beforeItem) changed.push(beforeItem);
    if (afterItem) changed.push(afterItem);
  }
  return changed;
}

export function recordDiff<T extends IdentifiedRecord>(before: T[], after: T[]) {
  const left = new Map((Array.isArray(before) ? before : []).map((item) => [String(item?.id ?? ''), item]));
  const right = new Map((Array.isArray(after) ? after : []).map((item) => [String(item?.id ?? ''), item]));
  return {
    added: [...right.entries()].filter(([id]) => !left.has(id)).map(([, item]) => item),
    removed: [...left.entries()].filter(([id]) => !right.has(id)).map(([, item]) => item),
    updated: [...right.entries()]
      .filter(([id, item]) => left.has(id) && !sameJson(left.get(id), item))
      .map(([, item]) => item),
  };
}

export function cleanActiveWeeklyPlanByClass(
  value: Record<string, string | null> | undefined,
  classMap: ReadonlyMap<string, unknown>,
): Record<string, string | null> {
  if (!value || typeof value !== 'object') return {};
  const cleaned: Record<string, string | null> = {};
  for (const [classId, planId] of Object.entries(value)) {
    if (!classMap.has(classId)) {
      console.warn(`[exams] dropping stale active weekly plan mapping for deleted class ${classId}`);
      continue;
    }
    cleaned[classId] = planId;
  }
  return cleaned;
}
