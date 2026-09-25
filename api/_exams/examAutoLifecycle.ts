/**
 * 考试生命周期的「系统自动推进」。
 *
 * 约定：创建即发布 → 到点由系统自动开考 → 到点由系统自动结束；管理员随时可以手动结束
 * （手动结束直接落 ended，不走系统判定 —— 2026-09-25 去掉了「申请停止」那一层）。
 *
 * 执行方式是**惰性**的：挂在读接口与设备心跳上，不依赖 Cron（本地与 Vercel 都一样），
 * 与仓库里既有的做法一致（诊断日志列表顺带回收过期正文）。并发安全靠条件更新——
 * 只有还没开考/还该结束的那一次会写成功，也只有写成功的那次才记一条系统操作日志
 * （`actor_id` 为空表示系统）。
 *
 * 2026-09-24 修正：系统推进过去只改投影表，而派生态、心跳版本与插件 payload 都读权威快照
 * `exam_data.majors`。现在自动开考与自动结束都走与人工动作同一条写路径——投影 + 快照 +
 * 操作日志在同一个事务里完成（快照写入仍带 `updated_at` 乐观校验 + advisory 锁），
 * 写成功才会 bump `exam_data.updated_at`，教室端下一次心跳即可拉到最新状态（只做状态同步，
 * 不会把大屏踢出考试界面）。
 */
import { database } from './db.js';
import { operationLogKey } from './operationLog.js';
import { SCHEMA_MIGRATION_LOCK_ID } from '../_auth.js';
import { asRecord } from '../../src/shared/typeGuards.js';
import { planAutoEnd, type ExamOperationPatch } from '../../src/shared/examLifecycleOperations.js';
import { applyOperationPatchToMajor } from './examSnapshotPatch.js';
import { formatDateTimeInZone } from '../../src/utils/zonedTime.js';

/**
 * 快速考试结束后多久自动归档（T-283-03「结束后归档或按配置保留」的默认口径）。
 * 留宽限期是为了让刚考完的老师还能在历史里看到它、并且来得及「转正式」；
 * 过期后自动进归档（软隐藏，归档开关里仍能翻到）。
 * 可用 `QUICK_EXAM_ARCHIVE_GRACE_HOURS` 调整，0 表示结束后立刻归档。
 */
export const QUICK_EXAM_ARCHIVE_GRACE_MS = Math.max(
  0,
  Number(process.env.QUICK_EXAM_ARCHIVE_GRACE_HOURS ?? 24) * 60 * 60_000,
);

type SnapshotRow = { majors?: unknown; updated_at?: unknown };
type MajorRecord = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cloneMajors(snapshot: SnapshotRow): MajorRecord[] {
  return Array.isArray(snapshot.majors) ? snapshot.majors.map((raw) => ({ ...asRecord(raw) })) : [];
}

type SystemTransitionInput = {
  recordId: string;
  /** 已经打好补丁的完整快照数组。 */
  majors: MajorRecord[];
  expectedVersion: number;
  now: number;
  action: 'auto_start' | 'auto_end' | 'auto_archive';
  toStatus: string;
  reason: string;
  patch: ExamOperationPatch;
  /** 守卫口径：开考 / 到点收场 / 归档（归档只针对已结束的快速考试）。 */
  guard: 'start' | 'end' | 'archive';
  /** 归档守卫用：只有实际结束时间早于这个时刻的才归档。 */
  archiveCutoff?: number;
};

/**
 * 一次系统推进：权威快照 + 操作日志 + 投影表在同一条语句链里完成。
 * 返回 true 表示本次真的写了（投影行数 = 1）；false 表示被并发写者抢先，下一轮惰性推进再试。
 */
