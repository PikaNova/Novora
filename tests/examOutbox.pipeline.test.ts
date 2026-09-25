import assert from 'node:assert/strict';
import test from 'node:test';
import type { PendingExamSync } from '../src/services/examOutbox.js';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
  }
  get length(): number {
    return this.values.size;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
}

const testGlobals = globalThis as typeof globalThis & {
  localStorage?: MemoryStorage;
  navigator?: { onLine: boolean };
  fetch?: typeof fetch;
  __APP_VERSION__?: string;
  __COMMIT_SHA__?: string;
};
testGlobals.localStorage = new MemoryStorage();
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
testGlobals.__APP_VERSION__ = 'test';
testGlobals.__COMMIT_SHA__ = 'test';

const { queuePendingExamSync, getPendingExamSync, flushPendingExamSync } =
  await import('../src/services/examOutbox.js');
const { __resetSyncQueueForTests } = await import('../src/services/syncQueue.js');

function setTestOwner(): void {
  testGlobals.localStorage?.setItem(
    'admin_user_context',
    JSON.stringify({
      id: 1,
      username: 'test-admin',
      displayName: 'Test admin',
      roleId: 'super_admin',
      roleName: 'Super admin',
      permissions: ['*'],
      scopes: [{ type: 'all', gradeId: '', classId: '' }],
      mustChangePassword: false,
    }),
  );
}

function basePayload(savedAt = 100) {
  return {
    items: [],
    title: 'Base',
    majors: [{ id: 'major-shared', name: 'Shared', items: [], order: 0 }],
    activeMajorId: 'major-shared',
    alerts: null,
    updatedAt: savedAt,
  };
}

function pending(payload: PendingExamSync['payload'], baseSnapshot: PendingExamSync['baseSnapshot'], savedAt: number) {
  return { payload, baseSnapshot, savedAt };
}

test('continuous edits keep the latest payload, then network recovery merges the conflict retry', async () => {
  __resetSyncQueueForTests();
  testGlobals.localStorage?.clear();
  setTestOwner();

  const base = basePayload(100);
  const firstPayload = {
    ...base,
    majors: [{ id: 'major-local', name: 'First edit', items: [], order: 1 }],
    activeMajorId: 'major-local',
    updatedAt: 100,
  };
  const latestPayload = {
    ...base,
    majors: [{ id: 'major-local-latest', name: 'Second edit', items: [], order: 1 }],
    activeMajorId: 'major-local-latest',
    weeklyPlans: [
      {
        id: 'weekly-local',
        name: 'Local weekly',
        enabled: true,
        timezone: 'Asia/Shanghai' as const,
        activeFrom: '2026-08-30',
        activeUntil: null,
        repeatEveryWeeks: 1,
        anchorDate: '2026-08-30',
        items: [],
        excludedDates: [],
        overrides: [],
        order: 0,
        gradeId: 'grade-1',
        classId: 'class-1',
      },
    ],
    activeWeeklyPlanId: 'weekly-local',
    updatedAt: 100,
  };
  const remote = {
    ...base,
    majors: [
      { id: 'major-shared', name: 'Shared', items: [], order: 0 },
      { id: 'major-remote', name: 'Remote edit', items: [], order: 1 },
    ],
    activeMajorId: 'major-remote',
    updatedAt: 150,
  };

  queuePendingExamSync(pending(firstPayload, base, 1000));
  queuePendingExamSync(pending(latestPayload, base, 2000));

  const requests: Array<Record<string, unknown>> = [];
  const responses = [
    new Response(JSON.stringify({ ok: true, code: 'DATA_CONFLICT', remote }), { status: 409 }),
    new Response(JSON.stringify({ ok: true, updatedAt: 200 })),
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return responses.shift()!;
  };

  try {
    const result = await flushPendingExamSync();
    assert.equal(result.kind, 'saved');
    assert.equal(
      requests[0]?.majors &&
        (requests[0].majors as unknown[])[0] &&
        (requests[0].majors as Array<{ id: string }>)[0].id,
      'major-local-latest',
    );
    assert.equal(requests[1]?.baseUpdatedAt, 150);
    const retryMajors = requests[1]?.majors as Array<{ id: string }> | undefined;
    assert.ok(retryMajors?.some((major) => major.id === 'major-remote'));
    assert.ok(retryMajors?.some((major) => major.id === 'major-local-latest'));
    assert.equal(getPendingExamSync(), null);
  } finally {
    globalThis.fetch = originalFetch;
    testGlobals.localStorage?.clear();
  }
});

