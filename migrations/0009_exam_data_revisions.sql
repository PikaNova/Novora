-- 0009：exam_data 增加域级修订号（major / alerts / weekly / schedule / grades / classes / initialization）。
-- 与运行时迁移（api/_exams/db.ts 的 ensureTableOnce，版本 9）同一步，重复执行安全。
-- 老数据默认 '{}'（各域按 0 处理），读取契约不变，老客户端不看该列。
ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS revisions JSONB NOT NULL DEFAULT '{}';
