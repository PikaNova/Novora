import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateUser, authSql, issueTokenForUser } from '../../api/_auth.js';
import { database, ensureTableOnce } from '../../api/_exams/db.js';
import { handleRuntimeLogs } from '../../api/_runtimeLogs/handler.js';
import { ensureRuntimeTables, insertRuntimeEvents } from '../../api/_runtimeLogs/store.js';
import { logServer, logServerFatal, flushServerJournal } from '../../api/_runtimeLogs/serverJournal.js';
import type { RuntimeEvent } from '../../src/shared/runtimeLog.js';

async function call(
  resource: string,
  method: string,
  token = '',
  body: Record<string, unknown> = {},
  query: Record<string, string> = {},
) {
  let status = 200;
  let payload: Record<string, unknown> = {};
  const res = {
    setHeader() {
      return res;
    },
    status(n: number) {
      status = n;
      return res;
    },
    json(value: Record<string, unknown>) {
      payload = value;
      return res;
    },
  } as unknown as VercelResponse;
  const req = {
    method,
    query,
    body,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
    cookies: {},
  } as unknown as VercelRequest;
  await handleRuntimeLogs(req, res, resource);
  return { status, payload };
}
test('runtime logging: automatic device upload, duplicate batches, filtering and audit', async () => {
  await ensureTableOnce();
  await ensureRuntimeTables();
  const login = await authenticateUser('admin', process.env.ADMIN_PASSWORD || '');
  assert.ok(login);
  const admin = login.token;
  const sql = database();
  const instanceId = 'itest_runtime_a';
  const other = 'itest_runtime_b';
  const secret = randomBytes(32).toString('hex');
  await sql`INSERT INTO device_instances(instance_id,grade_id,class_id,revoked,updated_at) VALUES (${instanceId},'g','c',FALSE,${Date.now()}),(${other},'g','d',FALSE,${Date.now()}) ON CONFLICT(instance_id) DO UPDATE SET revoked=FALSE`;
  const event: RuntimeEvent = {
    eventId: 'itest_event_1',
    sessionId: 'itest_session',
    sequence: 1,
    at: 1,
    monoMs: 20,
    level: 'error',
    category: 'sync',
    code: 'sync.failed',
    message: 'Bearer abc.def.secret',
    route: '/exam?token=secret',
    operationId: 'itest_operation',
    version: '2.8.1',
    build: 'abc',
    context: { password: 'hidden', durationMs: 300 },
  };
  try {
    assert.equal((await call('runtime-dashboard', 'GET')).status, 401);
    assert.equal((await call('runtime-enroll', 'POST', '', { instanceId: 'unknown_device', secret })).status, 401);
    assert.equal((await call('runtime-enroll', 'POST', '', { instanceId, secret })).status, 200);
    const batch = await call('runtime-ingest', 'POST', secret, { instanceId, entries: [event, event] });
    assert.equal(batch.payload.accepted, 1);
    assert.equal(batch.payload.duplicates, 1);
    assert.equal((await call('runtime-ingest', 'POST', secret, { instanceId, entries: [event] })).payload.accepted, 0);
    assert.equal(
      (await call('runtime-ingest', 'POST', secret, { instanceId, entries: [event, { bad: true }] })).status,
      400,
    );
    const rows = await sql`SELECT event FROM app_runtime_events WHERE instance_id=${instanceId}`;
    assert.equal(rows.length, 1);
    const stored = rows[0].event as RuntimeEvent;
    assert.equal(stored.context.password, undefined);
    assert.equal(stored.route, '/exam');
    assert.equal(stored.message.includes('abc.def.secret'), false);
    const page = await call('runtime-dashboard', 'GET', admin, {}, { instanceId, level: 'error', q: 'redacted' });
    assert.equal(page.status, 200);
    assert.equal((page.payload.summary as { total: number }).total, 1);
    const exp = await call('runtime-export', 'GET', admin, {}, { instanceId });
    assert.equal(exp.status, 200);
    assert.equal((exp.payload.entries as unknown[]).length, 1);
    await insertRuntimeEvents(
      instanceId,
      Array.from({ length: 105 }, (_, i) => ({
        ...stored,
        eventId: `itest_page_${i}`,
        sequence: i + 2,
        level: 'info' as const,
      })),
      Date.now() - 1000,
    );
    await insertRuntimeEvents(instanceId, [{ ...stored, eventId: 'itest_old_late', sequence: 107 }], Date.now() - 5000);
    const first = await call('runtime-dashboard', 'GET', admin, {}, { instanceId });
    assert.equal(first.payload.hasMore, true);
    const next = await call(
      'runtime-dashboard',
      'GET',
      admin,
      {},
      { instanceId, cursor: String(first.payload.nextCursor) },
    );
    const all = [
      ...(first.payload.entries as { event: RuntimeEvent }[]),
      ...(next.payload.entries as { event: RuntimeEvent }[]),
    ];
    assert.equal(new Set(all.map((r) => r.event.eventId)).size, 107);
    assert.equal(all.at(-1)?.event.eventId, 'itest_old_late');
    const sessionPage = await call('runtime-dashboard', 'GET', admin, {}, { instanceId, sessionId: 'itest_session' });
    assert.equal((sessionPage.payload.entries as { event: RuntimeEvent }[])[0].event.sequence, 1);
    await sql`UPDATE device_instances SET revoked=TRUE WHERE instance_id=${instanceId}`;
    assert.equal((await call('runtime-ingest', 'POST', secret, { instanceId, entries: [event] })).status, 401);
    const audits = await authSql()`SELECT action FROM app_audit_logs WHERE action LIKE 'diagnostics.runtime.%'`;
    assert.ok(audits.some((row) => row.action === 'diagnostics.runtime.export'));
    // A role can have diagnostic permission without being allowed to read the entire school.
    const now = Date.now();
    await authSql()`INSERT INTO app_roles(id,name,description,permissions,built_in,created_at,updated_at) VALUES ('itest_runtime_scoped','scoped','',${JSON.stringify(['diagnostics.read', 'diagnostics.download'])}::jsonb,FALSE,${now},${now}) ON CONFLICT(id) DO UPDATE SET permissions=EXCLUDED.permissions`;
    const users =
      await authSql()`INSERT INTO app_users(username,display_name,password_hash,password_salt,role_id,status,must_change_password,token_version,created_at,updated_at) VALUES ('itest_runtime_scoped','scoped','x','x','itest_runtime_scoped','active',FALSE,1,${now},${now}) RETURNING id`;
    const userId = Number(users[0].id);
    await authSql()`INSERT INTO app_user_scopes(user_id,scope_type,grade_id,class_id) VALUES (${userId},'class','g','c') ON CONFLICT DO NOTHING`;
    const token = await issueTokenForUser({ id: userId, token_version: 1 });
    assert.ok(token);
    assert.equal((await call('runtime-dashboard', 'GET', token.token)).status, 403);
    assert.equal((await call('runtime-export', 'GET', token.token)).status, 403);
  } finally {
    await sql`DELETE FROM app_runtime_events WHERE instance_id IN (${instanceId},${other})`;
    await sql`DELETE FROM device_instances WHERE instance_id IN (${instanceId},${other})`;
    await authSql()`DELETE FROM app_users WHERE username='itest_runtime_scoped'`;
    await authSql()`DELETE FROM app_roles WHERE id='itest_runtime_scoped'`;
  }
});

