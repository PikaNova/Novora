#!/usr/bin/env node
/**
 * 全库备份（PostgreSQL custom 格式）。
 * - Docker 模式：docker compose exec -T db pg_dump（与库同版本的客户端）
 * - 裸机模式：本机 pg_dump（PATH 或 PG_DUMP_PATH）
 * 输出走文件描述符而不是 shell 重定向，避免 Windows 下 > 产生的 UTF-16LE 损坏二进制。
 * 直接执行跑主流程；被 require 时只导出函数（供 update-local.cjs 复用）。
 */
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_KEEP = 10;

function backupDir(repo = process.cwd()) {
  return path.join(repo, 'data', 'backups');
}

function pad(value) {
  return String(value).padStart(2, '0');
}

/** 文件名带时间戳，按名称排序即按时间排序。 */
function timestampName(date = new Date()) {
  return `novora-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.dump`;
}

/** 只保留最近 keep 份，返回需要删除的文件名（输入为已按时间倒序排列的列表）。 */
function selectExpiredBackups(files, keep = DEFAULT_KEEP) {
  const limit = Number.isFinite(keep) && keep > 0 ? Math.floor(keep) : DEFAULT_KEEP;
  return files.slice(limit);
}

function looksLikePgDump(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 5).toString('latin1') === 'PGDMP';
}

function parseDatabaseUrl(url) {
  const parsed = new URL(url);
  return {
    user: decodeURIComponent(parsed.username || 'postgres'),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '') || 'postgres'),
  };
}

function hasDockerCompose(repo = process.cwd()) {
  if (!fs.existsSync(path.join(repo, 'docker-compose.yml'))) return false;
  return spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;
}

function sha256File(file) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

/** 备份主流程；失败抛出带原因的 Error，调用方据此终止升级。 */
function runBackup(options = {}) {
  const repo = options.repo ?? process.cwd();
  const url = options.databaseUrl ?? process.env.DATABASE_URL ?? '';
  if (!url && !hasDockerCompose(repo)) throw new Error('缺少 DATABASE_URL，无法确定要备份的数据库');
  const dir = options.dir ?? backupDir(repo);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, timestampName());
  const fd = fs.openSync(file, 'w');
  const startedAt = Date.now();
  let result;
  try {
    if (hasDockerCompose(repo)) {
      const { user, database } = parseDatabaseUrl(url);
      result = spawnSync('docker', ['compose', 'exec', '-T', 'db', 'pg_dump', '-Fc', '-U', user, '-d', database], {
        cwd: repo,
        stdio: ['ignore', fd, 'pipe'],
        encoding: 'utf8',
      });
    } else {
      const pgDump = process.env.PG_DUMP_PATH || 'pg_dump';
      result = spawnSync(pgDump, ['-Fc', '--dbname', url], { stdio: ['ignore', fd, 'pipe'], encoding: 'utf8' });
      if (result.error && result.error.code === 'ENOENT')
        throw new Error(`未找到 ${pgDump}。请安装 PostgreSQL 客户端，或用 PG_DUMP_PATH 指定可执行文件路径。`);
    }
  } finally {
    fs.closeSync(fd);
  }
  if (result.status !== 0) {
    fs.rmSync(file, { force: true });
    throw new Error(
      `pg_dump 失败（退出码 ${result.status ?? 'unknown'}）：${(result.stderr || '').trim().slice(0, 500)}`,
    );
  }
  const size = fs.statSync(file).size;
  const head = fs.readFileSync(file, { encoding: null, flag: 'r' }).subarray(0, 5);
  if (!looksLikePgDump(head)) {
    fs.rmSync(file, { force: true });
    throw new Error('备份文件头部不是 PGDMP，疑似写入被破坏，已删除该文件');
  }
  const sha256 = sha256File(file);
  const durationMs = Date.now() - startedAt;
  fs.writeFileSync(
    `${file}.json`,
    `${JSON.stringify({ file: path.basename(file), size, sha256, durationMs, createdAt: Date.now() }, null, 2)}\n`,
  );
  const dumps = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.dump'))
    .sort()
    .reverse();
  const removed = selectExpiredBackups(dumps, options.keep ?? DEFAULT_KEEP);
  for (const name of removed) {
    fs.rmSync(path.join(dir, name), { force: true });
    fs.rmSync(path.join(dir, `${name}.json`), { force: true });
  }
  return { file, size, sha256, durationMs, removed };
}

module.exports = {
  DEFAULT_KEEP,
  backupDir,
  hasDockerCompose,
  looksLikePgDump,
  parseDatabaseUrl,
  runBackup,
  selectExpiredBackups,
  timestampName,
};

if (require.main === module) {
  try {
    const result = runBackup();
    console.log(`备份完成：${result.file}`);
    console.log(`大小：${(result.size / 1024 / 1024).toFixed(2)} MB，耗时 ${result.durationMs} ms`);
    console.log(`sha256：${result.sha256}`);
    if (result.removed.length) console.log(`已按保留策略清理：${result.removed.join('、')}`);
  } catch (error) {
    console.error(`备份失败：${error.message}`);
    process.exit(1);
  }
}
