-- 0005：学校侧考试公告（与作者端统一公告是两套东西）。
-- 一期范围：全校 / 年级 / 班级；不做楼栋（学校结构暂无楼栋字段），不做回执。
CREATE TABLE IF NOT EXISTS exam_announcements (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  level       TEXT NOT NULL DEFAULT 'normal',   -- normal | urgent（urgent 在大屏置顶且不可关闭）
  exam_id     TEXT,                             -- 可空：绑定某场考试（一期只做记录与展示，不做自动发文）
  scope_type  TEXT NOT NULL DEFAULT 'all',      -- all | grade | class
  scope_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by  BIGINT,
  created_at  BIGINT NOT NULL,
  expires_at  BIGINT,
  status      TEXT NOT NULL DEFAULT 'sent'      -- sent | revoked
);

CREATE INDEX IF NOT EXISTS idx_exam_announcements_created ON exam_announcements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_announcements_status ON exam_announcements(status, expires_at);
