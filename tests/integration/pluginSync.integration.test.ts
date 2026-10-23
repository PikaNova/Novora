import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { database, ensureTableOnce } from '../../api/_exams/db.js';
import { sha256 } from '../../api/_exams/plugin.js';
import { handlePluginPairStatusOrBootstrap } from '../../api/_exams/routes/pluginRoutes.js';

test('ClassIsland conditional sync: unchanged, modified, rebound, revoked and legacy clients', async () => {
  assert.ok(process.env.INTEGRATION_DATABASE_URL, 'run only against an explicitly isolated integration database');
  assert.equal(process.env.DATABASE_URL, process.env.INTEGRATION_DATABASE_URL);
  await ensureTableOnce();
  const sql = database();
  const now = Date.now();
  const secret = 'a'.repeat(64);
  const pluginId = 'classisland-sync-integration';
  const viewerId = 'classisland-viewer-integration';
  await sql`INSERT INTO device_instances(instance_id, grade_id, class_id, last_seen_at, updated_at)
    VALUES (${viewerId}, 'g1', 'c1', ${now}, ${now})`;
  await sql`INSERT INTO classisland_plugin_instances(plugin_instance_id, client_secret_hash, viewer_instance_id, paired, grade_id, class_id, created_at, updated_at)
    VALUES (${pluginId}, ${sha256(secret)}, ${viewerId}, TRUE, 'g1', 'c1', ${now}, 123)`;
  await sql`UPDATE exam_data SET grades='[{"id":"g1","name":"Grade 1"}]'::jsonb,
    classes='[{"id":"c1","name":"Class 1"},{"id":"c2","name":"Class 2"}]'::jsonb, updated_at=${now} WHERE id=1`;

  async function request(knownVersion?: string, clientSecret = secret) {
    const result: { code: number; body: Record<string, unknown> } = { code: 200, body: {} };
    const response = {
      setHeader() {
        return this;
      },
      status(code: number) {
        result.code = code;
        return this;
      },
      json(body: Record<string, unknown>) {
        result.body = body;
        return this;
      },
    } as unknown as VercelResponse;
    await handlePluginPairStatusOrBootstrap(
      {
        method: 'POST',
        body: { pluginInstanceId: pluginId, clientSecret, knownVersion, includeCompletedToday: true },
      } as VercelRequest,
      response,
      'plugin-bootstrap',
    );
    return result;
  }

  const initial = await request();
  assert.equal(initial.code, 200);
  assert.equal(initial.body.changed, true);
  assert.ok(Array.isArray(initial.body.exams));
  const version = String(initial.body.version);
  const [before] =
    await sql`SELECT xmin::text AS revision, updated_at FROM classisland_plugin_instances WHERE plugin_instance_id=${pluginId}`;
  const unchanged = await request(version);
  assert.equal(unchanged.body.changed, false);
  assert.equal(unchanged.body.version, version);
  assert.equal(unchanged.body.viewerOnline, true);
  assert.equal('exams' in unchanged.body, false);
  const [after] =
    await sql`SELECT xmin::text AS revision, updated_at FROM classisland_plugin_instances WHERE plugin_instance_id=${pluginId}`;
  assert.equal(after.revision, before.revision, 'unchanged sync must not write the plugin row');
  assert.equal(Number(after.updated_at), 123);

  await sql`UPDATE exam_data SET updated_at=${now + 1} WHERE id=1`;
  const changed = await request(version);
  assert.equal(changed.body.changed, true);
  assert.notEqual(changed.body.version, version);
  await sql`UPDATE device_instances SET class_id='c2' WHERE instance_id=${viewerId}`;
  const rebound = await request(String(changed.body.version));
  assert.equal(rebound.body.changed, true);
  assert.equal((rebound.body.binding as Record<string, unknown>).classId, 'c2');
  assert.equal((await request(undefined)).body.changed, true, 'legacy request still receives a complete response');
  assert.equal((await request(undefined, 'b'.repeat(64))).code, 401);
  await sql`UPDATE device_instances SET revoked=TRUE WHERE instance_id=${viewerId}`;
  assert.equal(
    (await request(String(rebound.body.version))).code,
    409,
    'revocation is validated before any unchanged reply',
  );
  await sql`DELETE FROM classisland_plugin_instances WHERE plugin_instance_id=${pluginId}`;
  await sql`DELETE FROM device_instances WHERE instance_id=${viewerId}`;
});
