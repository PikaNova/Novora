import assert from 'node:assert/strict';
import test from 'node:test';
import { database, ensureTableOnce } from '../../api/_exams/db.js';
import {
  claimDueDiagnosticBundles,
  purgeExpiredDiagnosticBundles,
  readDiagnosticQueueStats,
  releaseExpiredClaims,
} from '../../api/_diagnosticQueue.js';

const PREFIX = 'itest_diag_';

async function resetFixtures(): Promise<void> {
  await ensureTableOnce();
  await database()`DELETE FROM app_diagnostic_bundles WHERE bundle_id LIKE ${`${PREFIX}%`}`;
}

async function insertFailedBundle(options: {
  suffix: string;
  nextAttemptAt: number | null;
  status?: string;
  attempts?: number;
  expiresAt?: number | null;
  createdAt: number;
}): Promise<string> {
  const bundleId = `${PREFIX}${options.suffix}`;
  await database()`INSERT INTO app_diagnostic_bundles
    (bundle_id, mode, instance_id, from_ts, to_ts, entries, entry_count, content_bytes, status, attempt_count,
     last_error, created_at, expires_at, next_attempt_at)
    VALUES (${bundleId}, 'date', 'instance-itest', 1, 2, '[]'::jsonb, 0, 2, ${options.status ?? 'failed'},
     ${options.attempts ?? 0}, '', ${options.createdAt}, ${options.expiresAt ?? null}, ${options.nextAttemptAt})`;
  return bundleId;
}

test('diagnostic queue: concurrent claims never hand the same bundle to two workers', async () => {
  await resetFixtures();
  const now = Date.now();
  for (const suffix of ['a', 'b', 'c', 'd']) {
    await insertFailedBundle({ suffix, nextAttemptAt: now - 1_000, createdAt: now - 10_000 });
  }

  // 两个并发 worker 各领 2 条：SKIP LOCKED 必须让它们拿到互不重叠的行。
  const [first, second] = await Promise.all([
    claimDueDiagnosticBundles({ limit: 2, now }),
    claimDueDiagnosticBundles({ limit: 2, now }),
  ]);
  const claimed = [...first.rows, ...second.rows].map((row) => String(row.bundle_id));
  assert.equal(claimed.length, 4, 'both workers should claim two bundles each');
  assert.equal(new Set(claimed).size, 4, 'no bundle may be claimed twice');
  assert.deepEqual([...claimed].sort(), ['a', 'b', 'c', 'd'].map((suffix) => `${PREFIX}${suffix}`).sort());

  await resetFixtures();
});

test('diagnostic queue: claims are skipped until due, expire, or exhaust their attempts', async () => {
  await resetFixtures();
  const now = Date.now();
  const due = await insertFailedBundle({ suffix: 'due', nextAttemptAt: now - 1, createdAt: now - 5_000 });
  await insertFailedBundle({ suffix: 'future', nextAttemptAt: now + 60_000, createdAt: now - 4_000 });
  await insertFailedBundle({ suffix: 'exhausted', nextAttemptAt: now - 1, attempts: 3, createdAt: now - 3_000 });
  await insertFailedBundle({
    suffix: 'expired',
    nextAttemptAt: now - 1,
    expiresAt: now - 1,
    createdAt: now - 2_000,
  });

  const { rows } = await claimDueDiagnosticBundles({ limit: 10, now });
  assert.deepEqual(
    rows.map((row) => String(row.bundle_id)),
    [due],
  );

  await resetFixtures();
});

test('diagnostic queue: an expired lease is recovered and the queue can be counted', async () => {
  await resetFixtures();
  const now = Date.now();
  const stuck = await insertFailedBundle({
    suffix: 'stuck',
    nextAttemptAt: now - 1,
    status: 'sending',
    createdAt: now - 1_000,
  });
  await insertFailedBundle({ suffix: 'due', nextAttemptAt: now - 60_000, createdAt: now - 900 });

  const recovered = await releaseExpiredClaims(now);
  assert.ok(recovered >= 1, 'the stale sending row must be recovered');

  const recoveredRow = (await database()`SELECT status, last_error FROM app_diagnostic_bundles
    WHERE bundle_id=${stuck}`) as unknown as Array<{ status: string; last_error: string }>;
  assert.equal(recoveredRow[0]?.status, 'failed');
  assert.equal(recoveredRow[0]?.last_error, 'retry_claim_expired');

  const stats = await readDiagnosticQueueStats(now);
  assert.equal(stats.dueNow, 2, 'the recovered bundle and the due bundle are both claimable');
  assert.equal(stats.sending, 0);
  assert.ok(stats.failed >= 2);
  assert.ok(stats.nextAttemptAt != null && stats.nextAttemptAt <= now);

  await resetFixtures();
});

test('diagnostic queue: expired bundles release their payload and are deleted after the grace period', async () => {
  await resetFixtures();
  const now = Date.now();
  const day = 86_400_000;
  const expiredWithPayload = await insertFailedBundle({
    suffix: 'purge-now',
    nextAttemptAt: now - day,
    status: 'expired',
    expiresAt: now - 1_000,
    createdAt: now - 2 * day,
  });
  await database()`UPDATE app_diagnostic_bundles
    SET entries=${JSON.stringify([{ at: now - 2 * day, level: 'info', message: 'retained payload' }])}::jsonb,
        entry_count=1, content_bytes=64
    WHERE bundle_id=${expiredWithPayload}`;

  const expiredLongAgo = await insertFailedBundle({
    suffix: 'purge-old',
    nextAttemptAt: now - 60 * day,
    status: 'expired',
    expiresAt: now - 40 * day,
    createdAt: now - 60 * day,
  });
  await database()`UPDATE app_diagnostic_bundles
    SET entries=${JSON.stringify([{ at: now - 60 * day, level: 'info', message: 'ancient payload' }])}::jsonb,
        entry_count=1, content_bytes=64
    WHERE bundle_id=${expiredLongAgo}`;

  const live = await insertFailedBundle({ suffix: 'live', nextAttemptAt: now - 1, createdAt: now - 1_000 });
  await database()`UPDATE app_diagnostic_bundles
    SET entries=${JSON.stringify([{ at: now - 1_000, level: 'error', message: 'live payload' }])}::jsonb,
        entry_count=1, content_bytes=64
    WHERE bundle_id=${live}`;

  const result = await purgeExpiredDiagnosticBundles({ now });
  assert.equal(result.clearedEntries, 2, 'every expired bundle holding a payload must be released');
  assert.equal(result.deletedRows, 1, 'only the bundle past the metadata grace period is deleted');

  const rows = (await database()`SELECT bundle_id, entries, entry_count FROM app_diagnostic_bundles
    WHERE bundle_id IN (${expiredWithPayload}, ${expiredLongAgo}, ${live})`) as unknown as Array<{
    bundle_id: string;
    entries: unknown[];
    entry_count: number;
  }>;
  const byId = new Map(rows.map((row) => [row.bundle_id, row]));
  assert.deepEqual(byId.get(expiredWithPayload)?.entries, [], 'expired payload must be released');
  assert.equal(byId.get(expiredWithPayload)?.entry_count, 1, 'entry_count stays as historical metadata');
  assert.equal(byId.has(expiredLongAgo), false, 'records past the grace period are removed');
  assert.equal((byId.get(live)?.entries as unknown[]).length, 1, 'live bundles keep their payload');

  const stats = await readDiagnosticQueueStats(now);
  assert.equal(stats.expiredWithEntries, 0, 'nothing is left waiting for the purge');

  await resetFixtures();
});
