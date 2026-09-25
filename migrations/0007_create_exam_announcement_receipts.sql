-- 0007：学校公告回执（送达 + 已读 + 阅读时长）。
-- 与运行时迁移（api/_exams/db.ts 的 ensureTableOnce，版本 7）同一步，重复执行安全。
-- 口径：一台设备 × 一条公告只有一行；"已读"= 累计展示满 3 秒（客户端判定后上报）。
CREATE TABLE IF NOT EXISTS exam_announcement_receipts (
  announcement_id TEXT NOT NULL,
  instance_id     TEXT NOT NULL,
  grade_id        TEXT NOT NULL DEFAULT '',
  class_id        TEXT NOT NULL DEFAULT '',
  delivered_at    BIGINT,
  first_seen_at   BIGINT,
  last_seen_at    BIGINT,
  seen_count      INTEGER NOT NULL DEFAULT 0,
  seen_ms         BIGINT NOT NULL DEFAULT 0,
  client_version  TEXT NOT NULL DEFAULT '',
  updated_at      BIGINT NOT NULL,
  PRIMARY KEY (announcement_id, instance_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_announcement_receipts_announcement
  ON exam_announcement_receipts(announcement_id, first_seen_at);
CREATE INDEX IF NOT EXISTS idx_exam_announcement_receipts_instance
  ON exam_announcement_receipts(instance_id, updated_at DESC);
