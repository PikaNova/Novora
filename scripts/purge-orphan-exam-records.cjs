#!/usr/bin/env node
/**
 * 一次性维护脚本：清掉 exam_records 里「快照已经不存在的考试」留下的孤儿行。
 *
 * 背景：投影只增不删（删考试只是把它从快照 majors 里移除），所以每删一场考试都会留下一条
 * 孤儿行。列表与草稿板块会按快照把它们过滤掉，界面上看不到，但会一直累积（dev 上已有 22 条）。
 *
 * 口径与 GET /api/exams?resource=record-consistency 的 orphaned 完全一致：
 * 快照 exam_data.majors 里没有的 id 就是孤儿行。
 *
 * 用法（在部署目录里执行，读 DATABASE_URL）：
 *   node scripts/purge-orphan-exam-records.cjs                     # 只统计，不删
 *   node scripts/purge-orphan-exam-records.cjs --yes               # 真的删
 *   node scripts/purge-orphan-exam-records.cjs --yes --with-operations
 *                                                                  # 连带删掉这些考试的操作日志
 *
 * 默认不动 exam_record_operations：那是审计与操作历史，孤儿考试的操作记录留着比删掉安全。
 */
const { Client } = require('pg');

const ORPHAN_SQL = `
  SELECT records.id
  FROM exam_records AS records
  WHERE NOT EXISTS (
    SELECT 1
    FROM exam_data AS snapshot
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(snapshot.majors) = 'array' THEN snapshot.majors ELSE '[]'::jsonb END
    ) AS major(value)
    WHERE snapshot.id = 1 AND major.value->>'id' = records.id
  )
  ORDER BY records.id
`;

const CHUNK_SIZE = 500;

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('缺少 DATABASE_URL：脚本只在部署目录（容器/裸机）里对真实库执行。');
    process.exit(1);
  }
  const apply = process.argv.includes('--yes');
  const withOperations = process.argv.includes('--with-operations');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const orphanRows = await client.query(ORPHAN_SQL);
    const orphanIds = orphanRows.rows.map((row) => String(row.id));

    const snapshot = await client.query(
      "SELECT jsonb_array_length(COALESCE(majors, '[]'::jsonb)) AS total FROM exam_data WHERE id = 1",
    );
    const records = await client.query('SELECT count(*)::int AS total FROM exam_records');
    const operations = orphanIds.length
      ? await client.query(
          'SELECT count(*)::int AS total FROM exam_record_operations WHERE source_record_id = ANY($1::text[]) OR result_record_id = ANY($1::text[])',
          [orphanIds],
        )
      : { rows: [{ total: 0 }] };

    console.log(`快照里的考试：${snapshot.rows[0]?.total ?? 0}`);
    console.log(`exam_records 行数：${records.rows[0]?.total ?? 0}`);
    console.log(`孤儿行：${orphanIds.length}`);
    console.log(`这些孤儿被操作日志引用的次数：${operations.rows[0]?.total ?? 0}`);
    if (orphanIds.length) {
      console.log('样例：', orphanIds.slice(0, 10).join(', '));
    }

    if (!apply) {
      console.log('\n这是预演（没有删任何数据）。确认无误后加 --yes 再跑一次。');
      return;
    }
    if (!orphanIds.length) {
      console.log('\n没有孤儿行，无需清理。');
      return;
    }

    let deletedRecords = 0;
    for (const chunk of chunks(orphanIds, CHUNK_SIZE)) {
      const deleted = await client.query('DELETE FROM exam_records WHERE id = ANY($1::text[]) RETURNING id', [chunk]);
      deletedRecords += deleted.rowCount;
    }
    console.log(`\n已删除 exam_records 孤儿行：${deletedRecords}`);

    if (withOperations) {
      let deletedOperations = 0;
      for (const chunk of chunks(orphanIds, CHUNK_SIZE)) {
        const deleted = await client.query(
          'DELETE FROM exam_record_operations WHERE source_record_id = ANY($1::text[]) OR result_record_id = ANY($1::text[]) RETURNING idempotency_key',
          [chunk],
        );
        deletedOperations += deleted.rowCount;
      }
      console.log(`已删除关联的操作日志：${deletedOperations}`);
    } else {
      console.log('保留了这些考试的操作日志（要一起删请加 --with-operations）。');
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
