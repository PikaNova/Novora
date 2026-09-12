import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomUUID } from 'node:crypto';
import { database, ensureTableOnce } from './_exams/db.js';
import { requireActor, writeAudit } from './_auth.js';
import {
  DEFAULT_RETENTION_DAYS,
  RETRY_CLAIM_TIMEOUT_MS,
  clampRetentionDays,
  drainDiagnosticQueue,
  purgeExpiredDiagnosticBundles,
  retentionExpiresAt,
  retryDelayMs,
  sendDiagnosticBundle,
} from './_diagnosticQueue.js';
import {
  normalizeDiagnosticLogMode,
  sanitizeDiagnosticEntry,
  sanitizeDiagnosticMessage,
  type DiagnosticLogBundleInput,
} from '../src/shared/diagnosticLogContracts.js';

const MAX_ENTRIES = 500;
const MAX_BUNDLE_BYTES = 1_048_576;

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
  const retention = clampRetentionDays(numberValue(b.retentionDays) ?? DEFAULT_RETENTION_DAYS);
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
  // 管理员浏览列表时顺带回收过期正文，避免在没挂 Cron 的部署里正文无限堆积。
  await purgeExpiredDiagnosticBundles();
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
  // 保留期以管理员在设置页保存的 retention_days 为准，不再写死 30 天。
  const settingsRows = await sql`SELECT retention_days FROM app_diagnostic_settings WHERE id=1`;
  const expiresAt = retentionExpiresAt(now, settingsRows[0]?.retention_days ?? DEFAULT_RETENTION_DAYS);
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
  const sent = await sendDiagnosticBundle(authorPayload, instanceId);
  const nextAttemptAt = sent.ok ? null : Date.now() + retryDelayMs(1);
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
  const result = await drainDiagnosticQueue({ limit: 10 });
  res.status(202).json({ ok: true, ...result });
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
