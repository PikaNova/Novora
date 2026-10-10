-- Matches api/_runtimeLogs/store.ts. Runtime initialization is idempotent.
CREATE TABLE IF NOT EXISTS app_runtime_events (
  id BIGSERIAL PRIMARY KEY, instance_id TEXT NOT NULL, event_id TEXT NOT NULL,
  received_at BIGINT NOT NULL, event JSONB NOT NULL, UNIQUE(instance_id,event_id)
);
CREATE INDEX IF NOT EXISTS runtime_events_received ON app_runtime_events(received_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS runtime_events_device ON app_runtime_events(instance_id,received_at DESC);
CREATE INDEX IF NOT EXISTS runtime_events_session ON app_runtime_events(instance_id,(event->>'sessionId'),((event->>'sequence')::bigint));
CREATE INDEX IF NOT EXISTS runtime_events_operation ON app_runtime_events((event->>'operationId'));
CREATE TABLE IF NOT EXISTS app_runtime_credentials (
  id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, secret_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','revoked')),
  created_at BIGINT NOT NULL, UNIQUE(instance_id,secret_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS runtime_credential_active ON app_runtime_credentials(instance_id) WHERE status='approved';
CREATE TABLE IF NOT EXISTS app_runtime_tasks (
  id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, from_ts BIGINT NOT NULL, to_ts BIGINT NOT NULL,
  created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','claimed','completed','failed','expired')),
  detail TEXT NOT NULL DEFAULT '', truncated_count INTEGER NOT NULL DEFAULT 0
);