async function commitSystemTransition(input: SystemTransitionInput): Promise<boolean> {
  const sql = database();
  const { recordId, majors, expectedVersion, now, action, toStatus, reason, patch, guard } = input;
  const hasPausedAt = Object.prototype.hasOwnProperty.call(patch, 'pausedAt');
  const hasStopRequestedAt = Object.prototype.hasOwnProperty.call(patch, 'stopRequestedAt');
  const ended = patch.status === 'ended';
  const archived = guard === 'archive';
  const archiveCutoff = input.archiveCutoff ?? now;
  const key = operationLogKey(recordId, action, guard === 'start' ? number(patch.actualStartAt, now) : now);
  const results = await sql.transaction((transaction) => [
    transaction`SELECT pg_advisory_xact_lock(${SCHEMA_MIGRATION_LOCK_ID})`,
    transaction`
      WITH updated AS (
        UPDATE exam_data SET majors=${JSON.stringify(majors)}::jsonb, updated_at=${now},
          -- 生命周期写回快照的 majors 时同步推进 major 修订号：否则携带 baseRevisions 的客户端
          -- 会拿着「暂停前」的修订号通过并发校验，把自动开考/结束的结果覆盖掉。
          revisions = COALESCE(revisions, '{}'::jsonb) || jsonb_build_object('major', COALESCE((revisions->>'major')::bigint, 0) + 1)
        WHERE id=1 AND updated_at=${expectedVersion}::BIGINT
        RETURNING id
      ), logged AS (
        INSERT INTO exam_record_operations (
          idempotency_key, action, source_record_id, result_record_id,
          actor_id, from_status, to_status, reason, created_at
        )
        SELECT ${key}, ${action}, ${recordId}, ${recordId},
          ${null}, 'published', ${toStatus}, ${reason}, ${now}
        FROM updated
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING idempotency_key
      )
      UPDATE exam_records SET
        status=${toStatus},
        actual_start_at=COALESCE(${patch.actualStartAt ?? null}::BIGINT, actual_start_at),
        actual_end_at=COALESCE(${patch.actualEndAt ?? null}::BIGINT, actual_end_at),
        end_at=COALESCE(${patch.endAt ?? null}::BIGINT, end_at),
        paused_at=CASE WHEN ${hasPausedAt} THEN ${patch.pausedAt ?? null}::BIGINT ELSE paused_at END,
        paused_ms=COALESCE(${patch.pausedMs ?? null}::BIGINT, paused_ms),
        stop_requested_at=CASE WHEN ${hasStopRequestedAt} THEN ${patch.stopRequestedAt ?? null}::BIGINT ELSE stop_requested_at END,
        ended_at=CASE WHEN ${ended} THEN ${now} ELSE ended_at END,
        archived_at=CASE WHEN ${archived} THEN ${now} ELSE archived_at END,
        updated_at=${now}, version=version+1
      WHERE id=${recordId}
        AND (
          (${guard === 'start'}::boolean AND status='published' AND actual_start_at IS NULL
            AND start_at IS NOT NULL AND start_at <= ${now})
          OR (${guard === 'end'}::boolean AND status='published'
            AND actual_start_at IS NOT NULL AND end_at IS NOT NULL AND end_at + paused_ms <= ${now})
          OR (${archived}::boolean AND status='ended' AND source='quick'
            AND actual_end_at IS NOT NULL AND actual_end_at <= ${archiveCutoff})
        )
        AND EXISTS (SELECT 1 FROM logged)
      RETURNING id
    `,
  ]);
  const rows = (results[1] ?? []) as unknown as Array<{ id?: unknown }>;
  return rows.length > 0;
}

/** 返回本次真正开考了几场（0 表示没有到点的）。 */
export async function autoStartDueRecords(now: number = Date.now()): Promise<number> {
  const sql = database();
  const due = (await sql`
    SELECT id, start_at
    FROM exam_records
    WHERE status = 'published'
      AND actual_start_at IS NULL
      AND start_at IS NOT NULL
      AND start_at <= ${now}
    LIMIT 50
  `) as unknown as Array<{ id?: unknown; start_at?: unknown }>;
  if (!due.length) return 0;

  const snapshotRows = (await sql`SELECT majors, updated_at FROM exam_data WHERE id=1`) as unknown as SnapshotRow[];
  const snapshot = snapshotRows[0] ?? {};
  let majors = cloneMajors(snapshot);
  let expectedVersion = number(snapshot.updated_at, 0);
  let startedCount = 0;

  for (const row of due) {
    const recordId = text(row.id);
    if (!recordId) continue;
    const startedAt = number(row.start_at, now);
    const index = majors.findIndex((major) => text(major.id) === recordId);
    // 快照里已经没有这场考试（被删了）时，投影会在下一次保存时一并清理，这里不硬造。
    if (index < 0) continue;
    const nextMajors = majors.map((major, i) => (i === index ? { ...major } : major));
    const patch: ExamOperationPatch = { actualStartAt: startedAt };
    applyOperationPatchToMajor(nextMajors[index], patch);
    const written = await commitSystemTransition({
      recordId,
      majors: nextMajors,
      expectedVersion,
      now,
      action: 'auto_start',
      toStatus: 'published',
      reason: `系统按计划时间自动开考（计划 ${formatDateTimeInZone(startedAt)}）`,
      patch,
      guard: 'start',
    });
    if (!written) continue;
    // 同一轮里连续推进多场：写完一次后快照版本与内容都变了，循环内跟着更新。
    majors = nextMajors;
    expectedVersion = now;
    startedCount += 1;
  }
  return startedCount;
}

type DueEndRow = {
  id?: unknown;
  actual_start_at?: unknown;
  end_at?: unknown;
  paused_at?: unknown;
  paused_ms?: unknown;
};

/**
 * 系统「到点收场」：已经开考、且 now ≥ effectiveEndAt（end_at + paused_ms）的考试
 * 由系统落 ended——下课的钟不需要人来敲，晚打开页面也不会把结束时间记晚。
 *
 * 手动结束不在这里：管理员点「结束」直接落 ended（见 planExamOperation），
 * 不等设备回执、不等宽限、不等这个惰性推进。
 */
