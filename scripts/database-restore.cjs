#!/usr/bin/env node
/**
 * 从备份恢复全库。安全约束：
 * 1) 必须显式确认（--yes 且 CONFIRM_RESTORE=restore-novora）；
 * 2) 恢复前自动再做一次备份，失败即中止；
 * 3) 校验 dump 头部与 sha256（同目录 .json 元数据）；
 * 4) pg_restore --clean --if-exists --no-owner --no-privileges。
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { looksLikePgDump, parseDatabaseUrl, runBackup } = require('./database-backup.cjs');

const CONFIRM_VALUE = 'restore-novora';

function readMetadata(file) {
  try {
    return JSON.parse(fs.readFileSync(`${file}.json`, 'utf8'));
  } catch {
    return null;
  }
}

function verifyDump(file, expectedSha) {
  const buffer = fs.readFileSync(file);
  if (!looksLikePgDump(buffer.subarray(0, 5))) throw new Error('文件不是 PostgreSQL custom 格式（缺少 PGDMP 头）');
  const { createHash } = require('node:crypto');
  const actual = createHash('sha256').update(buffer).digest('hex');
  if (expectedSha && actual !== expectedSha) throw new Error(`sha256 校验不一致：期望 ${expectedSha}，实际 ${actual}`);
  return actual;
}

function runRestore(options = {}) {
  const repo = options.repo ?? process.cwd();
  const url = options.databaseUrl ?? process.env.DATABASE_URL ?? '';
  const file = options.file;
  if (!file || !fs.existsSync(file)) throw new Error('请用 --file 指定存在的备份文件');
  if (!url) throw new Error('缺少 DATABASE_URL，无法确定要恢复的数据库');
  if (!options.confirmed || process.env.CONFIRM_RESTORE !== CONFIRM_VALUE)
    throw new Error(
      `恢复会覆盖现有数据。请确认：CONFIRM_RESTORE=${CONFIRM_VALUE} node scripts/database-restore.cjs --file <备份> --yes`,
    );
  const metadata = readMetadata(file);
  const sha256 = verifyDump(file, options.sha256 ?? metadata?.sha256);
  const snapshot = runBackup({ repo, databaseUrl: url, keep: options.keep });
  const docker = require('./database-backup.cjs').hasDockerCompose(repo);
  const args = ['--clean', '--if-exists', '--no-owner', '--no-privileges'];
  const startedAt = Date.now();
  let result;
  if (docker) {
    const { user, database } = parseDatabaseUrl(url);
    result = spawnSync('docker', ['compose', 'exec', '-T', 'db', 'pg_restore', ...args, '-U', user, '-d', database], {
      cwd: repo,
      input: fs.readFileSync(file),
      stdio: ['pipe', 'inherit', 'pipe'],
      encoding: 'utf8',
    });
  } else {
    const bin = process.env.PG_RESTORE_PATH || 'pg_restore';
    result = spawnSync(bin, [...args, '--dbname', url, file], {
      stdio: ['ignore', 'inherit', 'pipe'],
      encoding: 'utf8',
    });
    if (result.error && result.error.code === 'ENOENT')
      throw new Error(`未找到 ${bin}。请安装 PostgreSQL 客户端，或用 PG_RESTORE_PATH 指定路径。`);
  }
  if (result.status !== 0)
    throw new Error(
      `pg_restore 失败（退出码 ${result.status ?? 'unknown'}）：${(result.stderr || '').trim().slice(0, 500)}`,
    );
  return { file, sha256, snapshot: snapshot.file, durationMs: Date.now() - startedAt };
}

module.exports = { CONFIRM_VALUE, readMetadata, runRestore, verifyDump };

if (require.main === module) {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  const file = fileIndex >= 0 ? path.resolve(args[fileIndex + 1] ?? '') : '';
  try {
    const result = runRestore({ file, confirmed: args.includes('--yes') });
    console.log(`恢复完成：${result.file}（sha256 ${result.sha256}）`);
    console.log(`恢复前快照：${result.snapshot}`);
    console.log(`耗时 ${result.durationMs} ms；数据库结构由下一次启动迁移自动补齐`);
  } catch (error) {
    console.error(`恢复失败（未做任何不可逆操作前会保留恢复前快照）：${error.message}`);
    process.exit(1);
  }
}
