import { database } from '../_exams/db.js';
import type { RuntimeEvent } from '../../src/shared/runtimeLog.js';

let ready: Promise<void> | null = null;
export function ensureRuntimeTables(): Promise<void> {
  if (!ready)
    ready = (async () => {
      const sql = database();
      await sql.transaction((tx) => [
        tx`SELECT pg_advisory_xact_lock(7260913)`,
        tx`CREATE TABLE IF NOT EXISTS app_runtime_events (id BIGSERIAL PRIMARY KEY, instance_id TEXT NOT NULL, event_id TEXT NOT NULL, received_at BIGINT NOT NULL, event JSONB NOT NULL, UNIQUE(instance_id,event_id))`,
        tx`CREATE INDEX IF NOT EXISTS runtime_events_received ON app_runtime_events(received_at DESC,id DESC)`,
        tx`CREATE INDEX IF NOT EXISTS runtime_events_device ON app_runtime_events(instance_id,received_at DESC)`,
        tx`CREATE INDEX IF NOT EXISTS runtime_events_session ON app_runtime_events(instance_id,(event->>'sessionId'),((event->>'sequence')::bigint))`,
        tx`CREATE INDEX IF NOT EXISTS runtime_events_operation ON app_runtime_events((event->>'operationId'))`,
        tx`CREATE TABLE IF NOT EXISTS app_runtime_credentials (id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, secret_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','revoked')), created_at BIGINT NOT NULL, UNIQUE(instance_id,secret_hash))`,
        tx`CREATE UNIQUE INDEX IF NOT EXISTS runtime_credential_active ON app_runtime_credentials(instance_id) WHERE status='approved'`,
      ]);
    })().catch((error) => {
      ready = null;
      throw error;
    });
  return ready;
}
export async function insertRuntimeEvents(
  instanceId: string,
  events: RuntimeEvent[],
  receivedAt = Date.now(),
): Promise<number> {
  return insertRuntimeRecords(events.map((event) => ({ instanceId, event, receivedAt })));
}
export async function insertRuntimeRecords(
  records: { instanceId: string; event: RuntimeEvent; receivedAt: number }[],
): Promise<number> {
  await ensureRuntimeTables();
  const rows = await database()`INSERT INTO app_runtime_events(instance_id,event_id,received_at,event)
    SELECT value->>'instanceId', value->'event'->>'eventId', (value->>'receivedAt')::bigint, value->'event' FROM jsonb_array_elements(${JSON.stringify(records)}::jsonb)
    ON CONFLICT(instance_id,event_id) DO NOTHING RETURNING id`;
  await purgeRuntimeEvents();
  return rows.length;
}
let lastPurge = 0;
export async function purgeRuntimeEvents(): Promise<void> {
  if (Date.now() - lastPurge < 60000) return;
  lastPurge = Date.now();
  const now = Date.now();
  const sql = database();
  try {
    await sql`DELETE FROM app_runtime_events WHERE received_at < ${now - 30 * 86400000} OR (received_at < ${now - 7 * 86400000} AND event->>'level' NOT IN ('warn','error'))`;
    await sql`DELETE FROM app_runtime_events WHERE id IN (SELECT id FROM (SELECT id,row_number() OVER(PARTITION BY instance_id ORDER BY received_at DESC,id DESC) AS n FROM app_runtime_events) t WHERE n>10000)`;
    await sql`DELETE FROM app_runtime_events WHERE id IN (SELECT id FROM app_runtime_events ORDER BY received_at DESC,id DESC OFFSET 100000)`;
  } catch {
    lastPurge = 0; /* retention retries on next request; ingestion remains usable */
  }
}
