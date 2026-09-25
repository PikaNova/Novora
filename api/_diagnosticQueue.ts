// 诊断包出站队列：管理员手动重试端点（api/diagnostic-logs.ts）与 Cron worker
// （/api/diagnostic-worker → api/system.ts）共用同一份领取、发送、退避实现。
// 领取在事务内用 FOR UPDATE SKIP LOCKED，配合 10 分钟租约，多实例并发不会重复发送。
import { createHash } from 'node:crypto';
import { getAuthorConfig, getIngestToken } from './_authorClient.js';
import { telemetryConfig } from './_telemetryConfig.js';
import { database } from './_exams/db.js';
import {
  EXPIRED_METADATA_GRACE_MS,
  MAX_RETRY_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  RETRY_CLAIM_TIMEOUT_MS,
  clampDrainLimit,
  nextAttemptAfterFailure,
} from './_diagnosticQueuePolicy.js';

type Row = Record<string, unknown>;

export {
  DEFAULT_RETENTION_DAYS,
  MAX_RETRY_ATTEMPTS,
  RETRY_CLAIM_TIMEOUT_MS,
  clampDrainLimit,
  clampRetentionDays,
  retentionExpiresAt,
  retryDelayMs,
} from './_diagnosticQueuePolicy.js';

export type DiagnosticPurgeResult = { clearedEntries: number; deletedRows: number };

export type DiagnosticQueueStats = {
  sending: number;
  sent: number;
  failed: number;
  expired: number;
  /** 已过期但仍占着正文的包数量；worker 每次运行会把它们清空。 */
  expiredWithEntries: number;
  dueNow: number;
  nextAttemptAt: number | null;
  lastError: string | null;
};

export type DiagnosticSendResult = { ok: boolean; detail?: string };

export type DiagnosticDrainResult = {
  considered: number;
  sent: number;
  failed: number;
  released: number;
  remaining: number;
  purged: DiagnosticPurgeResult;
  durationMs: number;
};

export async function sendDiagnosticBundle(
  payload: Record<string, unknown>,
  instanceId: string,
): Promise<DiagnosticSendResult> {
  const config = await getAuthorConfig();
  if (!config.errorReportEnabled) return { ok: false, detail: 'disabled' };
  const token = await getIngestToken('v2', instanceId);
  if (!token) return { ok: false, detail: 'no_credential' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${telemetryConfig.baseUrl}/api/diagnostic-log-bundles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (response.ok || response.status === 202) return { ok: true };
    return { ok: false, detail: `author_status_${response.status}` };
  } catch {
    return { ok: false, detail: 'author_unreachable' };
  } finally {
    clearTimeout(timeout);
  }
}

/** 从数据库行重建发送给作者端的 payload；重试路径与首次发送必须得到同一形状。 */
export function diagnosticPayloadFromRow(row: Row): Record<string, unknown> {
  const entries = Array.isArray(row.entries) ? row.entries : [];
  const serialized = JSON.stringify(entries);
  return {
    schemaVersion: 1,
    uploadId: String(row.bundle_id),
    instanceId: String(row.instance_id),
    deviceId: row.device_id,
    errorEventId: row.error_event_id,
    fingerprint: row.fingerprint,
    errorCode: row.error_code,
    source: row.mode === 'date' ? 'manual-date' : 'manual-error',
    contentEncoding: 'json',
    fromTs: Number(row.from_ts),
    toTs: Number(row.to_ts),
    entries,
    contentHash: createHash('sha256').update(serialized).digest('hex'),
    appVersion: row.app_version,
    commitSha: row.commit_sha,
    partNo: Number(row.part_no ?? 1) || 1,
    partTotal: Number(row.part_total ?? 1) || 1,
    truncatedCount: Number(row.truncated_count ?? 0) || 0,
  };
}