export async function autoEndRequestedRecords(now: number = Date.now()): Promise<number> {
  const sql = database();
  const due = (await sql`
    SELECT id, actual_start_at, end_at, paused_at, paused_ms
    FROM exam_records
    WHERE status = 'published'
      AND actual_start_at IS NOT NULL
      AND end_at IS NOT NULL
      AND end_at + paused_ms <= ${now}
    LIMIT 200
  `) as unknown as DueEndRow[];
  if (!due.length) return 0;

  const snapshotRows = (await sql`SELECT majors, updated_at FROM exam_data WHERE id=1`) as unknown as SnapshotRow[];
  const snapshot = snapshotRows[0] ?? {};
  let majors = cloneMajors(snapshot);
  let expectedVersion = number(snapshot.updated_at, 0);

  let endedCount = 0;
  for (const row of due) {
    const recordId = text(row.id);
    if (!recordId) continue;
    const plan = planAutoEnd(
      {
        status: 'published',
        actualStartAt: row.actual_start_at == null ? null : number(row.actual_start_at, now),
        endAt: row.end_at == null ? null : number(row.end_at, now),
        pausedAt: row.paused_at == null ? null : number(row.paused_at, now),
        pausedMs: number(row.paused_ms, 0),
      },
      now,
    );
    if (!plan.ok) continue;
    const index = majors.findIndex((major) => text(major.id) === recordId);
    if (index < 0) continue;
    const nextMajors = majors.map((major, i) => (i === index ? { ...major } : major));
    const patch: ExamOperationPatch = {
      status: 'ended',
      actualEndAt: plan.patch.actualEndAt ?? now,
      pausedAt: null,
      pausedMs: plan.patch.pausedMs ?? 0,
      stopRequestedAt: null,
    };
    applyOperationPatchToMajor(nextMajors[index], patch);
    const written = await commitSystemTransition({
      recordId,
      majors: nextMajors,
      expectedVersion,
      now,
      action: 'auto_end',
      toStatus: 'ended',
      // 系统收场现在只剩「到点」一种原因（手动结束不走这里）。
      reason: `系统收场：已到结束时间（实际结束 ${formatDateTimeInZone(patch.actualEndAt ?? now)}）`,
      patch,
      guard: 'end',
    });
    if (!written) continue;
    majors = nextMajors;
    expectedVersion = now;
    endedCount += 1;
  }
  return endedCount;
}

/**
 * T-283-03：快速考试结束后的归档策略。
 * 快速考试是"立刻统一下发"的临时考试，结束后如果一直留在历史里会越攒越多；
 * 这里在宽限期（默认 24 小时，`QUICK_EXAM_ARCHIVE_GRACE_HOURS` 可调）之后自动归档：
 * 投影 status=archived + 快照写 archivedAt + 记一条操作日志，归档后仍能在"归档"开关里翻到。
 */
export async function archiveFinishedQuickRecords(now: number = Date.now()): Promise<number> {
  const sql = database();
  const cutoff = now - QUICK_EXAM_ARCHIVE_GRACE_MS;
  const due = (await sql`
    SELECT id FROM exam_records
    WHERE source = 'quick'
      AND status = 'ended'
      AND actual_end_at IS NOT NULL
      AND actual_end_at <= ${cutoff}
    LIMIT 50
  `) as unknown as Array<{ id?: unknown }>;
  if (!due.length) return 0;

  const snapshotRows = (await sql`SELECT majors, updated_at FROM exam_data WHERE id=1`) as unknown as SnapshotRow[];
  const snapshot = snapshotRows[0] ?? {};
  let majors = cloneMajors(snapshot);
  let expectedVersion = number(snapshot.updated_at, 0);
  let archivedCount = 0;

  for (const row of due) {
    const recordId = text(row.id);
    if (!recordId) continue;
    const index = majors.findIndex((major) => text(major.id) === recordId);
    if (index < 0) continue;
    const nextMajors = majors.map((major, i) => (i === index ? { ...major } : major));
    nextMajors[index].archivedAt = now;
    const written = await commitSystemTransition({
      recordId,
      majors: nextMajors,
      expectedVersion,
      now,
      action: 'auto_archive',
      toStatus: 'archived',
      reason: '系统归档：快速考试结束后超过保留期',
      patch: {},
      guard: 'archive',
      archiveCutoff: cutoff,
    });
    if (!written) continue;
    majors = nextMajors;
    expectedVersion = now;
    archivedCount += 1;
  }
  return archivedCount;
}

/**
 * 一次惰性推进：到点开考 → 到点收场 → 归档快速考试。
 * 读接口与设备心跳都调用这一个入口，避免以后加规则时漏掉某个触发点。
 */
export async function advanceExamLifecycle(now: number = Date.now()): Promise<void> {
  await autoStartDueRecords(now);
  await autoEndRequestedRecords(now);
  await archiveFinishedQuickRecords(now);
}
