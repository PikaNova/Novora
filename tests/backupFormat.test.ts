import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BACKUP_TABLES,
  backupDay,
  digest,
  pack,
  unpack,
  sanitizeData,
  validId,
  type BackupData,
} from '../api/_backup/format.js';

function data(): BackupData {
  const value = Object.fromEntries(BACKUP_TABLES.map((table) => [table, []])) as unknown as BackupData;
  value.exam_data = [{ id: 1, title: '中文学校' }];
  value.app_roles = [{ id: 'super_admin', permissions: ['*'] }];
  value.app_users = [
    {
      id: 1,
      username: 'admin',
      role_id: 'super_admin',
      status: 'active',
      must_change_password: false,
      password_hash: 'a'.repeat(86),
      password_salt: 'b'.repeat(22),
    },
  ];
  value.app_user_scopes = [{ user_id: 1, scope_type: 'all' }];
  return value;
}
test('backup roundtrip preserves Chinese data and checksummed metadata', () => {
  const text = pack(data(), digest('schema'), 1234);
  assert.deepEqual(unpack(text).data, data());
  const parsed = JSON.parse(text);
  parsed.createdAt++;
  assert.throws(() => unpack(JSON.stringify(parsed)), /校验失败/);
});
test('backup digest is canonical across object key order', () => {
  assert.equal(digest({ z: [1, 2], a: { y: 1, x: 2 } }), digest({ a: { x: 2, y: 1 }, z: [1, 2] }));
});
test('backup rejects missing or unexpected tables and invalid rows', () => {
  const missing = data();
  delete (missing as Partial<BackupData>).exam_records;
  assert.throws(() => unpack(pack(missing, digest('schema'))), /数据表/);
  const extra = { ...data(), injected_table: [] };
  assert.throws(() => unpack(pack(extra, digest('schema'))), /数据表/);
  const invalid = data();
  invalid.exam_records = [null as unknown as Record<string, unknown>];
  assert.throws(() => unpack(pack(invalid, digest('schema'))), /数据无效/);
});
test('backup must have usable full-scope administrator and school singleton', () => {
  for (const change of [
    (value: BackupData) => {
      value.app_users[0].status = 'disabled';
    },
    (value: BackupData) => {
      value.app_users[0].password_hash = 'invalid';
    },
    (value: BackupData) => {
      value.app_users[0].must_change_password = true;
    },
    (value: BackupData) => {
      value.app_user_scopes = [];
    },
    (value: BackupData) => {
      value.app_roles[0].permissions = [];
    },
    (value: BackupData) => {
      value.exam_data = [];
    },
  ]) {
    const value = data();
    change(value);
    assert.throws(() => unpack(pack(value, digest('schema'))));
  }
});
test('backup input rejects non-JSON, unsupported versions and oversize files', () => {
  assert.throws(() => unpack('not json'), /JSON/);
  assert.throws(() => unpack('null'), /格式/);
  const value = JSON.parse(pack(data(), digest('schema')));
  value.version = 2;
  assert.throws(() => unpack(JSON.stringify(value)), /格式/);
  assert.throws(() => unpack(' '.repeat(20 * 1024 * 1024 + 1)), /20 MiB/);
});
test('backup date uses Shanghai midnight and identifiers reject path injection', () => {
  assert.equal(backupDay(Date.parse('2026-10-30T15:59:59Z')), '2026-10-30');
  assert.equal(backupDay(Date.parse('2026-10-30T16:00:00Z')), '2026-10-31');
  assert.equal(validId('12345678-1234-1234-1234-123456789abc'), '12345678-1234-1234-1234-123456789abc');
  for (const value of ['../file', 'x', undefined]) assert.throws(() => validId(value));
});
test('backup sanitizes commands, pairing and heartbeat data without losing bindings', () => {
  const value = data();
  value.device_instances = [{ instance_id: 'binding', temporary_command: { action: 'shutdown' }, last_seen_at: 100 }];
  value.classisland_plugin_instances = [{ id: 'plugin', pair_token_hash: 'secret', pair_expires_at: 500 }];
  value.app_time_control = [{ sync_request_id: 'old', sync_requested_at: 100 }];
  sanitizeData(value);
  assert.equal(value.device_instances[0].instance_id, 'binding');
  assert.equal(value.device_instances[0].temporary_command, null);
  assert.equal(value.device_instances[0].last_seen_at, 0);
  assert.equal(value.classisland_plugin_instances[0].pair_token_hash, null);
  assert.equal(value.app_time_control[0].sync_request_id, '');
});
