-- 0008：公告运营能力（静默发布、未读强提醒、常用模板）。
-- 与运行时迁移（api/_exams/db.ts 的 ensureTableOnce，版本 8）同一步，重复执行安全。
ALTER TABLE exam_announcements ADD COLUMN IF NOT EXISTS silent BOOLEAN NOT NULL DEFAULT FALSE;
-- 管理端点「提醒未读教室」时写 remind_at；大屏看到比本地记录新的 remind_at 就再弹一次。
ALTER TABLE exam_announcements ADD COLUMN IF NOT EXISTS remind_at BIGINT;
ALTER TABLE exam_announcements ADD COLUMN IF NOT EXISTS remind_scope TEXT NOT NULL DEFAULT 'unseen';

CREATE TABLE IF NOT EXISTS exam_announcement_templates (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  style       TEXT NOT NULL DEFAULT 'card',
  level       TEXT NOT NULL DEFAULT 'normal',
  created_by  BIGINT,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exam_announcement_templates_updated ON exam_announcement_templates(updated_at DESC);
