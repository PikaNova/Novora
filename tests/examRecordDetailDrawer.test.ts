import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
// 先装浏览器常量/存储，再引服务与组件（ESM 按 import 顺序求值）。
import './helpers/browserGlobals.js';
import { fetchExamRecord } from '../src/services/examRecords.js';

/**
 * 回归背景：考试详情抽屉以前在「当前板块列表页那一页数据」里按 id 找记录，找不到就整个
 * 不渲染——表现是点「详情」毫无反应。日程轴/班级网格的行来自本地快照，可能属于别的板块
 * （进行中的考试属「当前考试」），所以这些行永远打不开。现在抽屉按 id 自取。
 */

const RECORD = {
  id: 'major_1790254210990_c8j6',
  runtimeMajorId: 'major_1790254210990_c8j6',
  name: '测试111',
  description: '',
  status: 'published',
  displayStatus: 'ongoing',
  items: [],
  itemCount: 8,
  targetGradeIds: ['grade-1'],
  targetClassIds: [],
  source: 'regular',
  temporary: false,
  priorityOverSchedule: false,
  config: {},
  createdBy: null,
  createdAt: 1_790_000_000_000,
  updatedAt: 1_790_000_000_000,
  startAt: 1_790_125_200_000,
  endAt: 1_790_331_300_000,
  actualStartAt: null,
  actualEndAt: null,
  pausedAt: null,
  pausedMs: 0,
  stopRequestedAt: null,
  publishedAt: null,
  endedAt: null,
  archivedAt: null,
  version: 1,
  sortOrder: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const ORIGINAL_FETCH = globalThis.fetch;

/**
 * 组件树里带着样式导入（`import '../styles/x.css'`），Node 直接跑不了 CSS。
 * 测试进程里把 .css 解析成空模块即可——这里只验证行为，不验证样式。
 */
let cssHookInstalled = false;
function installCssHook(): void {
  if (cssHookInstalled) return;
  cssHookInstalled = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.endsWith('.css')) {
        return { url: 'data:text/javascript,export default {}', shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
}

test('fetchExamRecord: 按 id 单取一条考试记录', async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return jsonResponse({ ok: true, data: RECORD });
  }) as typeof fetch;
  try {
    const record = await fetchExamRecord('major_1790254210990_c8j6');
    assert.equal(record.id, 'major_1790254210990_c8j6');
    assert.equal(record.name, '测试111');
    assert.equal(record.displayStatus, 'ongoing');
    assert.deepEqual(calls, ['/api/exams?resource=record&recordId=major_1790254210990_c8j6']);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('fetchExamRecord: 记录不存在时抛出服务端错误码，不返回空壳', async () => {
  globalThis.fetch = (async () =>
    jsonResponse({ ok: false, code: 'RECORD_NOT_FOUND', error: '考试记录不存在或无权访问' }, 404)) as typeof fetch;
  try {
    await assert.rejects(
      () => fetchExamRecord('missing'),
      (error: unknown) => (error as { code?: string }).code === 'RECORD_NOT_FOUND',
    );
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('考试详情抽屉：记录不在调用方列表里（只给 id）也能自己取到并渲染', async () => {
  installCssHook();
  const { default: ExamRecordDetailDrawer } = await import('../src/components/ExamRecordDetailDrawer.js');
  const requested: string[] = [];
  const granted = new Set(['major.read', 'device.read']);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.includes('resource=record-operations')) return jsonResponse({ ok: true, data: [] });
    if (url.includes('record-precheck')) return jsonResponse({ ok: true, data: {} });
    if (url.includes('device-bindings')) return jsonResponse({ ok: true, bindings: [] });
    if (url.includes('resource=record&')) return jsonResponse({ ok: true, data: RECORD });
    return jsonResponse({ ok: false, code: 'UNKNOWN', error: 'unexpected' }, 400);
  }) as typeof fetch;

  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(ExamRecordDetailDrawer, {
            recordId: RECORD.id,
            // 关键：调用方没有这一行（日程轴上的行就是这样）——以前抽屉直接不渲染。
            record: null,
            grades: [],
            classes: [],
            can: (permission: string) => granted.has(permission),
            onClose: () => {},
            onChanged: () => {},
          }),
        ),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const tree = JSON.stringify(renderer?.toJSON() ?? null);
    assert.ok(
      requested.some((url) => url.includes('resource=record&recordId=' + RECORD.id)),
      '必须按 id 取这条记录',
    );
    assert.ok(tree.includes('考试详情'), '抽屉必须先渲染出来（以前这里是空白）');
    assert.ok(tree.includes('测试111'), '取到的记录要渲染进抽屉');
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

/** 用一条给定的记录渲染详情抽屉，返回渲染树文本（创建人显示名的回归用）。 */
async function renderDrawerTree(record: Record<string, unknown>): Promise<string> {
  installCssHook();
  const { default: ExamRecordDetailDrawer } = await import('../src/components/ExamRecordDetailDrawer.js');
  const granted = new Set(['major.read', 'device.read']);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('resource=record-operations')) return jsonResponse({ ok: true, data: [] });
    if (url.includes('record-precheck')) return jsonResponse({ ok: true, data: {} });
    if (url.includes('device-bindings')) return jsonResponse({ ok: true, bindings: [] });
    if (url.includes('resource=record&')) return jsonResponse({ ok: true, data: record });
    return jsonResponse({ ok: false, code: 'UNKNOWN', error: 'unexpected' }, 400);
  }) as typeof fetch;

  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(ExamRecordDetailDrawer, {
            recordId: String(record.id),
            record: null,
            grades: [],
            classes: [],
            can: (permission: string) => granted.has(permission),
            onClose: () => {},
            onChanged: () => {},
          }),
        ),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return JSON.stringify(renderer?.toJSON() ?? null);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    globalThis.fetch = ORIGINAL_FETCH;
  }
}

/**
 * 创建人以前只显示 `#7` 这种编号，管理员认不出是谁建的。
 * 服务端读列表/单条时顺带带出 `createdByName`，渲染时优先用它，读不到才回退编号。
 */
test('考试详情抽屉：创建人显示姓名，读不到姓名才回退 #id', async () => {
  const named = await renderDrawerTree({ ...RECORD, createdBy: 7, createdByName: '王老师' });
  assert.ok(named.includes('王老师'), '有显示名时要显示姓名');
  assert.ok(!named.includes('#7'), '有姓名时不该再显示 #id');

  const fallback = await renderDrawerTree({ ...RECORD, createdBy: 7, createdByName: '' });
  assert.ok(fallback.includes('#7'), '没有显示名时回退到 #7');
});
