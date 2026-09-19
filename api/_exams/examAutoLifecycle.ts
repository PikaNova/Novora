/**
 * 考试生命周期的「系统自动推进」。
 *
 * 约定（2026-09-19 定稿）：创建即发布 → 到点由系统自动开考 → 管理员只能申请停止 →
 * 系统判定后才真正结束。这里只做前者（自动开考）；停止申请与结束判定在第二批，
 * 规划逻辑已经在 `src/shared/examLifecycleOperations.ts` 里备好纯函数。
 *
 * 执行方式是**惰性**的：挂在读接口与设备心跳上，不依赖 Cron（本地与 Vercel 都一样），
 * 与仓库里既有的做法一致（诊断日志列表顺带回收过期正文）。
 * 并发安全靠条件更新——只有 `actual_start_at IS NULL` 的那一次会写成功，
 * 也只有写成功的那次才记一条系统操作日志（`actor_id` 为空表示系统）。
 */
import { database } from './db.js';
import { operationLogKey } from './operationLog.js';
import { DEVICE_ONLINE_WINDOW_MS } from '../../src/shared/deviceContracts.js';
import { planAutoEnd, type ExamAutoEndReason } from '../../src/shared/examLifecycleOperations.js';

/** 申请停止后，教室里一台在线设备都没有时，最多再等这么久就按「无人监考」收场。 */
export const STOP_NO_DEVICE_GRACE_MS = 10 * 60_000;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 返回本次真正开考了几场（0 表示没有到点的）。 */
export async function autoStartDueRecords(now: number = Date.now()): Promise<number> {
  const sql = database();
  const started = (await sql`
    UPDATE exam_records
    SET actual_start_at = start_at, version = version + 1, updated_at = ${now}
    WHERE status = 'published'
      AND actual_start_at IS NULL
      AND start_at IS NOT NULL
      AND start_at <= ${now}
    RETURNING id, start_at
  `) as unknown as Array<{ id?: unknown; start_at?: unknown }>;
  if (!started.length) return 0;
  for (const row of started) {
    const recordId = text(row.id);
    if (!recordId) continue;
    const startedAt = number(row.start_at, now);
    await sql`
      INSERT INTO exam_record_operations (
        idempotency_key, action, source_record_id, result_record_id,
        actor_id, from_status, to_status, reason, created_at
      ) VALUES (
        ${operationLogKey(recordId, 'auto_start', startedAt)}, 'auto_start', ${recordId}, ${recordId},
        ${null}, 'published', 'published', '系统按计划时间自动开考', ${now}
      )
      ON CONFLICT (idempotency_key) DO NOTHING
    `;
  }
  return started.length;
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
    const ended = (await sql`
      UPDATE exam_records
      SET status = 'ended',
          actual_end_at = ${plan.patch.actualEndAt ?? now},
          paused_at = NULL,
          paused_ms = ${plan.patch.pausedMs ?? 0},
          stop_requested_at = NULL,
          ended_at = ${now},
          updated_at = ${now},
          version = version + 1
      WHERE id = ${recordId}
        AND status = 'published'
        AND (
          stop_requested_at IS NOT NULL
          OR (actual_start_at IS NOT NULL AND end_at IS NOT NULL AND end_at + paused_ms <= ${now})
        )
      RETURNING id
    `) as unknown as Array<{ id?: unknown }>;
    if (!ended.length) continue;
    endedCount += 1;
    await sql`
      INSERT INTO exam_record_operations (
        idempotency_key, action, source_record_id, result_record_id,
        actor_id, from_status, to_status, reason, created_at
      ) VALUES (
        ${operationLogKey(recordId, 'auto_end', now)}, 'auto_end', ${recordId}, ${recordId},
        ${null}, 'published', 'ended', ${autoEndReasonText(plan.reason)}, ${now}
      )
      ON CONFLICT (idempotency_key) DO NOTHING
    `;
  }
  return endedCount;
}

function autoEndReasonText(reason: ExamAutoEndReason | undefined): string {
  if (reason === 'timeup') return '系统判定：已到结束时间';
  if (reason === 'receipts') return '系统判定：教室端已全部结束';
  if (reason === 'no-device-timeout') return '系统判定：已无在线设备';
  return '系统判定：考试未开考即取消';
}
