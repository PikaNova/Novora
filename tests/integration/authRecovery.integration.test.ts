/**
 * 超级管理员恢复路径的真实库集成测试（v1.32 拆分后补网）。
 *
 * 这些函数原先挤在 api/_auth.ts 里、且没有任何用例直接覆盖；拆分把它们搬到
 * api/_auth/recovery.ts 后，用真实库把三条路径钉住：
 *   ① 首次生成恢复密钥：只生成一次、落库为加盐哈希、不存明文；
 *   ② 带密钥抢修：错误密钥只留失败审计，正确密钥能重设口令并让新口令登录；
 *   ③ 失败次数限流：15 分钟窗口内达到上限后，连正确密钥也会先被限流挡住。
 *
 * 只跑在 runner 注入的 disposable 库（INTEGRATION_DATABASE_URL）上。
 */
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import {
  authSql,
  authenticateUser,
  ensureAuthTables,
  ensureGeneratedRecoveryKey,
  isAdminRecoveryConfigured,
  recoverSuperAdmin,
  repairSuperAdmin,
} from '../../api/_auth.js';
import { assertRows, isNumberLike, isString, rowShape } from '../../api/_validation.js';

const adminPassword = process.env.ADMIN_PASSWORD ?? '';
/** 独立用户名：不碰其它集成文件依赖的 admin 账号。 */
const PROBE_USERNAME = 'auth_recovery_probe';
const EMPTY_RECOVERY = 'not-the-recovery-key';

const isValueRow = rowShape<{ value: string }>({ value: isString });
const isCountValueRow = rowShape<{ count: number; value: number }>({ count: isNumberLike, value: isNumberLike });

let recoveryKey = '';

async function authTokenVersion(): Promise<number> {
  const rows = assertRows(
    await authSql()`SELECT token_version::text AS value FROM app_auth WHERE id=1`,
    isValueRow,
    'app_auth',
  );
  return Number(rows[0]?.value ?? 0);
}

async function recoveryAuditCounts(): Promise<{ failed: number; succeeded: number }> {
  const rows = assertRows(
    await authSql()`SELECT
      COUNT(*) FILTER (WHERE action='user.super_admin.repair.failed')::int AS count,
      COUNT(*) FILTER (WHERE action='user.super_admin.repair')::int AS value
      FROM app_audit_logs`,
    isCountValueRow,
    'app_audit_logs',
  );
  return { failed: Number(rows[0]?.count ?? 0), succeeded: Number(rows[0]?.value ?? 0) };
}

async function resetRecoveryState(): Promise<void> {
  // 恢复密钥是「只生成一次」的单行状态，前一个用例留下的哈希会让下一个用例拿到 null，
  // 所以每个用例都先把这一行清回未生成态。
  await authSql()`UPDATE app_auth SET recovery_key_hash=NULL, recovery_key_salt=NULL WHERE id=1`;
  await authSql()`DELETE FROM app_users WHERE LOWER(username)=LOWER(${PROBE_USERNAME})`;
  await authSql()`DELETE FROM app_audit_logs
    WHERE action IN ('user.super_admin.repair','user.super_admin.repair.failed','user.password.recover')`;
}

beforeEach(async () => {
  assert.ok(adminPassword.length >= 16, 'the integration runner must inject a strong temporary password');
  await ensureAuthTables();
  // 先走一次正常登录：它保证 app_auth 单行配置与默认超级管理员存在。
  const login = await authenticateUser('admin', adminPassword);
  assert.ok(login, 'the integration runner must bootstrap the disposable super administrator');
  await resetRecoveryState();
  const created = await ensureGeneratedRecoveryKey();
  assert.ok(created && created.startsWith('NVR-'), 'expected a freshly generated recovery key');
  recoveryKey = created;
});

after(async () => {
  await resetRecoveryState();
  await authSql()`UPDATE app_auth SET recovery_key_hash=NULL, recovery_key_salt=NULL WHERE id=1`;
});

test('恢复密钥：只生成一次，库里存的是加盐哈希而不是明文', async () => {
  const stored = assertRows(
    await authSql()`SELECT recovery_key_hash AS value FROM app_auth WHERE id=1`,
    isValueRow,
    'app_auth',
  );
  assert.notEqual(stored[0]?.value, recoveryKey, 'must not persist the recovery key in clear text');
  assert.equal(await ensureGeneratedRecoveryKey(), null, 'a second call must not mint a new key');
  assert.equal(await isAdminRecoveryConfigured(), true);
});

