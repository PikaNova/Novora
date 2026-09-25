import type { ExamOperationPatch } from '../../src/shared/examLifecycleOperations.js';
import { asRecord } from '../../src/shared/typeGuards.js';
import { examWindowFromItems } from '../../src/utils/examWindow.js';
import type { ExamItem } from '../../src/types/index.js';

/**
 * 由服务端后台动作独占写入的运行期字段。
 *
 * 教室端大屏、ClassIsland 插件与设备心跳读的都是权威快照 `exam_data.majors`，
 * 而客户端保存是**整份覆盖**——它本地那份副本里没有这些字段（它们是后台动作写上去的），
 * 于是任何一次普通编辑都会把它们抹掉：表现为「后台点了暂停/延长/结束，教室端毫无变化」。
 * 这里把它们钉成服务端独占，客户端只读（`startAt/endAt` 仍允许客户端写，新建考试与改时间要用）。
 */
export const SERVER_OWNED_MAJOR_FIELDS = [
  'publishedAt',
  'archivedAt',
  'actualStartAt',
  'pausedAt',
  'pausedMs',
  // 遗留字段：旧的「申请停止」已经下线（2026-09-25），这里保留是为了让结束动作
  // 能把它清干净、并且不让陈旧客户端再把它加回来。
  'stopRequestedAt',
] as const;

/**
 * 正式（大型）考试还独占「结束」相关字段。
 *
 * 快速/临时考试是学校在客户端本地创建与结束的（`endedAt` / `actualEndAt` 由客户端写入，
 * 服务端只做镜像与操作日志补齐），所以这两个字段对它们必须放行，否则「结束临时考试」会失效。
 */
const SERVER_OWNED_FORMAL_ONLY_FIELDS = ['endedAt', 'actualEndAt'] as const;

function isQuickMajor(major: Record<string, unknown>): boolean {
  return major.source === 'quick' || major.temporary === true;
}

function itemsSignature(items: unknown): string {
  return JSON.stringify(Array.isArray(items) ? items : []);
}

/**
 * 结束时间取谁的。
 *
 * `endAt` 平时是客户端可写的（新建考试要写窗口、改时间要跟着科目走），但被后台
 * 「延长 / 暂停顺延」推后过之后，客户端拿着旧副本整份保存就不能再把它改回去 ——
 * 否则延长在教室端立刻失效。判定口径：
 * - 服务端没有结束时间 → 按客户端；
 * - 这次提交改了科目时间（items 变了）→ 说明用户在重排，按客户端；
 * - 客户端没带结束时间、或带的比服务端更早 → 视为陈旧副本，按服务端；
 * - 客户端把结束时间往后推 → 按客户端（新建考试写窗口就是这条路）。
 */
function resolveEndAt(server: Record<string, unknown>, submitted: Record<string, unknown>): unknown {
  const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const serverEndAt = numberOrNull(server.endAt);
  if (serverEndAt == null) return submitted.endAt;
  if (itemsSignature(server.items) !== itemsSignature(submitted.items)) return submitted.endAt;
  const submittedEndAt = numberOrNull(submitted.endAt);
  if (submittedEndAt == null || submittedEndAt < serverEndAt) return serverEndAt;
  return submittedEndAt;
}

/** 服务端科目时间窗（仅用于诊断/兼容旧数据，保留导入以免规则回退时无声失效）。 */
export function serverItemWindowEnd(server: Record<string, unknown>): number | null {
  const window = examWindowFromItems(Array.isArray(server.items) ? (server.items as ExamItem[]) : []);
  return window.end;
}

/**
 * 把服务端已有的运行期字段写回客户端提交的 majors。
 *
 * - 服务端有值的：以服务端为准（客户端不能覆盖、也不能改小）；
 * - 服务端没有的：从提交里删掉（客户端不能把服务端已经清掉的字段又加回来，
 *   例如取消归档后的 `archivedAt`、继续考试后的 `pausedAt`）；
 * - 服务端还不认识这个 id（例如新建的草稿/快速考试）：原样通过。
 */
export function preserveServerLifecycleFields(currentMajors: unknown[], bodyMajors: unknown[]): unknown[] {
  const currentById = new Map<string, Record<string, unknown>>();
  for (const raw of currentMajors) {
    const record = asRecord(raw);
    const id = String(record.id ?? '');
    if (id) currentById.set(id, record);
  }
  return bodyMajors.map((raw) => {
    const major = { ...asRecord(raw) };
    const server = currentById.get(String(major.id ?? ''));
    if (!server) return major;
    const fields =
      isQuickMajor(server) || isQuickMajor(major)
        ? SERVER_OWNED_MAJOR_FIELDS
        : [...SERVER_OWNED_MAJOR_FIELDS, ...SERVER_OWNED_FORMAL_ONLY_FIELDS];
    for (const field of fields) {
      if (server[field] === undefined || server[field] === null) delete major[field];
      else major[field] = server[field];
    }
    const endAt = resolveEndAt(server, major);
    if (endAt === undefined || endAt === null) delete major.endAt;
    else major.endAt = endAt;
    return major;
  });
}

/**
 * 生命周期补丁 → 权威快照（`exam_data.majors[i]`）里的同名字段。
 *
 * 快照仍是唯一权威来源，`exam_records` 只是派生投影；所以任何一次生命周期写入
 * （人工动作、系统自动开考/自动结束）都必须同时落到快照上，否则教室端、ClassIsland 插件
 * 与设备心跳读快照时看到的还是旧状态。
 *
 * 只写补丁里出现过的字段（用 hasOwnProperty 判断可空字段），避免把未涉及的字段抹掉。
 */
export function applyOperationPatchToMajor(major: Record<string, unknown>, patch: ExamOperationPatch): void {
  if (patch.actualStartAt !== undefined) major.actualStartAt = patch.actualStartAt;
  if (patch.actualEndAt !== undefined) major.actualEndAt = patch.actualEndAt;
  if (patch.endAt !== undefined) major.endAt = patch.endAt;
  if (Object.prototype.hasOwnProperty.call(patch, 'pausedAt')) {
    if (patch.pausedAt == null) delete major.pausedAt;
    else major.pausedAt = patch.pausedAt;
  }
  if (patch.pausedMs !== undefined) major.pausedMs = patch.pausedMs;
  if (Object.prototype.hasOwnProperty.call(patch, 'stopRequestedAt')) {
    if (patch.stopRequestedAt == null) delete major.stopRequestedAt;
    else major.stopRequestedAt = patch.stopRequestedAt;
  }
  // 结束同时把 endedAt 写进快照：投影派生态、心跳版本与插件 payload 都看这个字段。
  if (patch.status === 'ended' && patch.actualEndAt !== undefined) major.endedAt = patch.actualEndAt;
}
