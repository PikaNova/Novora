import assert from 'node:assert/strict';
import test from 'node:test';
// 先装浏览器常量/存储，再引服务（ESM 按 import 顺序求值）。
import './helpers/browserGlobals.js';
import { applyFrozenArchivedMajors, saveExamsToServer, takeFrozenArchivedMajors } from '../src/services/examService.js';
import { flushPendingExamSync, queuePendingExamSync } from '../src/services/examOutbox.js';
import type { MajorExam } from '../src/types/index.js';

/**
 * 回归背景：服务端对已归档考试一律只读（发布/删除/改名都会被回退），只回一个 id 列表。
 * 客户端如果只把这次保存当成功，就会出现「本机显示删除/改名成功，刷新又变回来」。
 */

const archived = {
  id: 'archived-1',
  name: '归档考试',
  items: [],
  order: 0,
  source: 'regular',
  archivedAt: 1_700_000_000_000,
} as unknown as MajorExam;

const live = { id: 'live-1', name: '进行中考试', items: [], order: 1, source: 'regular' } as unknown as MajorExam;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** 造一个最小可用的登录态：outbox 按 ownerId 隔离，必须有用户才认待同步。 */
function signIn(): void {
  localStorage.setItem(
    'admin_user_context',
    JSON.stringify({
      id: 7,
      username: 'admin',
      displayName: '管理员',
      roleId: 'super_admin',
      roleName: '超级管理员',
      permissions: ['*'],
      scopes: [{ type: 'all', gradeId: '', classId: '' }],
    }),
  );
  localStorage.setItem('admin_auth_token', 'test-token');
}

const ORIGINAL_FETCH = globalThis.fetch;

test('applyFrozenArchivedMajors: 同 id 还原成服务端版本，服务端有而本地没有的补回来', () => {
  const localRenamed = { ...archived, name: '本地改的名字' } as MajorExam;
  const merged = applyFrozenArchivedMajors([live, localRenamed], [archived]);
  assert.deepEqual(
    merged.map((major) => `${major.id}:${major.name}`),
    ['live-1:进行中考试', 'archived-1:归档考试'],
  );

  const restored = applyFrozenArchivedMajors([live], [archived]);
  assert.deepEqual(
    restored.map((major) => major.id),
    ['live-1', 'archived-1'],
    '本地已删除的归档考试会被放回（删不掉，界面必须如实反映）',
  );
});

test('saveExamsToServer: 接住服务端冻结的归档考试，取走即清空', async () => {
  signIn();
  takeFrozenArchivedMajors();
  globalThis.fetch = (async () =>
    jsonResponse({
      ok: true,
      updatedAt: 123,
      ignoredArchivedMajors: ['archived-1'],
      frozenMajors: [archived],
    })) as typeof fetch;
  try {
    const result = await saveExamsToServer({
      items: [],
      title: '测试',
      majors: [live],
      activeMajorId: live.id,
    });
    assert.equal(result, 123, '保存本身仍然是成功的');
    assert.deepEqual(
      takeFrozenArchivedMajors().map((major) => major.id),
      ['archived-1'],
      '冻结条目要能被调用方取走去回灌本地状态',
    );
    assert.deepEqual(takeFrozenArchivedMajors(), [], '取走后必须清空，避免重复提示');
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('flushPendingExamSync: 待同步的删除被服务端冻结时，载荷并回服务端版本', async () => {
  signIn();
  takeFrozenArchivedMajors();
  // 本地待同步：删掉了归档考试（没有它），另有一场正常考试。
  queuePendingExamSync({
    payload: { items: [], title: '测试', majors: [live], activeMajorId: live.id, alerts: null },
    baseSnapshot: {
      items: [],
      title: '测试',
      majors: [live, archived],
      activeMajorId: live.id,
      alerts: null,
      updatedAt: 1,
    },
    savedAt: 1,
  });
  // 服务端：接受保存，但把归档考试冻结回自己的版本。
  globalThis.fetch = (async () =>
    jsonResponse({
      ok: true,
      updatedAt: 456,
      ignoredArchivedMajors: ['archived-1'],
      frozenMajors: [archived],
    })) as typeof fetch;
  try {
    const flushed = await flushPendingExamSync(true);
    assert.equal(flushed.kind, 'saved');
    const majors = flushed.kind === 'saved' ? flushed.payload.majors : [];
    assert.deepEqual(
      majors.map((major) => major.id),
      ['live-1', 'archived-1'],
      '待同步载荷要并回被冻结的归档考试，界面才不会一直显示"已删除"',
    );
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});
