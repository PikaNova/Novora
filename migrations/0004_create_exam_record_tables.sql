-- v2.8.0 考试记录层：exam_records（exam_data.majors 的单向投影）+ exam_record_operations（操作日志）。
--
-- 用途与 0003 相同：运行时 ensureTableOnce() 会幂等创建并补列，本文件用于
--   * 部署迁移审计（一眼看清 v2.8 在数据库上加了什么）
--   * 手动 PostgreSQL 初始化：psql -f migrations/0004_create_exam_record_tables.sql
--   * 旧库升级：在 v2.7.x 库上直接执行本文件即可补齐结构，权威数据（exam_data.majors）不受影响
--
-- 全程幂等：可重复执行；只做加法，不删列、不改写既有数据。

CREATE TABLE IF NOT EXISTS exam_records (
  id TEXT PRIMARY KEY,
  runtime_major_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'ended', 'archived')),
  items JSONB NOT NULL DEFAULT '[]',
  target_grade_ids JSONB NOT NULL DEFAULT '[]',
  target_class_ids JSONB NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'regular' CHECK (source IN ('regular', 'quick')),
  temporary BOOLEAN NOT NULL DEFAULT FALSE,
  priority_over_schedule BOOLEAN NOT NULL DEFAULT FALSE,
  config JSONB NOT NULL DEFAULT '{}',
  created_by BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  start_at BIGINT,
  end_at BIGINT,
  actual_start_at BIGINT,
  actual_end_at BIGINT,
  paused_at BIGINT,
  paused_ms BIGINT NOT NULL DEFAULT 0,
  published_at BIGINT,
  ended_at BIGINT,
  archived_at BIGINT,
  version INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 早期版本只建了表、没有这两个暂停列，这里补上，保证旧库与运行时迁移结果一致。
ALTER TABLE exam_records ADD COLUMN IF NOT EXISTS paused_at BIGINT;
ALTER TABLE exam_records ADD COLUMN IF NOT EXISTS paused_ms BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_exam_records_status ON exam_records (status);
CREATE INDEX IF NOT EXISTS idx_exam_records_updated ON exam_records (updated_at DESC);

CREATE TABLE IF NOT EXISTS exam_record_operations (
  idempotency_key TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  result_record_id TEXT NOT NULL,
  actor_id BIGINT,
  from_status TEXT NOT NULL DEFAULT '',
  to_status TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);

ALTER TABLE exam_record_operations ADD COLUMN IF NOT EXISTS actor_id BIGINT;
ALTER TABLE exam_record_operations ADD COLUMN IF NOT EXISTS from_status TEXT NOT NULL DEFAULT '';
ALTER TABLE exam_record_operations ADD COLUMN IF NOT EXISTS to_status TEXT NOT NULL DEFAULT '';
ALTER TABLE exam_record_operations ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_exam_record_operations_created ON exam_record_operations (created_at DESC);
