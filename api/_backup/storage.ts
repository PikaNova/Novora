import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { get, put, del } from '@vercel/blob';
import { BackupError, MAX_BACKUP_BYTES, validId } from './format.js';

export function storageMode(): 'local' | 'blob' | 'windows' | 'unconfigured' {
  if (process.env.NOVORA_BACKUP_MODE === 'windows') return 'windows';
  if (process.env.VERCEL === '1') return process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'unconfigured';
  return process.env.BACKUP_STORAGE_DIR ? 'local' : 'unconfigured';
}
function key(namespace: string, id: string): string {
  return `novora-backups/${validId(namespace)}/${validId(id)}.novora-backup`;
}
function localPath(namespace: string, id: string): string {
  return join(resolve(process.env.BACKUP_STORAGE_DIR!), key(namespace, id));
}
export async function saveFile(namespace: string, id: string, text: string): Promise<void> {
  if (Buffer.byteLength(text) > MAX_BACKUP_BYTES) throw new BackupError('备份超过 20 MiB', 413);
  const mode = storageMode();
  if (mode === 'local') {
    const path = localPath(namespace, id);
    await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
    try {
      await writeFile(`${path}.tmp`, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(`${path}.tmp`, path);
    } finally {
      await unlink(`${path}.tmp`).catch(() => undefined);
    }
  } else if (mode === 'blob') {
    await put(key(namespace, id), text, {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'application/octet-stream',
    });
  } else throw new BackupError('请先配置持久备份存储', 409);
  if ((await readStoredFile(namespace, id)) !== text) throw new BackupError('备份写入后校验失败', 502);
}
export async function readStoredFile(namespace: string, id: string): Promise<string> {
  if (storageMode() === 'local') {
    const path = localPath(namespace, id);
    if ((await stat(path)).size > MAX_BACKUP_BYTES) throw new BackupError('备份超过大小限制', 413);
    const data = await readFile(path);
    if (data.length > MAX_BACKUP_BYTES) throw new BackupError('备份超过大小限制', 413);
    return data.toString('utf8');
  }
  if (storageMode() !== 'blob') throw new BackupError('备份存储未配置', 409);
  const result = await get(key(namespace, id), { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) throw new BackupError('备份文件不存在', 404);
  const reader = result.stream.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BACKUP_BYTES) throw new BackupError('备份超过大小限制', 413);
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export async function deleteFile(namespace: string, id: string): Promise<void> {
  if (storageMode() === 'local')
    await unlink(localPath(namespace, id)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  else if (storageMode() === 'blob') await del(key(namespace, id));
  else throw new BackupError('备份存储未配置', 409);
}
