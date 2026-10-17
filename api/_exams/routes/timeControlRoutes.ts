import type { VercelRequest, VercelResponse } from '@vercel/node';
import { acquireWriteSlotOrReject, database, ensureTableOnce } from '../db.js';
import { allScope } from '../permissions.js';
import { type AdminActor, isPasswordRequired, requireActor, writeAudit } from '../../_auth.js';

const MAX_OFFSET_MS = 5 * 60_000;

async function authorize(req: VercelRequest, res: VercelResponse, write: boolean): Promise<AdminActor | null | false> {
  if (!(await isPasswordRequired())) return null;
  const actor = await requireActor(req, res, write ? 'settings.edit' : 'settings.read');
  if (!actor) return false;
  if (write && !allScope(actor)) {
    res.status(403).json({ ok: false, error: '只有全校范围管理员可以调整全校时间控制' });
    return false;
  }
  return actor;
}

export async function handleTimeControl(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await authorize(req, res, req.method !== 'GET');
  if (actor === false) return;
  const sql = database();
  await ensureTableOnce();
  if (req.method === 'GET') {
    const state =
      (await sql`SELECT offset_ms, revision, sync_request_id, sync_requested_at, updated_at FROM app_time_control WHERE id=1`) as unknown as Array<{
        offset_ms: number | string;
        revision: number | string;
        sync_request_id: string;
        sync_requested_at: number | string;
        updated_at: number | string;
      }>;
    const current = state[0];
    const syncRequestId = String(current?.sync_request_id ?? '');
    const counts = syncRequestId
      ? (
          (await sql`SELECT COUNT(*) FILTER (WHERE last_seen_at > ${Date.now() - 180_000}) AS online,
          COUNT(*) FILTER (WHERE time_sync_request_id=${syncRequestId} AND time_sync_request_status='synced') AS synced,
          COUNT(*) FILTER (WHERE time_sync_request_id=${syncRequestId} AND time_sync_request_status='failed') AS failed,
          COUNT(*) AS total
        FROM device_instances WHERE revoked=FALSE AND is_management=FALSE`) as unknown as Array<{
            online: number | string;
            synced: number | string;
            failed: number | string;
            total: number | string;
          }>
        )[0]
      : null;
    res.status(200).json({
      ok: true,
      offsetMs: Number(current?.offset_ms ?? 0),
      revision: Number(current?.revision ?? 1),
      syncRequestId,
      syncRequestedAt: Number(current?.sync_requested_at ?? 0),
      updatedAt: Number(current?.updated_at ?? 0),
      sync: counts
        ? {
            online: Number(counts.online),
            synced: Number(counts.synced),
            failed: Number(counts.failed),
            pending: Math.max(0, Number(counts.total) - Number(counts.synced) - Number(counts.failed)),
            total: Number(counts.total),
          }
        : null,
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  if (!(await acquireWriteSlotOrReject(req, res))) return;
  const operation = String(req.body?.operation ?? '');
  const now = Date.now();
  if (operation === 'request-sync') {
    const requestId = `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await sql`UPDATE app_time_control SET revision=revision+1, sync_request_id=${requestId}, sync_requested_at=${now}, updated_at=${now}, updated_by=${actor?.id ?? 0} WHERE id=1`;
    await writeAudit(actor, 'settings.time-sync.broadcast', 'app_time_control', '1', { requestId });
  } else if (operation === 'set-offset') {
    const offsetMs = Number(req.body?.offsetMs);
    if (!Number.isFinite(offsetMs) || Math.abs(offsetMs) > MAX_OFFSET_MS) {
      res.status(400).json({ ok: false, error: '统一延时须在 -300000 至 300000 毫秒之间' });
      return;
    }
    const roundedOffset = Math.round(offsetMs);
    await sql`UPDATE app_time_control SET offset_ms=${roundedOffset}, revision=revision+1, updated_at=${now}, updated_by=${actor?.id ?? 0} WHERE id=1`;
    await writeAudit(actor, 'settings.time-sync.offset', 'app_time_control', '1', { offsetMs: roundedOffset });
  } else {
    res.status(400).json({ ok: false, error: 'Invalid time-control operation' });
    return;
  }
  res.status(200).json({ ok: true });
}
