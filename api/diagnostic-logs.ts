import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomUUID } from 'node:crypto';
import { getIngestToken, getAuthorConfig } from './_authorClient.js';
import { telemetryConfig } from './_telemetryConfig.js';
import { database, ensureTableOnce } from './_exams/db.js';
import { requireActor, writeAudit } from './_auth.js';
import {
  normalizeDiagnosticLogMode,
  sanitizeDiagnosticEntry,
  sanitizeDiagnosticMessage,
  type DiagnosticLogBundleInput,
} from '../src/shared/diagnosticLogContracts.js';

const MAX_ENTRIES = 500;
const MAX_BUNDLE_BYTES = 1_048_576;
const DEFAULT_RETENTION_DAYS = 7;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_CLAIM_TIMEOUT_MS = 10 * 60_000;

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown, max: number): string | null {
  if (value == null) return null;
  const result = sanitizeDiagnosticMessage(value, max);
  return result || null;
}

function bodyOf(req: VercelRequest): Record<string, unknown> {
  return req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
}

async function sendToAuthor(
  payload: Record<string, unknown>,
  instanceId: string,
): Promise<{ ok: boolean; detail?: string }> {
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

async function handleSettings(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await requireActor(req, res, req.method === 'GET' ? 'diagnostics.read' : 'diagnostics.settings');
  if (!actor) return;
  const sql = database();
  if (req.method === 'GET') {
    const rows =
      await sql`SELECT capture_on_error, before_seconds, after_seconds, retention_days, max_bundle_bytes, updated_at
      FROM app_diagnostic_settings WHERE id=1`;
    const row = rows[0] || {};
    res.json({
      ok: true,
      settings: {
        captureOnError: row.capture_on_error === true,
        beforeSeconds: Number(row.before_seconds ?? 60),
        afterSeconds: Number(row.after_seconds ?? 30),
        retentionDays: Number(row.retention_days ?? DEFAULT_RETENTION_DAYS),
        maxBundleBytes: Number(row.max_bundle_bytes ?? MAX_BUNDLE_BYTES),
        updatedAt: Number(row.updated_at ?? 0),
      },
    });
    return;
  }
  const b = bodyOf(req);
  const capture = b.captureOnError === true;
  const before = Math.min(Math.max(Math.round(numberValue(b.beforeSeconds) ?? 60), 0), 300);
  const after = Math.min(Math.max(Math.round(numberValue(b.afterSeconds) ?? 30), 0), 300);
  const retention = Math.min(Math.max(Math.round(numberValue(b.retentionDays) ?? DEFAULT_RETENTION_DAYS), 1), 30);
  const now = Date.now();
  await sql`UPDATE app_diagnostic_settings SET capture_on_error=${capture}, before_seconds=${before}, after_seconds=${after}, retention_days=${retention}, updated_at=${now} WHERE id=1`;
  await writeAudit(actor, 'diagnostics.settings.update', 'diagnostics', 'settings', {
    captureOnError: capture,
    beforeSeconds: before,
    afterSeconds: after,
    retentionDays: retention,
  });
  res.json({
    ok: true,
    settings: {
      captureOnError: capture,
      beforeSeconds: before,
      afterSeconds: after,
      retentionDays: retention,
      maxBundleBytes: MAX_BUNDLE_BYTES,
      updatedAt: now,
    },
  });
}

async function handleCatalog(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await requireActor(req, res, 'diagnostics.read');
  if (!actor) return;
  const sql = database();
  const from = numberValue(req.query.from) ?? Date.now() - 7 * 86400000;
  const to = numberValue(req.query.to) ?? Date.now();
  await sql`UPDATE app_diagnostic_bundles SET status='expired' WHERE expires_at IS NOT NULL AND expires_at < ${Date.now()} AND status <> 'expired'`;
  const rows = await sql`SELECT bundle_id, mode, instance_id, device_id, error_event_id, fingerprint, error_code,
      from_ts, to_ts, entry_count, content_bytes, status, attempt_count, last_error, created_at, expires_at, sent_at, next_attempt_at
      FROM app_diagnostic_bundles WHERE from_ts <= ${to} AND to_ts >= ${from}
      ORDER BY created_at DESC LIMIT 200`;
  res.json({
    ok: true,
    bundles: rows.map((row) => ({
      ...row,
      fromTs: Number(row.from_ts),
      toTs: Number(row.to_ts),
      createdAt: Number(row.created_at),
      expiresAt: row.expires_at == null ? null : Number(row.expires_at),
      sentAt: row.sent_at == null ? null : Number(row.sent_at),
      nextAttemptAt: row.next_attempt_at == null ? null : Number(row.next_attempt_at),
    })),
  });
}

async function handleSend(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await requireActor(req, res, 'diagnostics.upload');
  if (!actor) return;
  const b = bodyOf(req);
  const mode = normalizeDiagnosticLogMode(b.mode);
  const instanceId = text(b.instanceId, 96);
  const fromTs = numberValue(b.fromTs);
  const toTs = numberValue(b.toTs);
  if (!mode || !instanceId || fromTs == null || toTs == null || fromTs <= 0 || toTs < fromTs) {
    res.status(400).json({ ok: false, code: 'INVALID_DIAGNOSTIC_RANGE', error: '诊断日志范围无效' });
    return;
  }
  const rawEntries = Array.isArray(b.entries) ? b.entries : [];
  const entries = rawEntries
    .slice(0, MAX_ENTRIES)
    .map(sanitizeDiagnosticEntry)
    .filter((entry): entry is NonNullable<ReturnType<typeof sanitizeDiagnosticEntry>> => !!entry);
  if (!entries.length) {
    res.status(400).json({ ok: false, code: 'EMPTY_DIAGNOSTIC_LOG', error: '没有可发送的诊断日志' });
    return;
  }
  const bundleId = text(b.bundleId, 96) || `bundle_${randomUUID()}`;
  const input: DiagnosticLogBundleInput = {
    bundleId,
    mode,
    instanceId,
    deviceId: text(b.deviceId, 96),
    errorEventId: text(b.errorEventId, 96),
    fingerprint: text(b.fingerprint, 96),
    errorCode: text(b.errorCode, 96),
    fromTs,
    toTs,
    entries,
    appVersion: text(b.appVersion, 32),
    commitSha: text(b.commitSha, 64),
  };
  const serialized = JSON.stringify(entries);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BUNDLE_BYTES) {
    res.status(413).json({ ok: false, code: 'DIAGNOSTIC_LOG_TOO_LARGE', error: '诊断日志包超过 1 MB 限制' });
    return;
  }
  const sql = database();
  const now = Date.now();
  const expiresAt = now + 30 * 86400000;
  const existing = await sql`SELECT bundle_id, status FROM app_diagnostic_bundles WHERE bundle_id=${bundleId} LIMIT 1`;
  if (existing.length) {
    res.status(202).json({ ok: true, bundleId, status: existing[0].status, idempotent: true });
    return;
  }
  await sql`INSERT INTO app_diagnostic_bundles
    (bundle_id, mode, instance_id, device_id, error_event_id, fingerprint, error_code, from_ts, to_ts, entries, entry_count, content_bytes, app_version, commit_sha, status, requested_by, created_at, expires_at, next_attempt_at)
    VALUES (${input.bundleId}, ${input.mode}, ${input.instanceId}, ${input.deviceId}, ${input.errorEventId}, ${input.fingerprint}, ${input.errorCode}, ${input.fromTs}, ${input.toTs}, ${serialized}::jsonb, ${entries.length}, ${Buffer.byteLength(serialized, 'utf8')}, ${input.appVersion}, ${input.commitSha}, 'sending', ${actor.id}, ${now}, ${expiresAt}, ${now + RETRY_CLAIM_TIMEOUT_MS})`;
  const contentHash = createHash('sha256').update(serialized).digest('hex');
  const authorPayload = {
    schemaVersion: 1,
    uploadId: bundleId,
    instanceId: input.instanceId,
    deviceId: input.deviceId,
    errorEventId: input.errorEventId,
    fingerprint: input.fingerprint,
    errorCode: input.errorCode,
    source: mode === 'date' ? 'manual-date' : 'manual-error',
    contentEncoding: 'json',
    fromTs: input.fromTs,
    toTs: input.toTs,
    entries: input.entries,
    contentHash,
    appVersion: input.appVersion,
    commitSha: input.commitSha,
  };
  const sent = await sendToAuthor(authorPayload, instanceId);
  const nextAttemptAt = sent.ok ? null : Date.now() + 60_000;
  await sql`UPDATE app_diagnostic_bundles SET status=${sent.ok ? 'sent' : 'failed'}, attempt_count=1, last_error=${sent.ok ? '' : sent.detail || 'send_failed'}, sent_at=${sent.ok ? Date.now() : null}, next_attempt_at=${nextAttemptAt} WHERE bundle_id=${bundleId}`;
  await writeAudit(actor, 'diagnostics.bundle.send', 'diagnostics', bundleId, {
    mode,
    entryCount: entries.length,
    fromTs,
    toTs,
    status: sent.ok ? 'sent' : 'failed',
  });
  res
    .status(202)
    .json({ ok: true, bundleId, status: sent.ok ? 'sent' : 'failed', detail: sent.ok ? undefined : sent.detail });
}

