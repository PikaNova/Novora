-- 0004 的回滚：撤回 v2.8.0 考试记录层。
--
-- 回滚策略（为什么这样不会丢数据）：
--   1. `exam_records` 是 `exam_data.majors` 的**单向投影**，不是权威数据。v2.7.x 的读路径
--      只认 exam_data，所以旧版本不需要它；重新执行 0004 或运行时 ensureTableOnce()，
--      下一次保存/首次请求就会从快照重建全部记录（重建行为见 tests/integration 的
--      「snapshot majors are backfilled without removing records」）。
--   2. `exam_record_operations` 是审计记录，**无法从快照重建**，因此本回滚默认保留它：
--      它只是加性表，旧版本代码不会读写，留着不产生副作用；确需清理请用下方注释掉的语句，
--      并在执行前自行导出（`pg_dump -t exam_record_operations`）。
--   3. 本回滚**绝不**触碰 `exam_data`、也不删任何列：v2.8 全部改动都是加性的，
--      权威快照与旧客户端读写契约保持原样。
--
-- 执行：psql -f migrations/0004_rollback_exam_record_tables.sql

DROP TABLE IF EXISTS exam_records;

-- 可选：连同操作日志一起清理（默认不执行，会丢失审计历史）
-- DROP TABLE IF EXISTS exam_record_operations;
