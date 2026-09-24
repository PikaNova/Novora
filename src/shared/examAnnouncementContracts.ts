/**
 * 学校侧考试公告（T-286-03）跨端契约。
 *
 * 服务端 `api/_exams/routes/examAnnouncementRoutes.ts`、客户端 `src/services/examAnnouncements.ts`
 * 与后台公告管理页共用这里的口径，避免两端对「生效中 / 已过期 / 已撤回」理解不一致
 * （数据库里的 status 只有 sent / revoked，过期是按 expires_at 现算的展示状态）。
 *
 * 注意：作者端统一公告是另一条通道（遥测台发布，见 `src/services/announcements.ts`），
 * 不在这份契约里。
 */

export type AnnouncementLevel = 'normal' | 'urgent';
export type AnnouncementScopeType = 'all' | 'grade' | 'class';
/** 展示状态：active = 未撤回且未过期。 */
export type AnnouncementStatus = 'active' | 'expired' | 'revoked';

export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 4000;
export const ANNOUNCEMENT_SCOPE_ID_MAX = 200;
export const ANNOUNCEMENT_DEFAULT_EXPIRES_MINUTES = 120;

/** 发送时的有效期选项（分钟，0 = 不过期）。发送弹窗与公告管理页共用一份。 */
export const ANNOUNCEMENT_EXPIRY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '30', label: '30 分钟' },
  { value: '120', label: '2 小时' },
  { value: '480', label: '当天' },
  { value: '0', label: '不过期' },
];

export const ANNOUNCEMENT_STATUS_LABELS: Record<AnnouncementStatus, string> = {
  active: '生效中',
  expired: '已过期',
  revoked: '已撤回',
};

export const ANNOUNCEMENT_SCOPE_LABELS: Record<AnnouncementScopeType, string> = {
  all: '全校',
  grade: '指定年级',
  class: '指定班级',
};

/** 由数据库行算出展示状态：撤回优先于过期。 */
export function resolveAnnouncementStatus(
  row: { status?: unknown; expiresAt?: unknown },
  now: number,
): AnnouncementStatus {
  if (String(row.status ?? 'sent') === 'revoked') return 'revoked';
  const expiresAt = Number(row.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= now ? 'expired' : 'active';
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const text = String(value ?? '').trim();
  return (allowed as readonly string[]).includes(text) ? (text as T) : fallback;
}

/** 列表筛选：状态，`all` = 不限。 */
export function parseAnnouncementStatusFilter(value: unknown): AnnouncementStatus | 'all' {
  return pick(value, ['all', 'active', 'expired', 'revoked'] as const, 'all');
}

/** 列表筛选：级别，`all` = 不限。 */
export function parseAnnouncementLevelFilter(value: unknown): AnnouncementLevel | 'all' {
  return pick(value, ['all', 'normal', 'urgent'] as const, 'all');
}

/**
 * 列表筛选：范围，`any` = 不限。
 * 注意不能复用 `all`——`all` 本身就是一个范围值（全校），这里用 `any` 表示不筛。
 */
export function parseAnnouncementScopeFilter(value: unknown): AnnouncementScopeType | 'any' {
  return pick(value, ['any', 'all', 'grade', 'class'] as const, 'any');
}
