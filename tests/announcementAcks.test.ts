import assert from 'node:assert/strict';
import test from 'node:test';
// 先装浏览器常量/存储，再引服务（ESM 按 import 顺序求值）。
import './helpers/browserGlobals.js';
import {
  ANNOUNCEMENT_ACK_PENDING_KEY,
  dropPendingAnnouncementAcks,
  flushAnnouncementAcks,
  queueAnnouncementSeen,
  readPendingAnnouncementAcks,
} from '../src/services/announcementAcks.js';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    raw: values,
  };
}

function fetchStub(
  handler: (url: string, init?: { body?: string }) => { ok: boolean; recorded?: number; reject?: boolean },
) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ url, body });
    const result = handler(url, { body: init?.body as string | undefined });
    if (result.reject) throw new Error('network down');
    return {
      ok: result.ok,
      status: result.ok ? 200 : 500,
      json: async () => ({ ok: result.ok, recorded: result.recorded ?? 0 }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test('回执缓冲：同一公告多次上报累加时长，非法条目被丢掉', () => {
  const store = memoryStorage();
  queueAnnouncementSeen([{ id: 'ann_a', seenMs: 3000 }], store);
  queueAnnouncementSeen(
    [
      { id: 'ann_a', seenMs: 2000 },
      { id: 'ann_b', seenMs: -5 },
      { id: '', seenMs: 1000 },
      { id: 'ann_c', seenMs: 4000 },
    ],
    store,
  );
  assert.deepEqual(readPendingAnnouncementAcks(store), { ann_a: 5000, ann_c: 4000 });
});

test('回执缓冲：坏数据不会让队列整体失效', () => {
  const store = memoryStorage();
  store.setItem(ANNOUNCEMENT_ACK_PENDING_KEY, 'not json');
  assert.deepEqual(readPendingAnnouncementAcks(store), {});
  queueAnnouncementSeen([{ id: 'ann_a', seenMs: 3000 }], store);
  assert.deepEqual(readPendingAnnouncementAcks(store), { ann_a: 3000 });
});

test('回执上报：成功后清掉已确认的条目，服务端拒绝时保留缓冲', async () => {
  const store = memoryStorage();
  queueAnnouncementSeen(
    [
      { id: 'ann_a', seenMs: 3000 },
      { id: 'ann_b', seenMs: 4000 },
    ],
    store,
  );

  const failing = fetchStub(() => ({ ok: false }));
  assert.equal(await flushAnnouncementAcks('dev_1', store), 0);
  assert.equal(Object.keys(readPendingAnnouncementAcks(store)).length, 2, '失败后必须保留，等下次重试');
  failing.restore();

  const ok = fetchStub(() => ({ ok: true, recorded: 2 }));
  assert.equal(await flushAnnouncementAcks('dev_1', store), 2);
  assert.deepEqual(readPendingAnnouncementAcks(store), {});
  assert.equal(ok.calls.length, 1);
  assert.equal(ok.calls[0].url, '/api/exams');
  assert.equal(ok.calls[0].body.action, 'announce-ack');
  assert.equal(ok.calls[0].body.instanceId, 'dev_1');
  const sent = ok.calls[0].body.seen as Array<{ id: string; seenMs: number }>;
  assert.deepEqual(Object.fromEntries(sent.map((item) => [item.id, item.seenMs])), { ann_a: 3000, ann_b: 4000 });
  ok.restore();
});

test('回执上报：断网时不抛异常，缓冲留到下一次', async () => {
  const store = memoryStorage();
  queueAnnouncementSeen([{ id: 'ann_a', seenMs: 3000 }], store);
  const failing = fetchStub(() => ({ ok: true, reject: true }));
  assert.equal(await flushAnnouncementAcks('dev_1', store), 0);
  assert.deepEqual(readPendingAnnouncementAcks(store), { ann_a: 3000 });
  failing.restore();
});

test('回执上报：没有设备实例或缓冲为空时直接跳过，不发请求', async () => {
  const store = memoryStorage();
  const stub = fetchStub(() => ({ ok: true, recorded: 1 }));
  assert.equal(await flushAnnouncementAcks('', store), 0);
  assert.equal(await flushAnnouncementAcks('dev_1', store), 0);
  assert.equal(stub.calls.length, 0);
  stub.restore();

  queueAnnouncementSeen([{ id: 'ann_a', seenMs: 3000 }], store);
  dropPendingAnnouncementAcks(['ann_a'], store);
  assert.deepEqual(readPendingAnnouncementAcks(store), {});
});
