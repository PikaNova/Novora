import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';
import { applyCors } from './_cors.js';
import { checkLoginLockout, getActor, type AdminActor, writeAudit } from './_auth.js';
import { authSql } from './_auth/db.js';
import { matches } from './_auth/passwords.js';
import { storageMode } from './_backup/storage.js';
import { readWindowsPart } from './_backup/windows.js';
import { BackupError, CHUNK_BYTES, validId } from './_backup/format.js';
import {
  backupStatus,
  configureBackup,
  createBackup,
  previewBackup,
  readBackup,
  removeBackup,
  restoreBackup,
  runAutomaticBackup,
  uploadPart,
} from './_backup/service.js';

function authorizedSuperAdmin(actor: AdminActor | null): actor is AdminActor {
  return (
    !!actor &&
    !actor.mustChangePassword &&
    actor.roleId === 'super_admin' &&
    actor.permissions.includes('*') &&
    actor.scopes.some((scope) => scope.type === 'all')
  );
}
function cronAuthorized(req: VercelRequest) {
  const expected = process.env.CRON_SECRET ?? '';
  const provided = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  return (
    expected.length >= 16 &&
    Buffer.byteLength(provided) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  );
}
function input(req: VercelRequest): Record<string, unknown> {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? (req.body as Record<string, unknown>)
    : {};
}
function idFrom(req: VercelRequest, key: string): string {
  const value = req.query[key];
  return validId(Array.isArray(value) ? value[0] : value);
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!applyCors(req, res, { methods: ['GET', 'POST', 'DELETE'] })) return;
  try {
    const isWorker = cronAuthorized(req);
    if (isWorker) {
      if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
      return res.status(200).json({ ok: true, ...(await runAutomaticBackup()) });
    }
    const actor = await getActor(String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
    if (!authorizedSuperAdmin(actor))
      return res.status(actor ? 403 : 401).json({ ok: false, error: '需要超级管理员权限' });
    if (req.method === 'GET' && req.query.file !== undefined) {
      if (storageMode() === 'windows')
        return res.status(200).json(await readWindowsPart(String(req.query.file), Number(req.query.part ?? 0)));
      const id = idFrom(req, 'file');
      const text = await readBackup(id);
      const part = Number(Array.isArray(req.query.part) ? req.query.part[0] : (req.query.part ?? 0));
      const bytes = Buffer.from(text, 'utf8');
      const count = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
      if (!Number.isInteger(part) || part < 0 || part >= count) throw new BackupError('无效的下载分块');
      return res.status(200).json({
        ok: true,
        id,
        part,
        total: count,
        content: bytes.subarray(part * CHUNK_BYTES, (part + 1) * CHUNK_BYTES).toString('base64'),
        filename: `novora-backup-${id}.novora-backup`,
      });
    }
    if (req.method === 'GET')
      return res.status(200).json({ ok: true, ...(await backupStatus(Number(req.query.offset ?? 0))) });
    if (storageMode() === 'windows') throw new BackupError('Windows 备份创建、自动任务和恢复请使用客户端控制中心', 409);
    const body = input(req);
    if (req.method === 'POST' && body.action === 'create') {
      const id = await createBackup();
      return res.status(201).json({ ok: true, id });
    }
    if (req.method === 'POST' && body.action === 'configure') {
      await configureBackup(body.enabled, body.retention);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'POST' && body.action === 'upload') {
      await uploadPart(actor.id, body);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'POST' && body.action === 'preview') {
      const result = await previewBackup(actor.id, {
        uploadId: typeof body.uploadId === 'string' ? body.uploadId : undefined,
        id: typeof body.id === 'string' ? body.id : undefined,
      });
      return res.status(200).json({ ok: true, ...result.preview });
    }
    if (req.method === 'POST' && body.action === 'restore') {
      const lockout = await checkLoginLockout(actor.username);
      if (lockout.locked) throw new BackupError('密码尝试次数过多，请稍后重试', 429);
      if (body.confirm !== 'RESTORE' || typeof body.password !== 'string' || body.password.length > 1024)
        throw new BackupError('请输入当前密码并输入 RESTORE 确认恢复');
      const rows =
        await authSql()`SELECT password_hash,password_salt FROM app_users WHERE id=${actor.id} AND status='active'`;
      if (!rows[0] || !(await matches(body.password, String(rows[0].password_hash), String(rows[0].password_salt)))) {
        await writeAudit(actor, 'auth.login.failed', 'user', String(actor.id));
        throw new BackupError('当前密码不正确', 403);
      }
      await writeAudit(actor, 'auth.login', 'user', String(actor.id));
      const result = await restoreBackup(actor, {
        uploadId: typeof body.uploadId === 'string' ? body.uploadId : undefined,
        id: typeof body.id === 'string' ? body.id : undefined,
        checksum: typeof body.checksum === 'string' ? body.checksum : undefined,
      });
      return res.status(200).json({ ok: true, protectionId: result.protectionId });
    }
    if (req.method === 'DELETE') {
      await removeBackup(idFrom(req, 'id'));
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ ok: false, error: '不支持的请求方式' });
  } catch (error) {
    const status = error instanceof BackupError ? error.status : 500;
    if (status === 500) console.error('backup operation failed');
    return res.status(status).json({
      ok: false,
      error: error instanceof BackupError ? error.message : '备份操作失败，请检查服务端配置与日志',
    });
  }
}