/** 回收被崩溃进程遗留的 sending 行，返回回收条数。 */
export async function releaseExpiredClaims(now: number = Date.now()): Promise<number> {
  const rows = await database()`
    UPDATE app_diagnostic_bundles
    SET status='failed', last_error=CASE WHEN last_error='' THEN 'retry_claim_expired' ELSE last_error END
    WHERE status='sending' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ${now}
    RETURNING bundle_id`;
  return rows.length;
}

/** 事务内领取到期的失败包，并立刻标记 sending + 租约。 */
export async function claimDueDiagnosticBundles(
  options: { limit?: number; now?: number } = {},
): Promise<{ claimedUntil: number; rows: Row[] }> {
  const now = options.now ?? Date.now();
  const limit = clampDrainLimit(options.limit);
  const claimedUntil = now + RETRY_CLAIM_TIMEOUT_MS;
  const sql = database();
  const results = await sql.transaction((transaction) => [
    transaction`
    WITH stale AS (
      UPDATE app_diagnostic_bundles
      SET status='failed', last_error=CASE WHEN last_error='' THEN 'retry_claim_expired' ELSE last_error END
      WHERE status='sending' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ${now}
      RETURNING bundle_id
    ), due AS (
      SELECT bundle_id
      FROM app_diagnostic_bundles
      WHERE status='failed' AND attempt_count < ${MAX_RETRY_ATTEMPTS}
        AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
        AND (expires_at IS NULL OR expires_at > ${now})
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE app_diagnostic_bundles AS bundles
    SET status='sending', next_attempt_at=${claimedUntil}
    FROM due
    WHERE bundles.bundle_id=due.bundle_id
    RETURNING bundles.*
  `,
  ]);
  return { claimedUntil, rows: results[0] ?? [] };
}

/** 写回发送结果；只有仍持有本次租约的行才会被更新，避免旧 worker 覆盖新状态。 */
export async function finishClaimedDiagnosticBundle(
  row: Row,
  claimedUntil: number,
  result: DiagnosticSendResult,
  now: number = Date.now(),
): Promise<boolean> {
  const attempts = Number(row.attempt_count || 0) + 1;
  const next = nextAttemptAfterFailure(result.ok, attempts, now);
  const updated = await database()`
    UPDATE app_diagnostic_bundles
    SET status=${result.ok ? 'sent' : 'failed'},
        attempt_count=${attempts},
        last_error=${result.ok ? '' : result.detail || 'send_failed'},
        sent_at=${result.ok ? now : null},
        next_attempt_at=${next}
    WHERE bundle_id=${String(row.bundle_id)} AND status='sending' AND next_attempt_at=${claimedUntil}
    RETURNING bundle_id`;
  return updated.length > 0;
}

/** 本次没有来得及发送的领取行：退回 failed，让下一次运行重新领取。 */
export async function releaseDiagnosticClaim(
  bundleId: string,
  claimedUntil: number,
  now: number = Date.now(),
): Promise<boolean> {
  const updated = await database()`
    UPDATE app_diagnostic_bundles
    SET status='failed', next_attempt_at=${now + RETRY_BASE_DELAY_MS}
    WHERE bundle_id=${bundleId} AND status='sending' AND next_attempt_at=${claimedUntil}
    RETURNING bundle_id`;
  return updated.length > 0;
}

export async function countDueDiagnosticBundles(now: number = Date.now()): Promise<number> {
  const rows = await database()`
    SELECT COUNT(*)::int AS n FROM app_diagnostic_bundles
    WHERE status='failed' AND attempt_count < ${MAX_RETRY_ATTEMPTS}
      AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
      AND (expires_at IS NULL OR expires_at > ${now})`;
  return Number(rows[0]?.n ?? 0);
}

/**
 * 过期包的物理清理：先清空正文（entries JSONB 单包最大 1MB，不能随保留期无限堆积），
 * 过了宽限期再删掉整行。entry_count 保留为历史计数，因此「entry_count>0 且 entries 为空」
 * 就表示正文已被清理。
 */
