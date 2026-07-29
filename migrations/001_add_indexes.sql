-- migrations/001_add_indexes.sql
-- Add non-blocking indexes to improve query performance for device/plugin/audit lookups.
-- Run with: psql "$DATABASE_URL" -f migrations/001_add_indexes.sql

BEGIN;
-- Use CONCURRENTLY for index creation in production to avoid table locks (cannot run inside transaction).
COMMIT;

-- The following statements are intentionally outside transaction so they can run CONCURRENTLY.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_instances_class_revoked ON device_instances (class_id) WHERE revoked = FALSE;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_instances_grade_revoked ON device_instances (grade_id) WHERE revoked = FALSE;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_instances_updated_at ON device_instances (updated_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plugin_instances_viewer ON classisland_plugin_instances (viewer_instance_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plugin_instances_grade_class ON classisland_plugin_instances (grade_id, class_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_created_at ON app_audit_logs (created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_scopes_user ON app_user_scopes (user_id);

-- Optional: create a GIN index for exam_data classes JSONB if you query inside the jsonb frequently.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exam_data_classes_gin ON exam_data USING GIN (classes jsonb_path_ops);
