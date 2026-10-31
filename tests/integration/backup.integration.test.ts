import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateUser, authSql, getActor } from '../../api/_auth.js';
import { pack, unpack } from '../../api/_backup/format.js';
import {
  applyRestore,
  backupStatus,
  configureBackup,
  createBackup,
  ensureBackupTables,
  previewBackup,
  readBackup,
  removeBackup,
  restoreBackup,
  runAutomaticBackup,
  uploadPart,
} from '../../api/_backup/service.js';
import handler from '../../api/backups.js';

async function call(
  token: string,
  method = 'GET',
  body: Record<string, unknown> = {},
  query: Record<string, string> = {},
) {
  let status = 200;
  let result: Record<string, unknown> = {};
  const headers: Record<string, unknown> = {};
  const res = {
    setHeader(name: string, value: unknown) {
      headers[name] = value;
      return res;
    },
    status(value: number) {
      status = value;
      return res;
    },
    json(value: Record<string, unknown>) {
      result = value;
      return res;
    },
    end() {
      return res;
    },
  } as unknown as VercelResponse;
  await handler(
    { method, body, query, headers: token ? { authorization: `Bearer ${token}` } : {} } as VercelRequest,
    res,
  );
  return { status, body: result, headers };
}

test('backup integration: persisted downloads, scheduling, guards and transactional restore', async (t) => {
  assert.ok(process.env.DATABASE_URL, 'requires the disposable integration database');
  const originalEnv = { ...process.env };
  const folder = await mkdtemp(join(tmpdir(), 'novora-backup-integration-'));
  delete process.env.VERCEL;
  delete process.env.NOVORA_BACKUP_MODE;
  process.env.BACKUP_STORAGE_DIR = folder;
  process.env.BACKUP_WORKER_ENABLED = '1';
  const sql = authSql();
  try {
    await ensureBackupTables();
    await sql`UPDATE app_backup_settings SET lease_until=0,restore_until=0,enabled=FALSE WHERE id=1`;
    await sql`TRUNCATE app_backup_runs,app_backup_uploads,app_audit_logs,app_user_scopes,app_users,app_auth,exam_announcement_images,exam_records RESTART IDENTITY CASCADE`;
    const login = await authenticateUser('admin', process.env.ADMIN_PASSWORD ?? '');
    assert.ok(login, 'disposable database must bootstrap the test administrator');
    await sql`UPDATE exam_data SET title='备份学校',revisions='{"school":1}'::jsonb WHERE id=1`;
    const image = Buffer.from([0, 255, 128, 10, 13, 0, 42]);
    await sql`INSERT INTO exam_announcement_images(filename,mime_type,data,size_bytes,created_at) VALUES('中文.png','image/png',${image},${image.length},${Date.now()})`;
    let manual = '';
    let text = '';

    await t.test('manual backup and API download preserve exact UTF-8 bytes and bytea images', async () => {
      manual = await createBackup();
      text = await readBackup(manual);
      const file = unpack(text);
      assert.equal(file.data.exam_data[0].title, '备份学校');
      assert.equal(file.data.exam_announcement_images[0].data, `\\x${image.toString('hex')}`);
      const response = await call(login.token, 'GET', {}, { file: manual, part: '0' });
      assert.equal(response.status, 200);
      assert.equal(response.headers['Cache-Control'], 'private, no-store');
      assert.equal(Buffer.from(String(response.body.content), 'base64').toString('utf8'), text);
      assert.match(String(response.body.filename), /\.novora-backup$/);
      assert.equal((await call(login.token, 'GET', {}, { file: manual, part: '999' })).status, 400);
      assert.equal((await call('')).status, 401);
      await sql`UPDATE app_users SET must_change_password=TRUE WHERE id=${login.actor.id}`;
      assert.equal((await call(login.token)).status, 403);
      await sql`UPDATE app_users SET must_change_password=FALSE WHERE id=${login.actor.id}`;
    });

    await t.test('automatic backups default off, deduplicate the day and retain only automatic successes', async () => {
      assert.deepEqual(await runAutomaticBackup(), { skipped: true });
      await configureBackup(true, 1);
      const first = await runAutomaticBackup();
      assert.ok('id' in first && typeof first.id === 'string');
      assert.deepEqual(await runAutomaticBackup(), first);
      await sql`UPDATE app_backup_runs SET day='2000-01-01',created_at=1 WHERE id=${first.id}`;
      const next = await runAutomaticBackup();
      assert.ok('id' in next && typeof next.id === 'string' && next.id !== first.id);
      await assert.rejects(readBackup(first.id), /不存在/);
      assert.equal(await readBackup(manual), text, 'manual backups are not pruned');
      const downloaded = await call(login.token, 'GET', {}, { file: next.id });
      assert.equal(downloaded.status, 200);
      assert.equal(
        unpack(Buffer.from(String(downloaded.body.content), 'base64').toString('utf8')).format,
        'novora-backup',
      );
      assert.equal((await backupStatus()).runs.filter((r) => r.kind === 'automatic').length, 1);
    });

    await t.test('uploads join binary chunks before decoding split Chinese characters', async () => {
      const uploadId = randomUUID();
      const bytes = Buffer.from(text);
      const boundary = bytes.indexOf(Buffer.from('备份学校')) + 1;
      for (const [part, content] of [bytes.subarray(0, boundary), bytes.subarray(boundary)].entries())
        await uploadPart(login.actor.id, { id: uploadId, part, total: 2, content: content.toString('base64') });
      const preview = await previewBackup(login.actor.id, { uploadId });
      assert.equal(preview.text, text);
      await assert.rejects(previewBackup(login.actor.id + 1, { uploadId }), /上传/);
      const incompatible = unpack(text);
      const badId = randomUUID();
      const incompatibleText = pack(incompatible.data, 'a'.repeat(64));
      await uploadPart(login.actor.id, {
        id: badId,
        part: 0,
        total: 1,
        content: Buffer.from(incompatibleText).toString('base64'),
      });
      await assert.rejects(previewBackup(login.actor.id, { uploadId: badId }), /不兼容/);
    });

    await t.test('active restore lease blocks writes and a wrong owner cannot restore', async () => {
      const owner = randomUUID();
      await sql`UPDATE app_backup_settings SET lease_owner=${owner},lease_until=${Date.now() + 60_000},restore_until=${Date.now() + 60_000} WHERE id=1`;
      try {
        await assert.rejects(sql`UPDATE exam_data SET title='must not write' WHERE id=1`, /NOVORA_RESTORE_IN_PROGRESS/);
        await assert.rejects(createBackup(), /已有/);
        await assert.rejects(applyRestore(unpack(text), randomUUID()));
        assert.equal((await sql`SELECT title FROM exam_data WHERE id=1`)[0].title, '备份学校');
      } finally {
        await sql`UPDATE app_backup_settings SET lease_until=0,restore_until=0 WHERE id=1`;
      }
    });

    await t.test(
      'constraint failure rolls back data and session secrets, preserving downloadable protection backup',
      async () => {
        await sql`UPDATE exam_data SET title='恢复前数据' WHERE id=1`;
        const secrets = (await sql`SELECT token_secret,session_secret,token_version FROM app_auth WHERE id=1`)[0];
        const invalid = unpack(text);
        invalid.data.app_users[0].display_name = null;
        const invalidText = pack(invalid.data, invalid.schema);
        const id = randomUUID();
        await uploadPart(login.actor.id, {
          id,
          part: 0,
          total: 1,
          content: Buffer.from(invalidText).toString('base64'),
        });
        await assert.rejects(
          restoreBackup(login.actor, {
            uploadId: id,
            checksum: unpack(invalidText).checksum,
            fileSha256: createHash('sha256').update(invalidText, 'utf8').digest('hex'),
          }),
          /事务已回滚/,
        );
        assert.equal((await sql`SELECT title FROM exam_data WHERE id=1`)[0].title, '恢复前数据');
        assert.deepEqual(
          (await sql`SELECT token_secret,session_secret,token_version FROM app_auth WHERE id=1`)[0],
          secrets,
        );
        assert.ok(await getActor(login.token));
        const protection = (await backupStatus()).runs.find((r) => r.kind === 'protection');
        assert.ok(protection);
        assert.equal((await call(login.token, 'GET', {}, { file: String(protection.id) })).status, 200);
        await sql`UPDATE app_backup_settings SET restore_until=0 WHERE id=1`;
      },
    );

    await t.test(
      'successful restore replaces data, keeps encryption secret, invalidates sessions and advances sequences',
      async () => {
        const oldSecret = (await sql`SELECT token_secret FROM app_auth WHERE id=1`)[0].token_secret;
        await sql`UPDATE exam_announcement_images SET data=${Buffer.from('changed')}`;
        await sql`SELECT setval('app_users_id_seq',1000,true)`;
        const preview = await previewBackup(login.actor.id, { id: manual });
        const response = await call(login.token, 'POST', {
          action: 'restore',
          id: manual,
          checksum: preview.file.checksum,
          fileSha256: preview.preview.fileSha256,
          password: process.env.ADMIN_PASSWORD,
          confirm: 'RESTORE',
        });
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal((await sql`SELECT title FROM exam_data WHERE id=1`)[0].title, '备份学校');
        assert.deepEqual((await sql`SELECT data FROM exam_announcement_images`)[0].data, image);
        assert.equal((await sql`SELECT token_secret FROM app_auth WHERE id=1`)[0].token_secret, oldSecret);
        assert.equal(await getActor(login.token), null);
        assert.equal((await call(login.token)).status, 401);
        await sql`UPDATE app_backup_settings SET restore_until=0 WHERE id=1`;
        const fresh = await authenticateUser('admin', process.env.ADMIN_PASSWORD ?? '');
        assert.ok(fresh);
        assert.notEqual(fresh.actor.restoreGeneration, login.actor.restoreGeneration);
        assert.ok(await getActor(fresh.token));
        assert.equal((await call(fresh.token, 'GET', {}, { file: String(response.body.protectionId) })).status, 200);
        assert.equal(
          unpack(await readBackup(String(response.body.protectionId))).data.exam_data[0].title,
          '恢复前数据',
        );
        assert.ok(Number((await sql`SELECT nextval('app_users_id_seq') AS id`)[0].id) > 1000);
        assert.ok(
          Number((await sql`SELECT updated_at FROM exam_data WHERE id=1`)[0].updated_at) >
            Number(preview.file.data.exam_data[0].updated_at),
        );
      },
    );

    await t.test('storage failure is visible and deleting a successful backup removes its download', async () => {
      const blocker = join(folder, 'not-a-directory');
      await writeFile(blocker, 'block');
      process.env.BACKUP_STORAGE_DIR = blocker;
      await assert.rejects(createBackup());
      process.env.BACKUP_STORAGE_DIR = folder;
      assert.ok((await backupStatus()).runs.some((r) => r.status === 'failed'));
      await removeBackup(manual);
      await assert.rejects(readBackup(manual), /不存在/);
    });
  } finally {
    await sql`UPDATE app_backup_settings SET lease_until=0,restore_until=0,enabled=FALSE WHERE id=1`.catch(
      () => undefined,
    );
    await rm(folder, { recursive: true, force: true });
    for (const key of ['BACKUP_STORAGE_DIR', 'BACKUP_WORKER_ENABLED', 'VERCEL', 'NOVORA_BACKUP_MODE']) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});
