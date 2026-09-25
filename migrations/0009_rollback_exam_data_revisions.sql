-- 回滚 0009：修订号只是并发判定用的元数据，删列不影响权威快照与记录投影。
-- 回滚后仍在运行的客户端会退回整行 updated_at 比较，行为与 v2.8.7 一致。
ALTER TABLE exam_data DROP COLUMN IF EXISTS revisions;
