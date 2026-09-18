import assert from 'node:assert/strict';
import test from 'node:test';
import { CHUNK_RELOAD_COOLDOWN_MS, isChunkLoadError, shouldRetryChunkLoad } from '../src/shared/chunkLoadError.js';
import { reloadOnceForChunkError } from '../src/utils/chunkLoadRecovery.js';

const NOW = 1_700_000_000_000;

test('chunk load failures are recognised across browser wordings', () => {
  const errors = [
    new TypeError(
      'Failed to fetch dynamically imported module: https://dev.pikachu2026.space/assets/LoginPage-0U8YhDpb.js',
    ),
    new TypeError('error loading dynamically imported module: https://example.com/assets/a.js'),
    new TypeError('Importing a module script failed.'),
    new Error('Unable to preload CSS for /assets/LoginPage-Cdc9M_-A.css'),
  ];
  for (const error of errors) assert.equal(isChunkLoadError(error), true, error.message);
});

test('unrelated errors are not treated as chunk load failures', () => {
  for (const error of [
    new Error('Failed to fetch'),
    new TypeError("Cannot read properties of undefined (reading 'default')"),
    new Error('Database write failed'),
    undefined,
    null,
    {},
  ]) {
    assert.equal(isChunkLoadError(error), false, String(error));
  }
});

test('automatic reload is throttled by a cooldown window', () => {
  assert.equal(shouldRetryChunkLoad(0, NOW), true);
  assert.equal(shouldRetryChunkLoad(null, NOW), true);
  assert.equal(shouldRetryChunkLoad(Number.NaN, NOW), true);
  assert.equal(shouldRetryChunkLoad(NOW - 1_000, NOW), false);
  assert.equal(shouldRetryChunkLoad(NOW - CHUNK_RELOAD_COOLDOWN_MS, NOW), true);
  assert.equal(shouldRetryChunkLoad(NOW - CHUNK_RELOAD_COOLDOWN_MS + 1, NOW), false);
});

test('recovery reloads the page once and then waits out the cooldown', () => {
  const store = new Map<string, string>();
  const pending: Array<() => void> = [];
  let reloads = 0;
  const fakeWindow = {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
    setTimeout: (handler: () => void) => {
      pending.push(handler);
      return pending.length;
    },
    location: { reload: () => void (reloads += 1) },
  };
  (globalThis as unknown as { window: unknown }).window = fakeWindow;
  try {
    assert.equal(reloadOnceForChunkError(NOW), true);
    assert.equal(store.get('novora_chunk_reload_at_v1'), String(NOW));
    // 冷却期内再次失败不再刷新，避免服务端异常时陷入刷新循环。
    assert.equal(reloadOnceForChunkError(NOW + 5_000), false);
    assert.equal(reloadOnceForChunkError(NOW + CHUNK_RELOAD_COOLDOWN_MS), true);

    assert.equal(pending.length, 2);
    for (const handler of pending) handler();
    assert.equal(reloads, 2);
  } finally {
    Reflect.deleteProperty(globalThis, 'window');
  }
});
