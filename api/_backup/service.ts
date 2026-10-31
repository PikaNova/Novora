import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { authSql, ensureAuthTables, writeAudit, type AdminActor } from '../_auth.js';
import { invalidateAuthConfigCache } from '../_auth/db.js';
import { ensureTableOnce } from '../_exams/db.js';
import type { SqlTx } from '../_dbAdapter.js';
import {
  BACKUP_TABLES,
  BackupError,
  backupDay,
  CHUNK_BYTES,
  digest,
  pack,
  unpack,
  validId,
  type BackupFile,
  sanitizeData,
} from './format.js';
import { windowsBackupStatus } from './windows.js';
import { storageMode, backupPlatform, maxBackupBytes, saveFile, readStoredFile, deleteFile } from './storage.js';

// SQL text here is constructed exclusively from the fixed table list and database catalog.
function query(sql: SqlTx, text: string, values: unknown[] = []) {
  const parts: string[] = [];
  const args: unknown[] = [];
  let end = 0;
  for (const match of text.matchAll(/\$(\d+)/g)) {
    parts.push(text.slice(end, match.index));
    args.push(values[Number(match[1]) - 1]);
    end = match.index! + match[0].length;
  }
  parts.push(text.slice(end));
  return sql(Object.assign(parts, { raw: [...parts] }) as unknown as TemplateStringsArray, ...args);
}
const GUARDED_TABLES = [...BACKUP_TABLES, 'app_auth', 'device_commands', 'email_verification_codes', 'email_outbox'];
let setup: Promise<void> | undefined;
export function ensureBackupTables(): Promise<void> {
  if (!setup)
    setup = (async () => {
      await ensureAuthTables();
      await ensureTableOnce();
      const sql = authSql();
      await sql.transaction((tx) => [
        tx`SELECT pg_advisory_xact_lock(1649236847)`,
        tx`CREATE TABLE IF NOT EXISTS app_backup_settings (
        id INTEGER PRIMARY KEY CHECK(id=1), namespace TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT FALSE,
        retention INTEGER NOT NULL DEFAULT 14, lease_owner TEXT NOT NULL DEFAULT '', lease_until BIGINT NOT NULL DEFAULT 0,
        restore_until BIGINT NOT NULL DEFAULT 0)`,
        tx`INSERT INTO app_backup_settings(id, namespace) VALUES(1, ${randomUUID()}) ON CONFLICT DO NOTHING`,
        tx`CREATE TABLE IF NOT EXISTS app_backup_runs (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, day TEXT, status TEXT NOT NULL,
        created_at BIGINT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0, checksum TEXT NOT NULL DEFAULT '', file_sha256 TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '')`,
        tx`ALTER TABLE app_backup_runs ADD COLUMN IF NOT EXISTS file_sha256 TEXT NOT NULL DEFAULT ''`,
        tx`CREATE UNIQUE INDEX IF NOT EXISTS app_backup_daily_success ON app_backup_runs(day) WHERE kind='automatic' AND status='success'`,
        tx`CREATE TABLE IF NOT EXISTS app_backup_uploads (
        id TEXT NOT NULL, owner_id BIGINT NOT NULL, part INTEGER NOT NULL, total INTEGER NOT NULL,
        content TEXT NOT NULL, expires_at BIGINT NOT NULL, purpose TEXT NOT NULL DEFAULT 'restore', PRIMARY KEY(id, part))`,
        tx`ALTER TABLE app_backup_uploads ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'restore'`,
        tx`ALTER TABLE app_backup_uploads ADD COLUMN IF NOT EXISTS served_at BIGINT NOT NULL DEFAULT 0`,
        tx`CREATE OR REPLACE FUNCTION novora_backup_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM app_backup_settings WHERE id=1 AND restore_until > (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint
            AND lease_owner IS DISTINCT FROM COALESCE(current_setting('novora.restore_owner', true), ''))
          THEN RAISE EXCEPTION 'NOVORA_RESTORE_IN_PROGRESS'; END IF;
          RETURN NULL;
        END $$`,
        ...GUARDED_TABLES.map((table) =>
          query(
            tx,
            `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='novora_backup_write_guard' AND tgrelid='${table}'::regclass) THEN CREATE TRIGGER novora_backup_write_guard BEFORE INSERT OR UPDATE OR DELETE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION novora_backup_write_guard(); END IF; END $$`,
          ),
        ),
      ]);
    })().catch((error) => {
      setup = undefined;
      throw error;
    });
  return setup;
}
async function settings() {
  await ensureBackupTables();
  return (await authSql()`SELECT * FROM app_backup_settings WHERE id=1`)[0];
}
export async function backupStatus(offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new BackupError('无效的列表页码');
  if (storageMode() === 'windows') return windowsBackupStatus(offset);
  const state = await settings();
  const mode = storageMode();
  await authSql()`DELETE FROM app_backup_uploads WHERE expires_at<${Date.now()}`;
  await authSql()`UPDATE app_backup_runs SET status='failed',error='即时下载已过期；请重新生成' WHERE kind IN ('manual','protection') AND status='running' AND created_at<${Date.now() - 1_800_000}`;
  const schedulerReady = mode === 'local' && process.env.BACKUP_WORKER_ENABLED === '1';
  const runs =
    await authSql()`SELECT id, kind, status, created_at, size_bytes, checksum, file_sha256, error FROM app_backup_runs ORDER BY created_at DESC LIMIT 51 OFFSET ${offset}`;
  return {
    mode,
    platform: backupPlatform(),
    enabled: mode === 'local' && state.enabled,
    retention: state.retention,
    schedulerReady,
    busy: Number(state.lease_until) > Date.now(),
    maxBytes: maxBackupBytes(),
    hasMore: runs.length > 50,
    runs: runs.slice(0, 50).map((run) => ({
      ...run,
      id: String(run.id),
      kind: String(run.kind),
      fileStored: mode === 'local',
      status: run.status === 'running' && Number(run.created_at) + 600_000 < Date.now() ? 'failed' : run.status,
      error:
        run.status === 'running' && Number(run.created_at) + 600_000 < Date.now() ? '任务中断，可重新执行' : run.error,
    })),
  };
}
export async function configureBackup(enabled: unknown, retention: unknown) {
  if (typeof enabled !== 'boolean' || !Number.isInteger(retention) || Number(retention) < 1 || Number(retention) > 365)
    throw new BackupError('保留份数应为 1–365');
  const status = await backupStatus();
  if (enabled && storageMode() !== 'local') throw new BackupError('每日自动备份仅支持 Linux 自部署的持久目录', 409);
  if (enabled && !status.schedulerReady) throw new BackupError('请先配置备份存储和自动任务运行器', 409);
  await authSql()`UPDATE app_backup_settings SET enabled=${enabled}, retention=${Number(retention)} WHERE id=1`;
}
async function acquire(restore = false): Promise<string> {
  await ensureBackupTables();
  const owner = randomUUID();
  const until = Date.now() + 600_000;
  const rows =
    await authSql()`UPDATE app_backup_settings SET lease_owner=${owner}, lease_until=${until}, restore_until=${restore ? until : 0}
    WHERE id=1 AND lease_until < ${Date.now()} AND restore_until < ${Date.now()} RETURNING id`;
  if (!rows.length) throw new BackupError('已有备份或恢复任务执行中，请稍后再试', 409);
  return owner;
}
async function release(owner: string, restore = false) {
  await authSql()`UPDATE app_backup_settings SET lease_until=0, restore_until=${restore ? Date.now() + 10_000 : 0} WHERE id=1 AND lease_owner=${owner}`;
}
async function schema() {
  const columns =
    await authSql()`SELECT table_name, column_name, udt_name, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name=ANY(${[...BACKUP_TABLES]}::text[]) ORDER BY table_name, ordinal_position`;
  return { columns, fingerprint: digest(columns) };
}
const snapshotSql = `SELECT jsonb_build_object(${BACKUP_TABLES.map((table) => `'${table}', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM ${table} t), '[]'::jsonb)`).join(',')}) AS data`;
export async function snapshot(owner?: string): Promise<string> {
  const shape = await schema();
  const result = await authSql().transaction((tx) => [
    tx`SELECT set_config('lock_timeout','10000',true), set_config('statement_timeout','45000',true)`,
    query(tx, `LOCK TABLE ${[...GUARDED_TABLES].sort().join(',')} IN SHARE MODE`),
    query(tx, snapshotSql),
  ]);
  const data = sanitizeData(result[2][0].data as BackupFile['data']);
  const limit = maxBackupBytes();
  const text = pack(data, shape.fingerprint, Date.now(), limit);
  unpack(text, limit);
  if (owner) {
    const valid =
      await authSql()`SELECT id FROM app_backup_settings WHERE id=1 AND lease_owner=${owner} AND lease_until>${Date.now()}`;
    if (!valid.length) throw new BackupError('任务租约已失效', 409);
  }
  return text;
}
async function persist(kind: string, source: string | (() => Promise<string>), day: string | null = null) {
  const id = randomUUID();
  const at = Date.now();
  let namespace: string | undefined;
  await authSql()`INSERT INTO app_backup_runs(id,kind,day,status,created_at) VALUES(${id},${kind},${day},'running',${at})`;
  try {
    const text = typeof source === 'string' ? source : await source();
    const file = unpack(text, maxBackupBytes());
    const state = await settings();
    namespace = String(state.namespace);
    await saveFile(namespace, id, text);
    const fileSha256 = createHash('sha256').update(text, 'utf8').digest('hex');
    await authSql()`UPDATE app_backup_runs SET status='success',size_bytes=${Buffer.byteLength(text)},checksum=${file.checksum},file_sha256=${fileSha256} WHERE id=${id}`;
    return id;
  } catch (error) {
    if (namespace) await deleteFile(namespace, id).catch(() => console.error('backup incomplete file cleanup failed'));
    await authSql()`UPDATE app_backup_runs SET status='failed',error='备份未完成，请检查存储配置、权限与容量后重试' WHERE id=${id}`.catch(
      () => console.error('backup failure recording failed'),
    );
    throw error;
  }
}
async function prune() {
  const state = await settings();
  const expired =
    await authSql()`SELECT id FROM app_backup_runs WHERE kind='automatic' AND status='success' ORDER BY created_at DESC OFFSET ${Number(state.retention)}`;
  for (const row of expired) {
    await deleteFile(String(state.namespace), String(row.id));
    await authSql()`DELETE FROM app_backup_runs WHERE id=${row.id}`;
  }
}
export async function createBackup(kind: 'manual' | 'automatic' = 'manual') {
  if (storageMode() !== 'local') throw new BackupError('Linux 自部署才支持保存到本地目录', 409);
  const owner = await acquire();
  try {
    const day = kind === 'automatic' ? backupDay() : null;
    if (day) {
      const done =
        await authSql()`SELECT id FROM app_backup_runs WHERE kind='automatic' AND day=${day} AND status='success'`;
      if (done.length) {
        await prune().catch(() => console.error('backup retention cleanup failed'));
        return String(done[0].id);
      }
    }
    const id = await persist(kind, () => snapshot(owner), day);
    await prune().catch(() => console.error('backup retention cleanup failed'));
    return id;
  } finally {
    await release(owner).catch(() => console.error('backup lease cleanup failed'));
  }
}
export async function runAutomaticBackup() {
  if (storageMode() !== 'local') return { skipped: true };
  const state = await settings();
  if (state.enabled !== true) return { skipped: true };
  return { id: await createBackup('automatic') };
}
export async function readBackup(id: string) {
  validId(id);
  const state = await settings();
  const rows = await authSql()`SELECT checksum FROM app_backup_runs WHERE id=${id} AND status='success'`;
  if (!rows.length) throw new BackupError('备份不存在或未完成', 404);
  const text = await readStoredFile(String(state.namespace), id);
  const file = unpack(text, maxBackupBytes());
  if (file.checksum !== rows[0].checksum) throw new BackupError('备份与任务记录不一致');
  return text;
}
export async function removeBackup(id: string) {
  validId(id);
  if (storageMode() === 'vercel') {
    await authSql()`DELETE FROM app_backup_uploads WHERE id=${id} AND purpose='export'`;
    await authSql()`DELETE FROM app_backup_runs WHERE id=${id}`;
    return;
  }
  const owner = await acquire();
  try {
    const state = await settings();
    await deleteFile(String(state.namespace), id);
    await authSql()`DELETE FROM app_backup_runs WHERE id=${id}`;
  } finally {
    await release(owner).catch(() => console.error('backup lease cleanup failed'));
  }
}
export async function uploadPart(ownerId: number, input: Record<string, unknown>) {
  const maxBytes = maxBackupBytes();
  const id = validId(input.id);
  const part = Number(input.part);
  const total = Number(input.total);
  if (
    !Number.isInteger(part) ||
    !Number.isInteger(total) ||
    part < 0 ||
    total < 1 ||
    part >= total ||
    total > Math.ceil(maxBytes / CHUNK_BYTES) ||
    typeof input.content !== 'string' ||
    input.content.length > 700000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content)
  )
    throw new BackupError('无效的备份分块');
  const sql = authSql();
  await ensureBackupTables();
  await sql`DELETE FROM app_backup_uploads WHERE expires_at<${Date.now()}`;
  if (part === 0) await sql`DELETE FROM app_backup_uploads WHERE owner_id=${ownerId} AND purpose='restore'`;
  const existing = await sql`SELECT owner_id,purpose FROM app_backup_uploads WHERE id=${id} LIMIT 1`;
  if (existing.length && (Number(existing[0].owner_id) !== ownerId || existing[0].purpose !== 'restore'))
    throw new BackupError('上传会话无效', 403);
  await sql`INSERT INTO app_backup_uploads(id,owner_id,part,total,content,expires_at,purpose) VALUES(${id},${ownerId},${part},${total},${input.content},${Date.now() + 1800_000},'restore')
    ON CONFLICT(id,part) DO UPDATE SET content=EXCLUDED.content,expires_at=EXCLUDED.expires_at WHERE app_backup_uploads.owner_id=EXCLUDED.owner_id AND app_backup_uploads.total=EXCLUDED.total AND app_backup_uploads.purpose='restore'`;
}
async function uploadText(ownerId: number, id: string) {
  validId(id);
  const parts =
    await authSql()`SELECT part,total,content FROM app_backup_uploads WHERE id=${id} AND owner_id=${ownerId} AND purpose='restore' AND expires_at>${Date.now()} ORDER BY part`;
  if (
    !parts.length ||
    parts.length !== Number(parts[0].total) ||
    parts.some((part, index) => Number(part.part) !== index || Number(part.total) !== parts.length)
  )
    throw new BackupError('上传未完成或已过期，请重新选择文件');
  const binaryParts = parts.map((part) => Buffer.from(String(part.content), 'base64'));
  const totalBytes = binaryParts.reduce((total, part) => total + part.length, 0);
  if (totalBytes > maxBackupBytes()) throw new BackupError('备份超过当前部署的文件上限', 413);
  return Buffer.concat(binaryParts).toString('utf8');
}
async function stageTransientFile(ownerId: number, kind: 'manual' | 'protection', text: string) {
  const id = randomUUID();
  const file = unpack(text, maxBackupBytes());
  const bytes = Buffer.from(text, 'utf8');
  const total = Math.ceil(bytes.length / CHUNK_BYTES);
  const expiresAt = Date.now() + 1_800_000;
  await authSql()`DELETE FROM app_backup_uploads WHERE expires_at<${Date.now()}`;
  await authSql()`INSERT INTO app_backup_runs(id,kind,status,created_at,size_bytes,checksum,file_sha256) VALUES(${id},${kind},'running',${Date.now()},${bytes.length},${file.checksum},${createHash('sha256').update(text, 'utf8').digest('hex')})`;
  try {
    for (let part = 0; part < total; part++) {
      await authSql()`INSERT INTO app_backup_uploads(id,owner_id,part,total,content,expires_at,purpose)
        VALUES(${id},${ownerId},${part},${total},${bytes.subarray(part * CHUNK_BYTES, (part + 1) * CHUNK_BYTES).toString('base64')},${expiresAt},'export')`;
    }
    return {
      id,
      checksum: file.checksum,
      fileSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
      bytes: bytes.length,
      total,
      filename: `novora-backup-${id}.novora-backup`,
    };
  } catch (error) {
    await authSql()`DELETE FROM app_backup_uploads WHERE id=${id} AND owner_id=${ownerId}`;
    await authSql()`UPDATE app_backup_runs SET status='failed',error='临时下载文件生成失败' WHERE id=${id}`;
    throw error;
  }
}
export async function createTransientBackup(ownerId: number, kind: 'manual' | 'protection' = 'manual') {
  if (storageMode() !== 'vercel') throw new BackupError('仅 Vercel 使用即时下载备份', 409);
  const owner = await acquire();
  try {
    return await stageTransientFile(ownerId, kind, await snapshot(owner));
  } finally {
    await release(owner).catch(() => console.error('backup lease cleanup failed'));
  }
}
export async function readTransientPart(ownerId: number, id: string, part: number) {
  validId(id);
  if (!Number.isInteger(part) || part < 0) throw new BackupError('无效的备份分块');
  const run =
    await authSql()`SELECT kind,status,size_bytes,file_sha256 FROM app_backup_runs WHERE id=${id} AND status IN ('running','success') AND kind IN ('manual','protection')`;
  if (!run.length) throw new BackupError('即时下载文件不存在或已过期', 404);
  const rows =
    await authSql()`SELECT content,total FROM app_backup_uploads WHERE id=${id} AND owner_id=${ownerId} AND part=${part} AND purpose='export' AND expires_at>${Date.now()}`;
  if (!rows.length) throw new BackupError('即时下载文件不存在或已过期', 404);
  await authSql()`UPDATE app_backup_uploads SET served_at=${Date.now()} WHERE id=${id} AND owner_id=${ownerId} AND part=${part} AND purpose='export'`;
  return {
    ok: true,
    id,
    part,
    total: Number(rows[0].total),
    content: String(rows[0].content),
    filename: `novora-backup-${id}.novora-backup`,
    fileSha256: String(run[0].file_sha256),
  };
}
export async function completeTransientDownload(ownerId: number, id: string, fileSha256: string) {
  validId(id);
  const parts =
    await authSql()`SELECT part,total,served_at FROM app_backup_uploads WHERE id=${id} AND owner_id=${ownerId} AND purpose='export' AND expires_at>${Date.now()} ORDER BY part`;
  if (
    !parts.length ||
    parts.some(
      (row, index) => Number(row.part) !== index || Number(row.total) !== parts.length || Number(row.served_at) <= 0,
    )
  )
    throw new BackupError('下载分块未完整读取，文件签名未确认');
  const run =
    await authSql()`SELECT file_sha256 FROM app_backup_runs WHERE id=${id} AND kind IN ('manual','protection')`;
  if (!run.length || !/^[a-f0-9]{64}$/.test(fileSha256) || run[0].file_sha256 !== fileSha256)
    throw new BackupError('文件 SHA-256 校验失败，临时分块已保留至过期');
  const updated =
    await authSql()`UPDATE app_backup_runs SET status='success' WHERE id=${id} AND status IN ('running','success') AND kind IN ('manual','protection') RETURNING id`;
  if (!updated.length) throw new BackupError('下载记录无效或已完成', 409);
  await authSql()`DELETE FROM app_backup_uploads WHERE id=${id} AND owner_id=${ownerId} AND purpose='export'`;
  return { ok: true };
}
export async function previewBackup(ownerId: number, input: { uploadId?: string; id?: string }) {
  const text = input.uploadId ? await uploadText(ownerId, input.uploadId) : await readBackup(validId(input.id));
  const file = unpack(text, maxBackupBytes());
  const shape = await schema();
  if (file.schema !== shape.fingerprint) throw new BackupError('备份数据库结构与当前版本不兼容，请使用相同版本恢复');
  for (const table of BACKUP_TABLES) {
    const keys = shape.columns
      .filter((col) => col.table_name === table)
      .map((col) => String(col.column_name))
      .sort()
      .join(',');
    if (file.data[table].some((row) => Object.keys(row).sort().join(',') !== keys))
      throw new BackupError(`数据列不完整：${table}`);
  }
  return {
    file,
    text,
    preview: {
      createdAt: file.createdAt,
      checksum: file.checksum,
      fileSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
      bytes: Buffer.byteLength(text),
      tables: BACKUP_TABLES.map((table) => ({ table, rows: file.data[table].length })),
      administrators: file.data.app_users
        .filter((user) => user.role_id === 'super_admin' && user.status === 'active')
        .map((user) => String(user.username)),
    },
  };
}
export async function restoreBackup(
  actor: AdminActor,
  input: {
    uploadId?: string;
    id?: string;
    checksum?: string;
    fileSha256?: string;
    protectionId?: string;
    protectionChecksum?: string;
    protectionFileSha256?: string;
  },
) {
  if (!['vercel', 'local'].includes(storageMode()))
    throw new BackupError('Windows 请使用控制中心恢复，当前平台不支持 Web 恢复', 409);
  const { file, text } = await previewBackup(actor.id, input);
  if (input.checksum !== file.checksum) throw new BackupError('请先预览并确认当前备份');
  const sourceSha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  if (input.fileSha256 !== sourceSha256) throw new BackupError('恢复文件 SHA-256 校验失败，请重新选择并预览文件');
  let protectionId: string | undefined;
  if (storageMode() === 'vercel') {
    if (!input.protectionId || !input.protectionChecksum || !input.protectionFileSha256)
      throw new BackupError('请先下载并校验恢复前保护备份');
    const protection =
      await authSql()`SELECT checksum,file_sha256 FROM app_backup_runs WHERE id=${input.protectionId} AND kind='protection' AND status='success'`;
    if (
      !protection.length ||
      protection[0].checksum !== input.protectionChecksum ||
      protection[0].file_sha256 !== input.protectionFileSha256
    )
      throw new BackupError('恢复前保护备份签名无效，请重新生成并下载');
    protectionId = input.protectionId;
  }
  const owner = await acquire(true);
  try {
    if (storageMode() === 'local') protectionId = await persist('protection', () => snapshot(owner));
    await applyRestore(file, owner);
    invalidateAuthConfigCache();
    // Cleanup errors after COMMIT must not be reported as a rollback.
    try {
      await authSql()`DELETE FROM app_backup_uploads WHERE owner_id=${actor.id} AND purpose='restore'`;
      await writeAudit(actor, 'backup.restore', 'backup', input.id ?? input.uploadId ?? '', { protectionId });
    } catch {
      console.error('backup post-restore cleanup failed');
    }
    return { protectionId: protectionId! };
  } catch (error) {
    if (protectionId)
      throw new BackupError(
        storageMode() === 'vercel'
          ? '恢复失败，原数据事务已回滚；恢复前保护备份已下载到本机。'
          : `恢复失败，原数据事务已回滚；恢复前备份已保留（${protectionId}）`,
        409,
      );
    throw error;
  } finally {
    await release(owner, true).catch(() => console.error('backup restore lease cleanup failed'));
  }
}
export async function applyRestore(file: BackupFile, owner: string) {
  const sql = authSql();
  const now = Date.now();
  const data = sanitizeData(structuredClone(file.data));
  await sql.transaction((tx) => [
    tx`SELECT set_config('lock_timeout','10000',true),set_config('statement_timeout','45000',true),set_config('novora.restore_owner',${owner},true)`,
    query(tx, `LOCK TABLE ${[...GUARDED_TABLES].sort().join(',')} IN EXCLUSIVE MODE`),
    tx`SELECT id FROM app_backup_settings WHERE id=1 FOR UPDATE`,
    tx`SELECT 1 / CASE WHEN EXISTS (SELECT 1 FROM app_backup_settings WHERE id=1 AND lease_owner=${owner} AND restore_until>${now} AND lease_until>${now}) THEN 1 ELSE 0 END AS valid_lease`,
    // Trigger also verifies the owner on every write while maintenance is active.
    tx`UPDATE app_auth SET session_secret=${randomBytes(32).toString('base64url')},token_version=token_version+1,updated_at=${now} WHERE id=1`,
    tx`DELETE FROM device_commands`,
    tx`DELETE FROM email_outbox`,
    tx`DELETE FROM email_verification_codes`,
    ...[...BACKUP_TABLES].reverse().map((table) => query(tx, `DELETE FROM ${table}`)),
    ...BACKUP_TABLES.map((table) =>
      query(tx, `INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`, [
        JSON.stringify(data[table]),
      ]),
    ),
    tx`UPDATE app_users SET token_version=token_version+1`,
    tx`UPDATE exam_data SET updated_at=${now}, revisions=(SELECT COALESCE(jsonb_object_agg(key, to_jsonb(${now}::bigint)), '{}'::jsonb) FROM jsonb_each(revisions)) WHERE id=1`,
    tx`UPDATE app_time_control SET revision=${now},sync_request_id='',sync_requested_at=0`,
    ...['app_users', 'app_user_scopes', 'exam_announcement_images'].map((table) =>
      query(
        tx,
        `SELECT setval(pg_get_serial_sequence('${table}','id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${table}),1), (SELECT last_value FROM ${table}_id_seq)), true)`,
      ),
    ),
  ]);
}
