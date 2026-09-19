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
