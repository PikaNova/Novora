import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBuildCommit } from '../api/_buildInfo.js';

test('build info: 按 COMMIT_SHA → VERCEL_GIT_COMMIT_SHA → GIT_COMMIT 的优先级取值', () => {
  assert.equal(
    resolveBuildCommit({
      COMMIT_SHA: 'aaa1111',
      VERCEL_GIT_COMMIT_SHA: 'bbb2222',
      GIT_COMMIT: 'ccc3333',
    }),
    'aaa1111',
  );
  assert.equal(resolveBuildCommit({ VERCEL_GIT_COMMIT_SHA: 'bbb2222', GIT_COMMIT: 'ccc3333' }), 'bbb2222');
  assert.equal(resolveBuildCommit({ GIT_COMMIT: 'ccc3333' }), 'ccc3333');
});

test('build info: 没注入就返回 null，而不是编一个值', () => {
  assert.equal(resolveBuildCommit({}), null);
  assert.equal(resolveBuildCommit({ COMMIT_SHA: '   ' }), null);
});

test('build info: 去掉空白并截断到 40 字符', () => {
  assert.equal(resolveBuildCommit({ COMMIT_SHA: '  abc1234  ' }), 'abc1234');
  const long = 'x'.repeat(80);
  assert.equal(resolveBuildCommit({ COMMIT_SHA: long })?.length, 40);
});