test('local journal stores sanitized fallback and replays after the database table recovers', async () => {
  await ensureRuntimeTables();
  const sql = database();
  const dir = await mkdtemp(join(tmpdir(), 'novora-runtime-'));
  process.env.NOVORA_RUNTIME_LOG_DIR = dir;
  try {
    await sql`ALTER TABLE app_runtime_events RENAME TO app_runtime_events_offline_test`;
    logServer('server.fallback.test', { password: 'do-not-save' }, 'error', 'Bearer do-not-save');
    await flushServerJournal();
    const files = await readdir(dir);
    assert.ok(files.includes('runtime.jsonl'));
    const raw = await readFile(join(dir, 'runtime.jsonl'), 'utf8');
    assert.equal(raw.includes('do-not-save'), false);
    // A fatal exit must synchronously leave evidence and rotate before crossing the file cap.
    await writeFile(join(dir, 'runtime.jsonl'), raw + ' '.repeat(4 * 1024 * 1024 - Buffer.byteLength(raw)));
    logServerFatal(new Error('Bearer do-not-save'));
    for (const file of await readdir(dir)) assert.ok((await stat(join(dir, file))).size <= 4 * 1024 * 1024);
    await sql`ALTER TABLE app_runtime_events_offline_test RENAME TO app_runtime_events`;
    await new Promise((resolve) => setTimeout(resolve, 5100));
    logServer('server.recovery.test');
    await flushServerJournal();
    const rows = await sql`SELECT event FROM app_runtime_events WHERE event->>'code'='server.fallback.test'`;
    assert.ok(rows.length);
    assert.equal((await readdir(dir)).includes('runtime.jsonl'), false);
    await sql`DELETE FROM app_runtime_events WHERE event->>'code' IN ('server.fallback.test','server.recovery.test','server.uncaught')`;
  } finally {
    await sql`ALTER TABLE IF EXISTS app_runtime_events_offline_test RENAME TO app_runtime_events`;
    delete process.env.NOVORA_RUNTIME_LOG_DIR;
    await rm(dir, { recursive: true, force: true });
  }
});