test('抢修：错误密钥只写失败审计，正确密钥重设口令后新口令可登录', async () => {
  const before = await authTokenVersion();
  const rejected = await repairSuperAdmin(PROBE_USERNAME, EMPTY_RECOVERY, 'ProbePass12345');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, '恢复信息不正确');
  assert.deepEqual(await recoveryAuditCounts(), { failed: 1, succeeded: 0 });
  assert.equal(
    await authenticateUser(PROBE_USERNAME, 'ProbePass12345'),
    null,
    'failed repair must not create the user',
  );

  const repaired = await repairSuperAdmin(PROBE_USERNAME, recoveryKey, 'ProbePass12345');
  assert.equal(repaired.ok, true);
  assert.equal(repaired.created, true);
  assert.deepEqual(await recoveryAuditCounts(), { failed: 1, succeeded: 1 });

  const login = await authenticateUser(PROBE_USERNAME, 'ProbePass12345');
  assert.ok(login, 'the repaired account must be able to log in with the new password');
  assert.equal(login.actor.roleId, 'super_admin');
  assert.equal(login.actor.permissions.includes('*'), true);
  assert.equal(login.actor.mustChangePassword, true, 'a repaired account must be forced to change the password');
  // 新建账号这一支不碰旧共享令牌的全局版本：旧令牌映射到 admin 账号，
  // 只有「改动既有账号」的支路才需要把旧令牌一并作废（见下一个用例）。
  assert.equal(await authTokenVersion(), before, 'creating a brand-new account must not bump the shared token version');
});

test('抢修：同一窗口内失败达到上限后，连正确密钥也先被限流挡住', async () => {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const rejected = await repairSuperAdmin(PROBE_USERNAME, EMPTY_RECOVERY, 'ProbePass12345');
    assert.equal(rejected.ok, false, `attempt ${attempt} must be rejected`);
    assert.equal(rejected.error, '恢复信息不正确');
    assert.equal(rejected.retryAfterMs, undefined, `attempt ${attempt} must not be throttled yet`);
  }

  const throttled = await repairSuperAdmin(PROBE_USERNAME, recoveryKey, 'ProbePass12345');
  assert.equal(throttled.ok, false);
  assert.match(String(throttled.error), /频繁/);
  assert.ok((throttled.retryAfterMs ?? 0) > 0, 'throttling must tell the caller when to retry');
  // 限流发生在密钥校验之前，所以这一轮不能留下「抢修成功」的痕迹。
  const login = await authenticateUser(PROBE_USERNAME, 'ProbePass12345');
  assert.equal(login, null, 'a throttled repair must not create or update the account');
});

test('恢复：只认超级管理员账号，且非法的短口令先被拒', async () => {
  // 先把探针账号变成超级管理员（不碰 admin：其它集成文件还要用 runner 注入的口令登录它）。
  assert.equal((await repairSuperAdmin(PROBE_USERNAME, recoveryKey, 'ProbePass12345')).ok, true);

  assert.equal((await recoverSuperAdmin('nobody-here', recoveryKey, 'ProbePass12345')).ok, false);
  assert.equal((await recoverSuperAdmin(PROBE_USERNAME, EMPTY_RECOVERY, 'ProbePass12345')).ok, false);
  assert.deepEqual(await recoverSuperAdmin(PROBE_USERNAME, recoveryKey, 'short'), {
    ok: false,
    error: '新密码至少需要 8 位',
  });

  const before = await authTokenVersion();
  const recovered = await recoverSuperAdmin(PROBE_USERNAME, recoveryKey, 'RecoveredPass123');
  assert.equal(recovered.ok, true);
  assert.equal(
    await authTokenVersion(),
    before + 1,
    'recovering an existing account must invalidate legacy shared tokens',
  );
  const login = await authenticateUser(PROBE_USERNAME, 'RecoveredPass123');
  assert.ok(login, 'the recovered account must log in with the new password');
  assert.equal(login.actor.mustChangePassword, true);
  assert.equal(login.actor.roleId, 'super_admin');
});