export async function purgeExpiredDiagnosticBundles(options: { now?: number } = {}): Promise<DiagnosticPurgeResult> {
  const now = options.now ?? Date.now();
  const sql = database();
  const cleared = await sql`
    UPDATE app_diagnostic_bundles
    SET entries='[]'::jsonb
    WHERE status='expired' AND (expires_at IS NULL OR expires_at <= ${now}) AND jsonb_array_length(entries) > 0
    RETURNING bundle_id`;
  const deleted = await sql`
    DELETE FROM app_diagnostic_bundles
    WHERE status='expired' AND expires_at IS NOT NULL AND expires_at <= ${now - EXPIRED_METADATA_GRACE_MS}
    RETURNING bundle_id`;
  return { clearedEntries: cleared.length, deletedRows: deleted.length };
}

/** 有界消费：单次最多 limit 条，且不超过 deadlineMs，超时未发送的领取行退回队列。 */
export async function drainDiagnosticQueue(
  options: { limit?: number; now?: number; deadlineMs?: number } = {},
): Promise<DiagnosticDrainResult> {
  const startedAt = Date.now();
  const now = options.now ?? startedAt;
  const deadlineMs = Math.max(1_000, options.deadlineMs ?? 8_000);
  const purged = await purgeExpiredDiagnosticBundles({ now });
  const { claimedUntil, rows } = await claimDueDiagnosticBundles({ limit: options.limit, now });
  let sent = 0;
  let failed = 0;
  let released = 0;
  for (const row of rows) {
    if (Date.now() - startedAt >= deadlineMs) {
      if (await releaseDiagnosticClaim(String(row.bundle_id), claimedUntil)) released += 1;
      continue;
    }
    const result = await sendDiagnosticBundle(diagnosticPayloadFromRow(row), String(row.instance_id));
    const applied = await finishClaimedDiagnosticBundle(row, claimedUntil, result);
    if (!applied) continue;
    if (result.ok) sent += 1;
    else failed += 1;
  }
  const remaining = await countDueDiagnosticBundles();
  return { considered: rows.length, sent, failed, released, remaining, purged, durationMs: Date.now() - startedAt };
}

export async function readDiagnosticQueueStats(now: number = Date.now()): Promise<DiagnosticQueueStats> {
  const sql = database();
  const statusRows = await sql`SELECT status, COUNT(*)::int AS n FROM app_diagnostic_bundles GROUP BY status`;
  const counts: Record<string, number> = {};
  for (const row of statusRows) counts[String(row.status)] = Number(row.n ?? 0);
  const purgeRows = await sql`SELECT COUNT(*)::int AS n FROM app_diagnostic_bundles
    WHERE status='expired' AND (expires_at IS NULL OR expires_at <= ${now}) AND jsonb_array_length(entries) > 0`;
  const dueRows = await sql`SELECT COUNT(*)::int AS n FROM app_diagnostic_bundles
    WHERE status='failed' AND attempt_count < ${MAX_RETRY_ATTEMPTS}
      AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
      AND (expires_at IS NULL OR expires_at > ${now})`;
  const nextRows = await sql`SELECT MIN(next_attempt_at) AS next_attempt_at FROM app_diagnostic_bundles
    WHERE status='failed' AND attempt_count < ${MAX_RETRY_ATTEMPTS} AND next_attempt_at IS NOT NULL`;
  const errorRows = await sql`SELECT last_error FROM app_diagnostic_bundles
    WHERE status='failed' AND last_error <> '' ORDER BY created_at DESC LIMIT 1`;
  const nextAttemptAt = nextRows[0]?.next_attempt_at;
  return {
    sending: counts.sending ?? 0,
    sent: counts.sent ?? 0,
    failed: counts.failed ?? 0,
    expired: counts.expired ?? 0,
    expiredWithEntries: Number(purgeRows[0]?.n ?? 0),
    dueNow: Number(dueRows[0]?.n ?? 0),
    nextAttemptAt: nextAttemptAt == null ? null : Number(nextAttemptAt),
    lastError: typeof errorRows[0]?.last_error === 'string' ? (errorRows[0].last_error as string) : null,
  };
}
