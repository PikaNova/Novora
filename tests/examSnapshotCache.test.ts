import assert from 'node:assert/strict';
import test from 'node:test';
import {
  examEtag,
  examSnapshotQuery,
  isCurrentSnapshotRequest,
  matchesIfNoneMatch,
  parseExamVersion,
} from '../src/shared/examContracts.js';

test('If-None-Match 用弱比较：反代 gzip 把强 ETag 变成 W/ 形式后仍要命中', () => {
  const etag = examEtag(1790264042699);
  assert.equal(etag, '"exam-1790264042699"');

  // 反代（nginx/openresty）对 gzip 过的响应会改写 ETag，客户端回传的就是这个弱形式；
  // 以前用严格相等比较，于是每次轮询都重传整份快照（dev 上 137 KB/次）。
  assert.equal(matchesIfNoneMatch(`W/${etag}`, etag), true);
  assert.equal(matchesIfNoneMatch(etag, etag), true);
  assert.equal(matchesIfNoneMatch(`  ${etag}  `, etag), true);
  assert.equal(matchesIfNoneMatch('*', etag), true);
  // 多代理链路可能回传列表，列表里任意一项命中即可
  assert.equal(matchesIfNoneMatch(`"exam-0", W/${etag}`, etag), true);

  assert.equal(matchesIfNoneMatch('"exam-0"', etag), false);
  assert.equal(matchesIfNoneMatch('', etag), false);
  assert.equal(matchesIfNoneMatch(undefined, etag), false);
  assert.equal(matchesIfNoneMatch(['"exam-0"', `W/${etag}`], etag), true);
  assert.equal(matchesIfNoneMatch(['"exam-0"', '"exam-1"'], etag), false);
});

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
