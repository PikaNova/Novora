import { createDbClient } from '../api/_dbAdapter.js';
import {
  planRecordTimestampFills,
  planSnapshotWindowFills,
  snapshotWindowOf,
  withSnapshotWindowFills,
  type BackfillMajorLike,
  type BackfillOperationLike,
  type BackfillRecordLike,
  type RecordTimestampFill,
} from '../src/utils/examRecordTimestampBackfill.js';

/**
 * 老记录补数据（详见 src/utils/examRecordTimestampBackfill.ts）：
 *
 *   BACKFILL_DATABASE_URL=postgres://... node scripts/run-record-timestamps-backfill.cjs            # 干跑
 *   BACKFILL_DATABASE_URL=... BACKFILL_CONFIRM=novora-record-timestamps \
 *     node scripts/run-record-timestamps-backfill.cjs --commit                                      # 写入
 *
 * 幂等：只补空值，已有值一律不动，重复执行没有副作用。
 */

type ExamDataRow = { majors: unknown; updated_at: number };

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function nullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function iso(value: number | undefined): string {
  return value == null ? '—' : new Date(value).toISOString();
}

function describeFill(fill: RecordTimestampFill): string {
  return Object.entries(fill)
    .filter(([key]) => key !== 'id')
    .map(([key, value]) => `${key}=${iso(value as number)}`)
    .join(', ');
}

async function main() {
  const commit = process.argv.includes('--commit');
  const databaseUrl = process.env.BACKFILL_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('BACKFILL_DATABASE_URL is required; DATABASE_URL is never used by this command.');
  }
  if (commit && process.env.BACKFILL_CONFIRM !== 'novora-record-timestamps') {
    throw new Error('Set BACKFILL_CONFIRM=novora-record-timestamps before using --commit.');
  }

  // 走与 api 同一套适配层：Neon 连接串用 HTTP 驱动，本地/内网 PG 用 pg。
  const sql = createDbClient(databaseUrl);
  const dataRows = (await sql`SELECT majors, updated_at FROM exam_data WHERE id = 1`) as unknown as ExamDataRow[];
  if (!dataRows.length) {
    console.log('No exam_data row found. Nothing to do.');
    return;
  }
  const snapshot = dataRows[0];
  const majors = asArray<BackfillMajorLike>(snapshot.majors);

  const windowFills = planSnapshotWindowFills(majors);
  const filledMajors = withSnapshotWindowFills(majors, windowFills);
  const windows = new Map<string, { startAt: number | null; endAt: number | null }>();
  for (const major of filledMajors) {
    const id = typeof major.id === 'string' ? major.id : '';
    if (id) windows.set(id, snapshotWindowOf(major));
  }

  // BIGINT 列在驱动里可能回来的是字符串（与 api 侧 nullableNumber 同一口径）。
  const records = (
    (await sql`
    SELECT id, published_at, ended_at, archived_at, actual_start_at, start_at, end_at FROM exam_records
  `) as unknown as Array<Record<string, unknown>>
  ).map((row): BackfillRecordLike => ({
    id: String(row.id ?? ''),
    published_at: nullableNumber(row.published_at),
    ended_at: nullableNumber(row.ended_at),
    archived_at: nullableNumber(row.archived_at),
    actual_start_at: nullableNumber(row.actual_start_at),
    start_at: nullableNumber(row.start_at),
    end_at: nullableNumber(row.end_at),
  }));
  // 操作记录表不大（一场考试几条），直接全取回来在内存里按动作筛。
  const operations = (await sql`
    SELECT action, result_record_id, created_at FROM exam_record_operations
  `) as unknown as Array<Record<string, unknown>>;
  const operationRows: BackfillOperationLike[] = operations
    .map((row) => ({
      action: String(row.action ?? ''),
      result_record_id: String(row.result_record_id ?? ''),
      created_at: nullableNumber(row.created_at) ?? 0,
    }))
    .filter((row) => row.action && row.result_record_id && row.created_at > 0);

  const timestampFills = planRecordTimestampFills(records, operationRows, windows);
  if (!windowFills.length && !timestampFills.length) {
    console.log('Nothing to backfill. Everything is already filled in.');
    return;
  }

  console.log(`Snapshot windows to write: ${windowFills.length}`);
  for (const fill of windowFills) {
    console.log(`- [${fill.majorName || fill.majorId}] ${iso(fill.startAt)} -> ${iso(fill.endAt)}`);
  }
  console.log(`Record timestamps to fill: ${timestampFills.length}`);
  for (const fill of timestampFills) {
    console.log(`- [${fill.id}] ${describeFill(fill)}`);
  }

  if (!commit) {
    console.log('Dry run only. Re-run with --commit and BACKFILL_CONFIRM=novora-record-timestamps to write.');
    return;
  }

  if (windowFills.length) {
    const saved = await sql`
      UPDATE exam_data
      SET majors = ${JSON.stringify(filledMajors)}::jsonb,
          updated_at = ${Date.now()}
      WHERE id = 1 AND updated_at = ${snapshot.updated_at}
      RETURNING updated_at
    `;
    if (!saved.length) {
      throw new Error('The exam data changed during the dry run. Re-run to avoid overwriting newer data.');
    }
  }

  let written = 0;
  for (const fill of timestampFills) {
    const rows = (await sql`
      UPDATE exam_records SET
        published_at = COALESCE(published_at, ${fill.publishedAt ?? null}::BIGINT),
        actual_start_at = COALESCE(actual_start_at, ${fill.actualStartAt ?? null}::BIGINT),
        ended_at = COALESCE(ended_at, ${fill.endedAt ?? null}::BIGINT),
        archived_at = COALESCE(archived_at, ${fill.archivedAt ?? null}::BIGINT),
        start_at = COALESCE(start_at, ${fill.startAt ?? null}::BIGINT),
        end_at = COALESCE(end_at, ${fill.endAt ?? null}::BIGINT)
      WHERE id = ${fill.id}
      RETURNING id
    `) as unknown as Array<{ id: string }>;
    written += rows.length;
  }
  console.log(
    `Committed ${windowFills.length} snapshot window(s) and ${timestampFills.length} record(s) (${written} row(s) touched).`,
  );
  // 本地 pg 驱动会留着连接池不退（Neon 的 HTTP 驱动不会），命令行跑完直接收工。
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
