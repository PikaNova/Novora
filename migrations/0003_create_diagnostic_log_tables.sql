-- 诊断日志第二上传链路：与静默 error-report 摘要完全分离。
-- 运行时 ensureTableOnce() 会幂等创建；本文件用于部署迁移审计和手动 PostgreSQL 初始化。
CREATE TABLE IF NOT EXISTS app_diagnostic_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  capture_on_error BOOLEAN NOT NULL DEFAULT FALSE,
  before_seconds INTEGER NOT NULL DEFAULT 60,
  after_seconds INTEGER NOT NULL DEFAULT 30,
  retention_days INTEGER NOT NULL DEFAULT 7,
  max_bundle_bytes INTEGER NOT NULL DEFAULT 1048576,
  updated_at BIGINT NOT NULL DEFAULT 0
);

INSERT INTO app_diagnostic_settings (id, updated_at)
VALUES (1, extract(epoch FROM clock_timestamp())::BIGINT * 1000)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS app_diagnostic_bundles (
  id BIGSERIAL PRIMARY KEY,
  bundle_id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('date', 'error')),
  instance_id TEXT NOT NULL,
  device_id TEXT,
  error_event_id TEXT,
  fingerprint TEXT,
  error_code TEXT,
  from_ts BIGINT NOT NULL,
  to_ts BIGINT NOT NULL,
  entries JSONB NOT NULL DEFAULT '[]',
  entry_count INTEGER NOT NULL DEFAULT 0,
  content_bytes INTEGER NOT NULL DEFAULT 0,
  app_version TEXT,
  commit_sha TEXT,
  status TEXT NOT NULL DEFAULT 'retained' CHECK (status IN ('retained', 'queued', 'sending', 'sent', 'failed', 'expired')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  requested_by BIGINT,
  created_at BIGINT NOT NULL,
  expires_at BIGINT,
  sent_at BIGINT,
  next_attempt_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_bundles_time ON app_diagnostic_bundles(from_ts, to_ts);
CREATE INDEX IF NOT EXISTS idx_diagnostic_bundles_error ON app_diagnostic_bundles(error_event_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_diagnostic_bundles_status ON app_diagnostic_bundles(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diagnostic_bundles_retry_due ON app_diagnostic_bundles(status, next_attempt_at, created_at);
