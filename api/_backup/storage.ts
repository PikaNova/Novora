import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { BackupError, DEFAULT_LINUX_BACKUP_BYTES, MAX_BACKUP_BYTES, validId } from './format.js';

export type BackupMode = 'local' | 'vercel' | 'windows' | 'unconfigured';
export function storageMode(): BackupMode {
  if (process.env.NOVORA_BACKUP_MODE === 'windows') return 'windows';
  if (process.env.VERCEL === '1') return 'vercel';
  return process.env.BACKUP_STORAGE_DIR ? 'local' : 'unconfigured';
}
export function backupPlatform(): 'vercel' | 'linux' | 'windows' {
  const mode = storageMode();
  if (mode === 'windows') return 'windows';
  return mode === 'vercel' ? 'vercel' : 'linux';
}
export function maxBackupBytes(): number {
  if (storageMode() === 'vercel' || storageMode() === 'unconfigured' || storageMode() === 'windows')
    return MAX_BACKUP_BYTES;
  const configured = Number(process.env.BACKUP_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured >= MAX_BACKUP_BYTES && configured <= 2 * 1024 * 1024 * 1024
    ? configured
    : DEFAULT_LINUX_BACKUP_BYTES;
}
function key(namespace: string, id: string): string {
  return `novora-backups/${validId(namespace)}/${validId(id)}.novora-backup`;
}
function localPath(namespace: string, id: string): string {
  return join(resolve(process.env.BACKUP_STORAGE_DIR!), key(namespace, id));
}
export async function saveFile(namespace: string, id: string, text: string): Promise<void> {
  if (Buffer.byteLength(text) > maxBackupBytes()) throw new BackupError('备份超过当前部署的文件上限', 413);
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
  } else throw new BackupError('请先配置持久备份存储', 409);
  if ((await readStoredFile(namespace, id)) !== text) throw new BackupError('备份写入后校验失败', 502);
}
export async function readStoredFile(namespace: string, id: string): Promise<string> {
  const limit = maxBackupBytes();
  if (storageMode() === 'local') {
    const path = localPath(namespace, id);
    if ((await stat(path)).size > limit) throw new BackupError('备份超过当前部署的文件上限', 413);
    const data = await readFile(path);
    if (data.length > limit) throw new BackupError('备份超过当前部署的文件上限', 413);
    return data.toString('utf8');
  }
  throw new BackupError('Vercel 不保存备份文件，需使用当次下载会话', 409);
}
export async function deleteFile(namespace: string, id: string): Promise<void> {
  if (storageMode() === 'local')
    await unlink(localPath(namespace, id)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  else throw new BackupError('备份存储未配置', 409);
}
