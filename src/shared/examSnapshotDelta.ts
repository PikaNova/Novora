/**
 * 快照的「域级增量读」：`GET /api/exams?resource=snapshot&since=<修订号表>`。
 *
 * 为什么需要：整份快照 ~135KB（20 个班级、8 个科目、周测计划、初始化状态…）。服务端
 * `updated_at` 是文档级版本，改一下提醒设置也会让它前进，客户端随即把整份重下一遍
 * （线上 HAR 里那次 135KB 传输花了 1.17s）。而写路径本来就按修订域记账
 * （`EXAM_REVISION_DOMAINS`，用于「两台设备改不同域不互相 409」），读路径可以共用这把尺子：
 * 只回「这个客户端手上那份之后真的变了」的域。
 *
 * 边界都在这里，服务端与客户端共用同一份实现，避免两边对「哪个域变了」理解不一致。
 */
import {
  EXAM_REVISION_DOMAINS,
  EXAM_REVISION_DOMAIN_FIELDS,
  parseExamRevisions,
  type ExamRevisionDomain,
} from './examSaveDiff.js';

/** 已被某个修订域覆盖的字段：这些字段只在对应域变化时下发。 */
const DOMAIN_FIELDS = new Set<string>(
  EXAM_REVISION_DOMAINS.flatMap((domain) => [...EXAM_REVISION_DOMAIN_FIELDS[domain]]),
);

/**
 * 无论哪个域变了都要带上的字段，以及永远不带的字段。
 *
 * - 带上：不属于任何修订域的字段（设计规则、批量预设、扩展元数据、生命周期…）。
 *   它们由服务端动作或维护流程写入，**不推进任何域的修订号**，所以不能靠修订号判「没变」。
 *   好在体积都很小，每次直接带上，既不会漏刷新也不会把增量读变回整份读。
 * - 不带：`binding` 是设备身份，走自己的通道（心跳 / device-bindings / bootstrap），
 *   不能在快照增量里被写成 null 把缓存里的绑定冲掉；`ok` 是响应信封。
 */
const NEVER_SENT_IN_PARTIAL = new Set(['ok', 'binding', 'revisions', 'updatedAt']);

export type ExamSnapshotDelta = {
  /** 与客户端基线相比确实变了的修订域（空数组表示这几个域都不用刷）。 */
  changedDomains: ExamRevisionDomain[];
  /** 要下发的字段：变了的那几个域 + 每次必带的非域字段。 */
  fields: Record<string, unknown>;
  revisions: Record<string, number>;
  updatedAt: number;
};

/** 与某个域无关、但每次增量都要刷新的字段。 */
export function examSnapshotAlwaysFreshFields(payload: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (NEVER_SENT_IN_PARTIAL.has(key) || DOMAIN_FIELDS.has(key)) continue;
    fields[key] = value;
  }
  return fields;
}

/**
 * 逐域比较客户端已知的修订号与当前修订号：
 *   - 已知且相同 → 这个域客户端手上就是最新的，不做下发；
 *   - 未知（客户端没带这个域）或不相同 → 下发该域的字段。
 */
export function examSnapshotDelta(payload: Record<string, unknown>, since: Record<string, number>): ExamSnapshotDelta {
  const revisions = parseExamRevisions(payload.revisions);
  const fields = examSnapshotAlwaysFreshFields(payload);
  const changedDomains: ExamRevisionDomain[] = [];
  for (const domain of EXAM_REVISION_DOMAINS) {
    const known = since[domain];
    if (typeof known === 'number' && Number.isFinite(known) && known === (revisions[domain] ?? 0)) continue;
    changedDomains.push(domain);
    for (const field of EXAM_REVISION_DOMAIN_FIELDS[domain]) {
      if (Object.prototype.hasOwnProperty.call(payload, field)) fields[field] = payload[field];
    }
  }
  return { changedDomains, fields, revisions, updatedAt: Number(payload.updatedAt ?? 0) };
}

/**
 * 解析客户端带来的 `since`。必须是「每个修订域都有合法数字」的对象：缺域说明客户端
 * 那份缓存不可全信，这时宁可整份下发（返回 null）。
 */
export function parseSinceRevisions(value: unknown): Record<string, number> | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const result: Record<string, number> = {};
    for (const domain of EXAM_REVISION_DOMAINS) {
      const raw = record[domain];
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
      result[domain] = raw;
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * 客户端把增量载荷叠加回本地缓存。
 *
 * 必须对**原始 JSON** 叠加后再交给 `parseExamPayload`：若把部分载荷直接解析，
 * 缺席字段会被填成默认值（空数组 / null），反而把缓存里的真实内容抹掉。
 * 没有缓存时返回 null，调用方退回整份读取。
 */
export function mergeExamSnapshotPartial(
  cached: Record<string, unknown> | null | undefined,
  partial: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!cached) return null;
  const merged: Record<string, unknown> = { ...cached };
  for (const [key, value] of Object.entries(partial)) {
    if (key === 'ok' || key === 'partial') continue;
    merged[key] = value;
  }
  return merged;
}
