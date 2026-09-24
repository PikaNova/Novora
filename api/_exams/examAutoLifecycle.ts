/**
 * 考试生命周期的「系统自动推进」。
 *
 * 约定（2026-09-19 定稿）：创建即发布 → 到点由系统自动开考 → 管理员只能申请停止 →
 * 系统判定后才真正结束。
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
import { DEVICE_ONLINE_WINDOW_MS } from '../../src/shared/deviceContracts.js';
import {
  planAutoEnd,
  type ExamAutoEndReason,
  type ExamOperationPatch,
} from '../../src/shared/examLifecycleOperations.js';
import { applyOperationPatchToMajor } from './examSnapshotPatch.js';
import { formatDateTimeInZone } from '../../src/utils/zonedTime.js';

/** 申请停止后，教室里一台在线设备都没有时，最多再等这么久就按「无人监考」收场。 */
export const STOP_NO_DEVICE_GRACE_MS = 10 * 60_000;

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
  action: 'auto_start' | 'auto_end';
  toStatus: string;
  reason: string;
  patch: ExamOperationPatch;
  /** true=自动开考的守卫；false=自动结束的守卫。 */
  startGuard: boolean;
};

/**
 * 一次系统推进：权威快照 + 操作日志 + 投影表在同一条语句链里完成。
 * 返回 true 表示本次真的写了（投影行数 = 1）；false 表示被并发写者抢先，下一轮惰性推进再试。
 */
async function commitSystemTransition(input: SystemTransitionInput): Promise<boolean> {
  const sql = database();
  const { recordId, majors, expectedVersion, now, action, toStatus, reason, patch, startGuard } = input;
  const hasPausedAt = Object.prototype.hasOwnProperty.call(patch, 'pausedAt');
  const hasStopRequestedAt = Object.prototype.hasOwnProperty.call(patch, 'stopRequestedAt');
  const ended = patch.status === 'ended';
  const key = operationLogKey(recordId, action, startGuard ? number(patch.actualStartAt, now) : now);
  const results = await sql.transaction((transaction) => [
    transaction`SELECT pg_advisory_xact_lock(${SCHEMA_MIGRATION_LOCK_ID})`,
    transaction`
      WITH updated AS (
        UPDATE exam_data SET majors=${JSON.stringify(majors)}::jsonb, updated_at=${now}
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
        updated_at=${now}, version=version+1
      WHERE id=${recordId}
        AND status='published'
        AND (
          (${startGuard}::boolean AND actual_start_at IS NULL AND start_at IS NOT NULL AND start_at <= ${now})
          OR (NOT ${startGuard}::boolean AND (
            stop_requested_at IS NOT NULL
            OR (actual_start_at IS NOT NULL AND end_at IS NOT NULL AND end_at + paused_ms <= ${now})
          ))
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
      startGuard: true,
    });
    if (!written) continue;
    // 同一轮里连续推进多场：写完一次后快照版本与内容都变了，循环内跟着更新。
    majors = nextMajors;
    expectedVersion = now;
    startedCount += 1;
  }
  return startedCount;
}

type PendingStopRow = {
  id?: unknown;
  name?: unknown;
  actual_start_at?: unknown;
  end_at?: unknown;
  paused_at?: unknown;
  paused_ms?: unknown;
  stop_requested_at?: unknown;
  target_grade_ids?: unknown;
  target_class_ids?: unknown;
};

type OnlineDeviceRow = {
  grade_id?: unknown;
  class_id?: unknown;
  current_exam?: unknown;
};

function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * 系统判定结束：只处理「已申请停止」的考试，判定优先级为
 *   ① 到点（now ≥ endAt + pausedMs）——时间到就结束，不管设备有没有回执；
 *   ② 全员回执——本场范围内的在线设备都不再报这场考试了；
 *   ③ 无设备宽限——范围内一台在线设备都没有，且申请停止已超过 10 分钟（无人监考兜底）。
 *
 * 回执信号取自设备心跳里已有的 `current_exam`（客户端上报的考试名）：
 * 只有「在线设备数 > 0 且没有任何一台还在报本场」才算全员回执，
 * 这样既不会在设备短暂离线时误判，也不会因为改名而永远等不到。
 */
export async function autoEndRequestedRecords(now: number = Date.now()): Promise<number> {
  const sql = database();
  const pending = (await sql`
    SELECT id, name, actual_start_at, end_at, paused_at, paused_ms, stop_requested_at,
      target_grade_ids, target_class_ids
    FROM exam_records
    WHERE status = 'published'
      AND (
        stop_requested_at IS NOT NULL
        -- 没有申请停止、但已经开考且到点：下课的钟不需要人来敲，系统直接收场。
        OR (actual_start_at IS NOT NULL AND end_at IS NOT NULL AND end_at + paused_ms <= ${now})
      )
    LIMIT 200
  `) as unknown as PendingStopRow[];
  if (!pending.length) return 0;
  const onlineDevices = (await sql`
    SELECT grade_id, class_id, current_exam
    FROM device_instances
    WHERE last_seen_at >= ${now - DEVICE_ONLINE_WINDOW_MS}
  `) as unknown as OnlineDeviceRow[];

  const snapshotRows = (await sql`SELECT majors, updated_at FROM exam_data WHERE id=1`) as unknown as SnapshotRow[];
  const snapshot = snapshotRows[0] ?? {};
  let majors = cloneMajors(snapshot);
  let expectedVersion = number(snapshot.updated_at, 0);

  let endedCount = 0;
  for (const row of pending) {
    const recordId = text(row.id);
    if (!recordId) continue;
    const gradeIds = idList(row.target_grade_ids);
    const classIds = idList(row.target_class_ids);
    const inScope = onlineDevices.filter(
      (device) =>
        (!gradeIds.length && !classIds.length) ||
        gradeIds.includes(text(device.grade_id)) ||
        classIds.includes(text(device.class_id)),
    );
    const examName = text(row.name);
    const stopRequestedAt = number(row.stop_requested_at, now);
    const plan = planAutoEnd(
      {
        status: 'published',
        actualStartAt: row.actual_start_at == null ? null : number(row.actual_start_at, now),
        endAt: row.end_at == null ? null : number(row.end_at, now),
        pausedAt: row.paused_at == null ? null : number(row.paused_at, now),
        pausedMs: number(row.paused_ms, 0),
        stopRequestedAt,
        actualEndAt: null,
      },
      now,
      {
        allDevicesReported: inScope.length > 0 && inScope.every((device) => text(device.current_exam) !== examName),
        noDeviceGraceExpired: inScope.length === 0 && now - stopRequestedAt >= STOP_NO_DEVICE_GRACE_MS,
      },
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
      reason: `${autoEndReasonText(plan.reason)}（实际结束 ${formatDateTimeInZone(patch.actualEndAt ?? now)}）`,
      patch,
      startGuard: false,
    });
    if (!written) continue;
    majors = nextMajors;
    expectedVersion = now;
    endedCount += 1;
  }
  return endedCount;
}

function autoEndReasonText(reason: ExamAutoEndReason | undefined): string {
  if (reason === 'timeup') return '系统判定：已到结束时间';
  if (reason === 'receipts') return '系统判定：教室端已全部结束';
  if (reason === 'no-device-timeout') return '系统判定：已无在线设备';
  return '系统判定：考试未开考即取消';
}
