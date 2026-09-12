import assert from 'node:assert/strict';
import test from 'node:test';
import { examSnapshotQuery, isCurrentSnapshotRequest, parseExamVersion } from '../src/shared/examContracts.js';

test('exam versions normalize to positive integers', () => {
  assert.equal(parseExamVersion(1789222939596), 1789222939596);
  assert.equal(parseExamVersion('1789222939596'), 1789222939596);
  assert.equal(parseExamVersion(12.7), 12);
  assert.equal(parseExamVersion(undefined), 0);
  assert.equal(parseExamVersion(''), 0);
  assert.equal(parseExamVersion(-1), 0);
  assert.equal(parseExamVersion(Number.NaN), 0);
  assert.equal(parseExamVersion(Infinity), 0);
});

test('snapshot query carries the version and never emits junk', () => {
  assert.equal(examSnapshotQuery(1789222939596), 'resource=snapshot&v=1789222939596');
  assert.equal(examSnapshotQuery('1789222939596'), 'resource=snapshot&v=1789222939596');
  assert.equal(examSnapshotQuery(undefined), 'resource=snapshot&v=0');
});

test('only an exact version match on an edge deployment gets the long-lived cache', () => {
  assert.equal(isCurrentSnapshotRequest({ edgeDeployment: true, requestedVersion: 42, currentVersion: 42 }), true);
  assert.equal(isCurrentSnapshotRequest({ edgeDeployment: true, requestedVersion: '42', currentVersion: 42 }), true);
  // 版本已过期：必须按旧路径返回且不缓存，否则会把新内容写到旧版本 URL 下。
  assert.equal(isCurrentSnapshotRequest({ edgeDeployment: true, requestedVersion: 41, currentVersion: 42 }), false);
  // 本地 / Docker 部署不启用这套缓存。
  assert.equal(isCurrentSnapshotRequest({ edgeDeployment: false, requestedVersion: 42, currentVersion: 42 }), false);
  // 缺参数或非法版本一律不走缓存路径。
  assert.equal(
    isCurrentSnapshotRequest({ edgeDeployment: true, requestedVersion: undefined, currentVersion: 42 }),
    false,
  );
  assert.equal(isCurrentSnapshotRequest({ edgeDeployment: true, requestedVersion: 42, currentVersion: 0 }), false);
  assert.equal(isCurrentSnapshotRequest({ edgeDeployment: true, requestedVersion: 0, currentVersion: 0 }), false);
});
