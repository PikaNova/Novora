-- 回滚 0008：模板可独立删除；静默/提醒字段删掉后公告回落到"自动弹出、无提醒"。
DROP TABLE IF EXISTS exam_announcement_templates;
ALTER TABLE exam_announcements DROP COLUMN IF EXISTS silent;
ALTER TABLE exam_announcements DROP COLUMN IF EXISTS remind_at;
ALTER TABLE exam_announcements DROP COLUMN IF EXISTS remind_scope;
