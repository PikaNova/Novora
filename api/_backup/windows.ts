import { createHash } from 'node:crypto';
import { readdir, lstat, open, realpath } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { BackupError, CHUNK_BYTES } from './format.js';

// Read-only bridge: the existing Windows control center owns scheduling and restore.
function directory() {
  if (process.env.NOVORA_BACKUP_MODE !== 'windows') throw new BackupError('未启用 Windows 备份模式', 409);
  return resolve(
    process.env.NOVORA_WINDOWS_BACKUP_DIR || join(process.env.ProgramData || 'C:\\ProgramData', 'Novora', 'backups'),
  );
}
const allowed = /^novora-[a-zA-Z0-9_-]+\.dump$/;
function identifier(name: string, size: number, modified: number) {
  return createHash('sha256')
    .update(JSON.stringify([name, size, modified]))
    .digest('hex');
}
async function entries() {
  const root = directory();
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files = await Promise.all(
    names
      .filter((name) => allowed.test(name))
      .map(async (name) => {
        const info = await lstat(join(root, name)).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (!info) return null;
        if (!info.isFile() || info.isSymbolicLink()) return null;
        return { name, id: identifier(name, info.size, info.mtimeMs), size: info.size, at: info.mtimeMs };
      }),
  );
  return files
    .filter((file): file is NonNullable<typeof file> => file !== null)
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}
export async function windowsBackupStatus(offset: number) {
  const files = await entries();
  return {
    mode: 'windows',
    enabled: false,
    schedulerReady: false,
    retention: 0,
    busy: false,
    maxBytes: 0,
    hasMore: files.length > offset + 50,
    runs: files.slice(offset, offset + 50).map((file) => ({
      id: file.id,
      kind: 'windows',
      status: 'success',
      created_at: file.at,
      size_bytes: file.size,
      checksum: '',
      error: '',
      filename: file.name,
    })),
  };
}
export async function readWindowsPart(id: string, part: number) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new BackupError('无效的备份编号');
  const file = (await entries()).find((file) => file.id === id);
  if (!file) throw new BackupError('备份不存在', 404);
  const root = await realpath(directory());
  const path = await realpath(join(root, file.name));
  if (dirname(path) !== root) throw new BackupError('备份路径无效', 403);
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || identifier(file.name, info.size, info.mtimeMs) !== id)
      throw new BackupError('备份文件已变化，请刷新列表后重新下载', 409);
    const total = Math.max(1, Math.ceil(info.size / CHUNK_BYTES));
    if (!Number.isInteger(part) || part < 0 || part >= total) throw new BackupError('无效的下载分块');
    const bytes = Buffer.alloc(Math.min(CHUNK_BYTES, info.size - part * CHUNK_BYTES));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, part * CHUNK_BYTES);
    if (bytesRead !== bytes.length) throw new BackupError('备份文件已变化，请重新下载', 409);
    return { ok: true, id, part, total, content: bytes.toString('base64'), filename: file.name };
  } finally {
    await handle.close();
  }
}
