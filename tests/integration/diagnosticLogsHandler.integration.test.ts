import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BUILTIN_ROLES, authenticateUser, authSql, ensureAuthTables } from '../../api/_auth.js';
import { database, ensureTableOnce } from '../../api/_exams/db.js';
import diagnosticLogsHandler from '../../api/diagnostic-logs.js';

const adminPassword = process.env.ADMIN_PASSWORD ?? '';
const PREFIX = 'itest_handler_';

function makeRes() {
  const calls: { statusCode?: number; body: Record<string, unknown>; headers: Record<string, unknown> } = {
    body: {},
    headers: {},
  };
  const res: VercelResponse = {
    setHeader(name: string, value: unknown) {
      calls.headers[name] = value;
      return res;
    },
    getHeader(name: string) {
      return calls.headers[name];
    },
    status(code: number) {
      calls.statusCode = code;
      return res;
    },
    json(body: unknown) {
      calls.statusCode ??= 200;
      calls.body = body as Record<string, unknown>;
      return res;
    },
    send(body: unknown) {
      calls.statusCode ??= 200;
      calls.body = body as Record<string, unknown>;
      return res;
    },
    end() {
      calls.statusCode ??= 200;
      return res;
    },
  } as unknown as VercelResponse;
  return { res, calls };
}

function makeReq(method: string, body: Record<string, unknown>, headers: Record<string, string>): VercelRequest {
  return { method, headers, query: {}, cookies: {}, body } as unknown as VercelRequest;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

/** 作者端在集成环境不可达，这里按真实调用顺序桩掉换 token、拉配置和收包三个端点。 */
async function withAuthorStub(run: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/issue-client-token'))
      return jsonResponse({ ok: true, token: 'author-token', expiresAt: Date.now() + 600_000 });
    if (url.includes('/api/public-announcements'))
      return jsonResponse({ ok: true, config: { errorReportEnabled: true } });
    if (url.includes('/api/diagnostic-log-bundles')) return new Response(null, { status: 202 });
    return jsonResponse({ ok: false }, 404);
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function cleanup(): Promise<void> {
  await database()`DELETE FROM app_diagnostic_bundles WHERE bundle_id LIKE ${`${PREFIX}%`}`;
  await database()`UPDATE app_diagnostic_settings SET retention_days=7 WHERE id=1`;
}

/**
 * 复用一次性数据库，但可能残留前一次运行建的管理员（密码已随 ADMIN_PASSWORD 变化）。
 * 这里像 examData 集成用例一样先清空身份数据，再让 bootstrap 用当前口令重建超管。
 */
async function bootstrapAdmin(): Promise<string> {
  await ensureTableOnce();
  await ensureAuthTables();
  const sql = authSql();
  await sql`TRUNCATE TABLE app_audit_logs, app_user_scopes, app_users, app_roles RESTART IDENTITY CASCADE`;
  const now = Date.now();
  for (const role of BUILTIN_ROLES) {
    await sql`
      INSERT INTO app_roles (id, name, description, permissions, built_in, created_at, updated_at)
      VALUES (${role.id}, ${role.name}, ${role.description}, ${JSON.stringify(role.permissions)}::jsonb, TRUE, ${now}, ${now})
      ON CONFLICT (id) DO NOTHING
    `;
  }
  const login = await authenticateUser('admin', adminPassword);
  assert.ok(login, 'the integration runner must bootstrap the disposable super administrator');
  return login.token;
}

test('diagnostic log handler: a stored bundle expires with the saved retention policy, not a fixed 30 days', async () => {
  const token = await bootstrapAdmin();
  await cleanup();
  await database()`UPDATE app_diagnostic_settings SET retention_days=3 WHERE id=1`;

  const bundleId = `${PREFIX}retention`;
  await withAuthorStub(async () => {
    const { res, calls } = makeRes();
    await diagnosticLogsHandler(
      makeReq(
        'POST',
        {
          bundleId,
          mode: 'date',
          instanceId: 'instance-itest',
          fromTs: 1,
          toTs: 2,
          entries: [{ at: 1, level: 'info', message: 'handler integration' }],
        },
        { authorization: `Bearer ${token}` },
      ),
      res,
    );
    assert.equal(calls.statusCode, 202);
    assert.equal(calls.body.status, 'sent');
  });

  const rows = (await database()`SELECT created_at, expires_at, status, entry_count FROM app_diagnostic_bundles
    WHERE bundle_id=${bundleId}`) as unknown as Array<{
    created_at: number | string;
    expires_at: number | string;
    status: string;
    entry_count: number;
  }>;
  const row = rows[0];
  assert.ok(row, 'the handler must store the bundle');
  assert.equal(row.status, 'sent');
  assert.equal(row.entry_count, 1);
  assert.equal(
    Number(row.expires_at) - Number(row.created_at),
    3 * 86_400_000,
    'expiry must follow retention_days from the settings row',
  );

  await cleanup();
});