async function handleRetry(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await requireActor(req, res, 'diagnostics.upload');
  if (!actor) return;
  const sql = database();
  const now = Date.now();
  // Claim due rows atomically. The lease also lets a later invocation recover
  // bundles left in `sending` by a crashed worker.
  const claimedUntil = now + RETRY_CLAIM_TIMEOUT_MS;
  const claimResults = await sql.transaction((transaction) => [transaction`
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
      LIMIT 10
    )
    UPDATE app_diagnostic_bundles AS bundles
    SET status='sending', next_attempt_at=${claimedUntil}
    FROM due
    WHERE bundles.bundle_id=due.bundle_id
    RETURNING bundles.*
  `]);
  const rows = claimResults[0] ?? [];
  let sent = 0;
  for (const row of rows) {
    const entries = Array.isArray(row.entries) ? row.entries : [];
    const serialized = JSON.stringify(entries);
    const payload = {
      schemaVersion: 1, uploadId: String(row.bundle_id), instanceId: String(row.instance_id),
      deviceId: row.device_id, errorEventId: row.error_event_id, fingerprint: row.fingerprint, errorCode: row.error_code,
      source: row.mode === 'date' ? 'manual-date' : 'manual-error', contentEncoding: 'json',
      fromTs: Number(row.from_ts), toTs: Number(row.to_ts), entries,
      contentHash: createHash('sha256').update(serialized).digest('hex'), appVersion: row.app_version, commitSha: row.commit_sha,
    };
    const result = await sendToAuthor(payload, String(row.instance_id));
    const attempts = Number(row.attempt_count || 0) + 1;
    const completedAt = Date.now();
    const next = result.ok || attempts >= MAX_RETRY_ATTEMPTS
      ? null
      : completedAt + Math.min(3_600_000, 60_000 * 2 ** Math.max(0, attempts - 1));
    await sql`UPDATE app_diagnostic_bundles SET status=${result.ok ? 'sent' : 'failed'}, attempt_count=${attempts}, last_error=${result.ok ? '' : result.detail || 'send_failed'}, sent_at=${result.ok ? completedAt : null}, next_attempt_at=${next} WHERE bundle_id=${row.bundle_id} AND status='sending' AND next_attempt_at=${claimedUntil}`;
    if (result.ok) sent += 1;
  }
  res.status(202).json({ ok: true, considered: rows.length, sent, remaining: Math.max(0, rows.length - sent) });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PUT') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }
  try {
    await ensureTableOnce();
    const resource = String(req.query.resource || (bodyOf(req).resource ?? ''));
    if (resource === 'settings') return handleSettings(req, res);
    if (resource === 'retry' && req.method === 'POST') return handleRetry(req, res);
    if (req.method === 'GET') return handleCatalog(req, res);
    return handleSend(req, res);
  } catch (error) {
    res.status(500).json({
      ok: false,
      code: 'DIAGNOSTIC_LOG_FAILED',
      error: error instanceof Error ? error.message : 'diagnostic_log_failed',
    });
  }
}