// 冲突重试的基线：409 回传的 remote 必须被记下来，否则重试会退回「整份提交」，
// 把 A 段省下来的字节又还回去（改动前就是这样）。
test('conflict retry keeps submitting only the changed domain', async () => {
  __resetSyncQueueForTests();
  testGlobals.localStorage?.clear();
  setTestOwner();

  const schoolClass = (name: string) => ({ id: 'class-1', gradeId: 'grade-1', name, order: 0, enabled: true });
  const weeklyPlan = (name: string) => ({
    id: 'weekly-1',
    name,
    enabled: true,
    timezone: 'Asia/Shanghai' as const,
    activeFrom: '2026-08-30',
    activeUntil: null,
    repeatEveryWeeks: 1,
    anchorDate: '2026-08-30',
    items: [],
    excludedDates: [],
    overrides: [],
    order: 0,
    gradeId: 'grade-1',
    classId: 'class-1',
  });

  const header = {
    items: [],
    title: '期中考试',
    majors: [{ id: 'major-1', name: '期中考试', items: [], order: 0 }],
    activeMajorId: 'major-1',
    alerts: null,
    classes: [schoolClass('1 班')],
  };
  // 云端有周测计划，本节待同步的载荷只带大型考试与班级（后台保存大型考试走的就是这条路）。
  const baseSnapshot = {
    ...header,
    weeklyPlans: [weeklyPlan('第 1 周')],
    revisions: { classes: 4, weekly: 7 },
    updatedAt: 100,
  };
  // 本地只改班级，远端只改周测：两者互不冲突，重试应该只提交 classes。
  const local = { ...header, classes: [schoolClass('1 班（改）')] };
  const remote = {
    ...header,
    weeklyPlans: [weeklyPlan('第 1 周（远端改）')],
    revisions: { classes: 4, weekly: 8 },
    updatedAt: 150,
  };

  queuePendingExamSync(pending(local, baseSnapshot, 1000));

  const requests: Array<Record<string, unknown>> = [];
  const responses = [
    new Response(JSON.stringify({ ok: true, code: 'DATA_CONFLICT', remote }), { status: 409 }),
    new Response(JSON.stringify({ ok: true, updatedAt: 200, revisions: { classes: 5, weekly: 8 } })),
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return responses.shift()!;
  };

  try {
    const result = await flushPendingExamSync();
    assert.equal(result.kind, 'saved');
    // 第一次提交：本机还没有该版本的基线，只能整份提交（与改动前一致）。
    assert.ok(requests[0] && 'majors' in requests[0], '首次提交在缺少基线时应整份提交');
    // 重试：以 409 回传的云端版本为基线，只提交真正变化的 classes，并带上对应修订号。
    assert.deepEqual(Object.keys(requests[1] ?? {}).sort(), ['baseRevisions', 'baseUpdatedAt', 'classes']);
    assert.deepEqual(requests[1]?.baseRevisions, { classes: 4, weekly: 8 });
    assert.equal((requests[1]?.classes as Array<{ name: string }>)[0]?.name, '1 班（改）');
    assert.equal(getPendingExamSync(), null);
  } finally {
    globalThis.fetch = originalFetch;
    testGlobals.localStorage?.clear();
  }
});
