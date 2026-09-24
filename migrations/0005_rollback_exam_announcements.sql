-- 回滚 0005：公告是独立表，删除不影响权威快照与考试记录投影。
DROP TABLE IF EXISTS exam_announcements;
