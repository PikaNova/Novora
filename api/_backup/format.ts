import { createHash } from 'node:crypto';

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export const DEFAULT_LINUX_BACKUP_BYTES = 128 * 1024 * 1024;
export const CHUNK_BYTES = 512 * 1024;
// In dependency order. Only application data, never deployment credentials or queues.
export const BACKUP_TABLES = [
  'app_roles',
  'app_users',
  'app_user_scopes',
  'exam_data',
  'exam_records',
  'exam_record_operations',
  'exam_announcements',
  'exam_announcement_images',
  'exam_announcement_receipts',
  'exam_announcement_templates',
  'device_instances',
  'classisland_plugin_instances',
  'app_time_control',
  'app_diagnostic_settings',
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];
export type BackupData = Record<BackupTable, Record<string, unknown>[]>;
export type BackupFile = {
  format: 'novora-backup';
  version: 1;
  createdAt: number;
  schema: string;
  data: BackupData;
  checksum: string;
};
export class BackupError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function sizeLimitLabel(maxBytes: number): string {
  return `${(maxBytes / 1024 / 1024).toLocaleString('en-US', { maximumFractionDigits: 0 })} MiB`;
}
export function pack(data: BackupData, schema: string, createdAt = Date.now(), maxBytes = MAX_BACKUP_BYTES): string {
  const body = { format: 'novora-backup' as const, version: 1 as const, createdAt, schema, data };
  const text = JSON.stringify({ ...body, checksum: digest(body) });
  if (Buffer.byteLength(text) > maxBytes) throw new BackupError(`备份超过 ${sizeLimitLabel(maxBytes)}`, 413);
  return text;
}
export function unpack(text: string, maxBytes = MAX_BACKUP_BYTES): BackupFile {
  if (Buffer.byteLength(text) > maxBytes) throw new BackupError(`备份超过 ${sizeLimitLabel(maxBytes)}`, 413);
  let value: BackupFile;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BackupError('备份文件不是有效 JSON');
  }
  if (
    !value ||
    value.format !== 'novora-backup' ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt <= 0 ||
    typeof value.schema !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.schema) ||
    typeof value.data !== 'object' ||
    !value.data ||
    Array.isArray(value.data)
  )
    throw new BackupError('不支持的备份格式');
  const { checksum, ...body } = value;
  if (typeof checksum !== 'string' || digest(body) !== checksum) throw new BackupError('备份校验失败，文件可能已损坏');
  if (Object.keys(value.data).sort().join(',') !== [...BACKUP_TABLES].sort().join(','))
    throw new BackupError('备份缺少数据表或包含未知表');
  for (const table of BACKUP_TABLES) {
    const rows = value.data[table];
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row)))
      throw new BackupError(`备份数据无效：${table}`);
  }
  const roles = value.data.app_roles;
  const admins = value.data.app_users.filter(
    (user) =>
      user.role_id === 'super_admin' &&
      user.status === 'active' &&
      user.must_change_password === false &&
      typeof user.username === 'string' &&
      user.username.trim().length > 0 &&
      typeof user.password_hash === 'string' &&
      /^[A-Za-z0-9_-]{86}$/.test(user.password_hash) &&
      typeof user.password_salt === 'string' &&
      /^[A-Za-z0-9_-]{22}$/.test(user.password_salt),
  );
  if (
    !roles.some(
      (role) => role.id === 'super_admin' && Array.isArray(role.permissions) && role.permissions.includes('*'),
    ) ||
    !admins.some((user) =>
      value.data.app_user_scopes.some(
        (scope) => String(scope.user_id) === String(user.id) && scope.scope_type === 'all',
      ),
    )
  )
    throw new BackupError('备份必须包含可登录的全校超级管理员');
  if (value.data.exam_data.length !== 1 || value.data.exam_data[0].id !== 1)
    throw new BackupError('备份缺少学校主数据');
  return value;
}
export function backupDay(now = Date.now()): string {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
}
export function validId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))
    throw new BackupError('无效的备份编号');
  return value;
}

// Commands and live pairing/heartbeat state must not replay, including for imported files.
export function sanitizeData(data: BackupData): BackupData {
  for (const user of data.app_users) user.last_login_at = null;
  for (const device of data.device_instances)
    Object.assign(device, {
      temporary_command: null,
      last_seen_at: 0,
      status: '',
      current_exam: '',
      current_subject: '',
      time_sync_request_id: '',
      time_sync_request_status: '',
      time_sync_request_error: '',
      time_sync_request_at: 0,
    });
  for (const plugin of data.classisland_plugin_instances)
    Object.assign(plugin, {
      pair_token_hash: null,
      pair_expires_at: null,
      viewer_last_seen_at: 0,
    });
  for (const control of data.app_time_control) Object.assign(control, { sync_request_id: '', sync_requested_at: 0 });
  return data;
}
