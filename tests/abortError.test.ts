import assert from 'node:assert/strict';
import test from 'node:test';
import { isAbortError } from '../src/shared/abortError.js';

test('aborted fetches are recognised across browser wordings', () => {
  // 线上样例：Chrome 在 cleanup 里 abort 后抛出（action=unhandledrejection）
  const chromeLike = new Error('signal is aborted without reason');
  chromeLike.name = 'AbortError';
  assert.equal(isAbortError(chromeLike), true);
  // 只有 message、没有 name 的实现同样要认出来
  assert.equal(isAbortError(new Error('signal is aborted without reason')), true);
  assert.equal(isAbortError(new Error('The user aborted a request.')), true);
  assert.equal(isAbortError(new Error('The operation was aborted.')), true);
  assert.equal(isAbortError({ name: 'AbortError', message: '' }), true);
  assert.equal(isAbortError('signal is aborted without reason'), true);
});

test('timeouts and ordinary failures are not treated as cancellations', () => {
  const timeout = new Error('signal timed out');
  timeout.name = 'TimeoutError';
  assert.equal(isAbortError(timeout), false);
  assert.equal(isAbortError(new TypeError('Failed to fetch')), false);
  assert.equal(isAbortError(new Error('数据读取失败')), false);
  assert.equal(isAbortError(undefined), false);
  assert.equal(isAbortError(null), false);
  assert.equal(isAbortError({}), false);
});
