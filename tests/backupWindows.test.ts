import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { windowsBackupStatus, readWindowsPart } from '../api/_backup/windows.js';
import { CHUNK_BYTES } from '../api/_backup/format.js';

test('Windows manual, automatic and protection dumps all have byte-exact downloads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'novora-dump-test-'));
  const oldMode = process.env.NOVORA_BACKUP_MODE;
  const oldDir = process.env.NOVORA_WINDOWS_BACKUP_DIR;
  process.env.NOVORA_BACKUP_MODE = 'windows';
  process.env.NOVORA_WINDOWS_BACKUP_DIR = directory;
  try {
    const content = randomBytes(CHUNK_BYTES * 2 + 123);
    const names = [
      'novora-manual-1.dump',
      'novora-daily-2.dump',
      'novora-before-restore-3.dump',
      'novora-before-update-4.dump',
    ];
    for (const name of names) await writeFile(join(directory, name), content);
    await writeFile(join(directory, 'novora-incomplete.dump.partial'), 'unfinished');
    await writeFile(join(directory, 'unrelated.dump'), 'private');
    await mkdir(join(directory, 'novora-directory.dump'));
    const status = await windowsBackupStatus(0);
    assert.equal(status.runs.length, names.length);
    assert.equal(status.mode, 'windows');
    for (const run of status.runs) {
      const first = await readWindowsPart(run.id, 0);
      const chunks = [Buffer.from(first.content, 'base64')];
      for (let part = 1; part < first.total; part++)
        chunks.push(Buffer.from((await readWindowsPart(run.id, part)).content, 'base64'));
      assert.deepEqual(Buffer.concat(chunks), content);
      assert.equal(first.filename, run.filename);
      await assert.rejects(readWindowsPart(run.id, first.total), /分块/);
    }
    const stale = status.runs[0];
    await writeFile(join(directory, stale.filename), 'changed');
    await assert.rejects(readWindowsPart(stale.id, 0), /不存在|变化/);
    await assert.rejects(readWindowsPart('../secret', 0), /编号/);
    await assert.rejects(readWindowsPart('a'.repeat(64), 0), /不存在/);
    process.env.NOVORA_BACKUP_MODE = '';
    await assert.rejects(windowsBackupStatus(0), /未启用/);
  } finally {
    if (oldMode === undefined) delete process.env.NOVORA_BACKUP_MODE;
    else process.env.NOVORA_BACKUP_MODE = oldMode;
    if (oldDir === undefined) delete process.env.NOVORA_WINDOWS_BACKUP_DIR;
    else process.env.NOVORA_WINDOWS_BACKUP_DIR = oldDir;
    await rm(directory, { recursive: true, force: true });
  }
});
