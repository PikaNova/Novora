import assert from 'node:assert/strict';
import test from 'node:test';
import type { PendingExamSync } from '../src/services/examOutbox.js';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
Object.assign(globalThis as typeof globalThis & { __APP_VERSION__: string; __COMMIT_SHA__: string }, {
  __APP_VERSION__: 'test',
  __COMMIT_SHA__: 'test',
});

const { clearPendingExamSync, flushPendingExamSync, getPendingExamSync, queuePendingExamSync } =
  await import('../src/services/examOutbox.js');

function selectOwner(id: number): void {
  storage.setItem('admin_user_context', JSON.stringify({
    id,
    username: `owner-${id}`,
    displayName: `Owner ${id}`,
    roleId: 'custom',
    roleName: 'Custom',
    permissions: [],
    scopes: [],
    mustChangePassword: false,
  }));
}

function pending(savedAt: number): PendingExamSync {
  return {
    payload: { items: [], title: '', majors: [], activeMajorId: '', alerts: null },
    baseSnapshot: null,
    savedAt,
  };
}

test('pending exam sync is isolated by authenticated owner', () => {
  storage.clear();
  selectOwner(7);
  queuePendingExamSync(pending(101));

  selectOwner(8);
  assert.equal(getPendingExamSync(), null);
  queuePendingExamSync(pending(202));

  selectOwner(7);
  assert.equal(getPendingExamSync()?.savedAt, 101);
  clearPendingExamSync(101);
  assert.equal(getPendingExamSync(), null);

  selectOwner(8);
  assert.equal(getPendingExamSync()?.savedAt, 202);
});

test('legacy unowned drafts are retained but never auto-flushed', async () => {
  storage.clear();
  storage.setItem('exam_pending_sync', JSON.stringify(pending(303)));
  selectOwner(9);
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    assert.equal(getPendingExamSync(), null);
    assert.deepEqual(await flushPendingExamSync(), { kind: 'none' });
    assert.equal(requests, 0);
    assert.ok(storage.getItem('exam_pending_sync'));
  } finally {
    globalThis.fetch = originalFetch;
    storage.clear();
  }
});
