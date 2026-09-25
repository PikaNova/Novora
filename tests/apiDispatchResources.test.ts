import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

// 路由模块在导入时只读取 DATABASE_URL，不会真的连库。
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@127.0.0.1:5432/novora_test';

const { EXAM_RECORD_GET_RESOURCES } = await import('../api/_exams/routes/examRecordRoutes.js');
const { EXAM_ANNOUNCEMENT_GET_RESOURCES } = await import('../api/_exams/routes/examAnnouncementRoutes.js');

/**
 * 入口分发名单的回归。
 *
 * 事故背景：`api/exams.ts` 曾经手写一份「哪些 resource 归记录路由」的白名单，
 * 漏了 `record` —— 前端按 id 取详情时请求静默掉到快照接口，拿回整份快照，
 * 界面报「考试详情数据不完整」。同一张名单此前还漏过 `record-precheck`、`record-consistency`。
 *
 * 现在归属名单由各路由模块自己导出，入口只负责 `.has()`。这两条测试分别盯：
 *   1. 名单内容本身；
 *   2. 入口确实在用名单，而不是又手写了一遍。
 */

test('入口分发名单：记录路由的五种 resource 都在', () => {
  for (const resource of ['records', 'record', 'record-operations', 'record-precheck', 'record-consistency']) {
    assert.ok(EXAM_RECORD_GET_RESOURCES.has(resource), `记录路由应认领 ${resource}`);
  }
  assert.equal(EXAM_RECORD_GET_RESOURCES.size, 5, '新增 resource 时请同步这条断言与处理函数映射表');
});

test('入口分发名单：公告路由的三种 resource 都在', () => {
  for (const resource of ['announcements', 'device-announcements', 'announcement-image']) {
    assert.ok(EXAM_ANNOUNCEMENT_GET_RESOURCES.has(resource), `公告路由应认领 ${resource}`);
  }
});

test('入口分发：api/exams.ts 用模块导出的名单，不再手写 resource 判断', () => {
  const candidates = [
    new URL('../../api/exams.ts', import.meta.url), // 编译后：.test-check/tests/ → 仓库根
    new URL('../api/exams.ts', import.meta.url), // 直接跑源码时
  ];
  const path = candidates.find((url) => existsSync(url));
  assert.ok(path, '找不到 api/exams.ts');
  const source = readFileSync(path, 'utf8');

  assert.match(source, /EXAM_RECORD_GET_RESOURCES\.has\(resource\)/, '记录路由要走导出的名单');
  assert.match(source, /EXAM_ANNOUNCEMENT_GET_RESOURCES\.has\(resource\)/, '公告路由要走导出的名单');
  for (const literal of ["resource === 'records'", "resource === 'announcements'"]) {
    assert.ok(!source.includes(literal), `不要再手写 ${literal}，这正是漏登记的来源`);
  }
});
