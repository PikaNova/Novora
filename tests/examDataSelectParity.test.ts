import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// 这次踩过的坑：`exam_data` 加了 revisions 列，路由的 SELECT 加上了，但集成用例的 readPayload()
// 没加——用例照旧「通过」，实际上读到的 revisions 永远是空表，断言等于没验。
//
// 这里用两把锁把三份文本互相钉住：
//   1. payload.ts 里 row.X 用到的列，必须都在路由 selectRow 的 SELECT 里；
//   2. 路由 selectRow 的列，必须与集成用例 readPayload 的列完全一致。
// 任何一处只改一边都会在这里失败。
const ROUTE_FILE = path.resolve('api/_exams/routes/examDataRoutes.ts');
const PAYLOAD_FILE = path.resolve('api/_exams/payload.ts');
const INTEGRATION_FILE = path.resolve('tests/integration/examData.integration.test.ts');

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

/** 取锚点之后第一个 `SELECT ... FROM exam_data` 的列名。 */
function selectedColumns(source: string, anchor: string, file: string): string[] {
  const anchorIndex = source.indexOf(anchor);
  assert.ok(anchorIndex >= 0, `${file} 里找不到锚点：${anchor}`);
  const afterAnchor = source.slice(anchorIndex);
  const selectIndex = afterAnchor.search(/\bSELECT\b/);
  assert.ok(selectIndex >= 0, `${file} 的锚点之后没有 SELECT`);
  const afterSelect = afterAnchor.slice(selectIndex + 'SELECT'.length);
  const fromIndex = afterSelect.search(/\bFROM\s+exam_data\b/i);
  assert.ok(fromIndex >= 0, `${file} 的 SELECT 之后没有 FROM exam_data`);
  return afterSelect
    .slice(0, fromIndex)
    .split(',')
    .map((column) => column.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** payload.ts 会从数据行读哪些列（`row.xxx`）。 */
function consumedColumns(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/\brow\.([a-z_]+)/g)) found.add(match[1]);
  return [...found].sort();
}

test('exam_data 的列必须三处对齐：payload 读取、路由 SELECT、集成用例 readPayload', () => {
  const payloadColumns = consumedColumns(read(PAYLOAD_FILE));
  assert.ok(payloadColumns.length >= 10, 'payload.ts 应该从数据行读多个列');
  const routeColumns = selectedColumns(
    read(ROUTE_FILE),
    'const selectRow = async',
    'api/_exams/routes/examDataRoutes.ts',
  );
  const helperColumns = selectedColumns(
    read(INTEGRATION_FILE),
    'async function readPayload',
    'tests/integration/examData.integration.test.ts',
  );
  const missingInRoute = payloadColumns.filter((column) => !routeColumns.includes(column));
  assert.deepEqual(
    missingInRoute,
    [],
    'payload.ts 读了这些列但路由 selectRow 没 SELECT：漏选会让 payload 里的字段静默变成空值',
  );
  assert.deepEqual(
    [...helperColumns].sort(),
    [...routeColumns].sort(),
    '集成用例 readPayload() 的列必须与路由 selectRow 完全一致，否则用例会「通过」却没验到那些列',
  );
});
