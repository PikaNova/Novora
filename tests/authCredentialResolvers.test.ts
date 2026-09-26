/**
 * 凭据解析器登记表（api/_auth/session.ts）。
 *
 * getActor 不再自己堆 if 分支，而是按注册顺序依次 match。这里钉住登记机制本身：
 * 顺序、重复注册必须报错、新格式只能追加在末尾（不能抢走已有格式的优先级）。
 * 各格式「能不能认出令牌」的行为由令牌/集成用例覆盖，不在这里重复。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { getActor, listCredentialResolvers, registerCredentialResolver } from '../api/_auth/session.js';

test('凭据解析器按注册顺序匹配：访客 → 管理员 → 旧共享令牌', () => {
  assert.deepEqual(listCredentialResolvers(), ['guest', 'admin', 'legacy-shared']);
});

test('重复注册同一个 id 会被拒绝，避免两种格式互相遮蔽', () => {
  assert.throws(
    () => registerCredentialResolver({ id: 'admin', match: () => false, resolve: async () => null }),
    /credential resolver already registered: admin/,
  );
  assert.deepEqual(listCredentialResolvers(), ['guest', 'admin', 'legacy-shared']);
});

// 下面这条会往登记表里追加一个探针解析器，因此必须放在最后：同文件内后续用例
// 若还要断言顺序，得把 'probe-device' 算进去。
test('新格式只能追加在末尾，已有格式的匹配优先级不受影响', () => {
  registerCredentialResolver({
    id: 'probe-device',
    match: (parts) => parts[0] === 'd',
    resolve: async () => null,
  });
  assert.deepEqual(listCredentialResolvers(), ['guest', 'admin', 'legacy-shared', 'probe-device']);
});

test('没有令牌时直接返回 null，不去读库', async () => {
  assert.equal(await getActor(undefined), null);
  assert.equal(await getActor(''), null);
});
