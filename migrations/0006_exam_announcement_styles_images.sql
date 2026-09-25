-- 0006：学校公告支持大屏展示样式（card / poster / bulletin）与正文图片。
-- 与运行时迁移（api/_exams/db.ts 的 ensureTableOnce，版本 6）同一步，重复执行安全。
ALTER TABLE exam_announcements ADD COLUMN IF NOT EXISTS style TEXT NOT NULL DEFAULT 'card';

CREATE TABLE IF NOT EXISTS exam_announcement_images (
  id          BIGSERIAL PRIMARY KEY,
  filename    TEXT NOT NULL DEFAULT '',
  mime_type   TEXT NOT NULL DEFAULT '',
  data        BYTEA NOT NULL,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exam_announcement_images_created ON exam_announcement_images(created_at DESC);
