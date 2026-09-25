-- 回滚 0006：样式列有默认值，删列会让已发布的公告退回默认卡片样式；图片表可独立删除。
DROP TABLE IF EXISTS exam_announcement_images;
ALTER TABLE exam_announcements DROP COLUMN IF EXISTS style;
