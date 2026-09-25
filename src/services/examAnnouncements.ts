import { apiErrorFromResponse, networkApiError } from './apiError';
import {
  ANNOUNCEMENT_LEVELS,
  ANNOUNCEMENT_SCOPE_TYPES,
  ANNOUNCEMENT_STATUSES,
  parseAnnouncementStyle,
  resolveAnnouncementStatus,
  type AnnouncementLevel,
  type AnnouncementScopeType,
  type AnnouncementStatus,
  type AnnouncementStyle,
} from '../shared/examAnnouncementContracts.js';
import { logger } from '../utils/logger';

/** 契约枚举的成员判断：取值列表来自共享契约，避免各处手抄后漂移。 */
function isContractValue<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/**
 * 学校侧考试公告（T-286-03 一期）。
 * 与作者端统一公告（`services/announcements.ts`）分开：这条通道是学校自己发给指定教室的，
 * 支持 全校 / 年级 / 班级 三种范围；`urgent` 在大屏置顶且不可关闭，并优先于作者端公告。
 */
export type SchoolExamAnnouncement = {
  id: string;
  title: string;
  body: string;
  level: AnnouncementLevel;
  /** 展示状态：生效中 / 已过期 / 已撤回（数据库里的 'sent' 不会出现在这里）。 */
  status: AnnouncementStatus;
  /** 大屏展示样式：标准卡片 / 大字海报 / 公告栏。 */
  style: AnnouncementStyle;
  examId: string | null;
  scopeType: AnnouncementScopeType;
  scopeIds: string[];
  createdBy: number | null;
  createdAt: number;
  expiresAt: number | null;
};

export type SendExamAnnouncementInput = {
  title: string;
  body: string;
  level: AnnouncementLevel;
  /** 大屏展示样式；不传按标准卡片处理。 */
  style?: AnnouncementStyle;
  scopeType: AnnouncementScopeType;
  scopeIds?: string[];
  examId?: string;
  /** 有效期（分钟）；<=0 表示不过期。 */
  expiresInMinutes?: number;
};

/** 后台公告管理页的列表筛选与分页。 */
export type SchoolAnnouncementQuery = {
  status?: AnnouncementStatus | 'all';
  level?: AnnouncementLevel | 'all';
  scope?: AnnouncementScopeType | 'any';
  limit?: number;
  offset?: number;
};

export type SchoolAnnouncementPage = {
  items: SchoolExamAnnouncement[];
  /** 还有没有下一页（服务端用 limit+1 探测，不返回总数）。 */
  hasMore: boolean;
};

export type UploadedAnnouncementImage = {
  id: number;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

function authToken(): string {
  return typeof localStorage === 'undefined' ? '' : localStorage.getItem('admin_auth_token') || '';
}

function authHeaders(): Record<string, string> {
  const token = authToken();
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

function parseAnnouncement(raw: unknown): SchoolExamAnnouncement | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  if (!id) return null;
  /**
   * 范围是最不能"猜"的字段：以前用两个字面量判断，未知值一律当全校——
   * 服务端以后加了新范围（例如楼栋），旧客户端会把定向公告当成全校广播发出去。
   * 现在按契约取值判断，遇到不认识的值既保留可读兜底、也打一条 warn，让漂移看得见。
   */
  const scopeType = isContractValue(ANNOUNCEMENT_SCOPE_TYPES, row.scopeType) ? row.scopeType : 'all';
  if (row.scopeType != null && row.scopeType !== '' && scopeType !== row.scopeType) {
    logger.warn('[exam-announcements] 未知的公告范围，已按全校处理（客户端契约可能落后于服务端）', {
      scopeType: String(row.scopeType),
      announcementId: id,
    });
  }
  const level = isContractValue(ANNOUNCEMENT_LEVELS, row.level) ? row.level : 'normal';
  if (row.level != null && row.level !== '' && level !== row.level) {
    logger.warn('[exam-announcements] 未知的公告级别，已按普通处理', {
      level: String(row.level),
      announcementId: id,
    });
  }
  const expiresAt = typeof row.expiresAt === 'number' ? row.expiresAt : null;
  return {
    id,
    title: typeof row.title === 'string' ? row.title : '',
    body: typeof row.body === 'string' ? row.body : '',
    level,
    style: parseAnnouncementStyle(row.style),
    // 服务端已经算好展示状态；旧实例没这一列时按 expiresAt 兜底，避免状态一直显示"生效中"。
    status: isContractValue(ANNOUNCEMENT_STATUSES, row.status)
      ? row.status
      : resolveAnnouncementStatus({ status: 'sent', expiresAt }, Date.now()),
    examId: typeof row.examId === 'string' && row.examId ? row.examId : null,
    scopeType,
    scopeIds: Array.isArray(row.scopeIds)
      ? row.scopeIds.filter((item): item is string => typeof item === 'string')
      : [],
    createdBy: typeof row.createdBy === 'number' ? row.createdBy : null,
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0,
    expiresAt,
  };
}

/** 教室端：拉取本机（按绑定班级/年级）能收到的公告。 */
export async function fetchDeviceExamAnnouncements(instanceId: string): Promise<SchoolExamAnnouncement[]> {
  if (!instanceId) return [];
  const params = new URLSearchParams({ resource: 'device-announcements', instanceId });
  let response: Response;
  try {
    response = await fetch(`/api/exams?${params.toString()}`, { cache: 'no-store' });
  } catch {
    return [];
  }
  if (!response.ok) return [];
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null;
  if (!payload?.ok || !Array.isArray(payload.data)) return [];
  return payload.data.map(parseAnnouncement).filter((item): item is SchoolExamAnnouncement => item !== null);
}

/**
 * 管理端：公告列表（公告管理页的唯一数据源）。
 * 默认只取生效中的公告；状态/级别/范围三个筛选为空时表示"不限"。
 */
export async function fetchSchoolAnnouncements(query: SchoolAnnouncementQuery = {}): Promise<SchoolAnnouncementPage> {
  const params = new URLSearchParams({ resource: 'announcements' });
  if (query.status && query.status !== 'all') params.set('status', query.status);
  if (query.level && query.level !== 'all') params.set('level', query.level);
  if (query.scope && query.scope !== 'any') params.set('scope', query.scope);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.offset) params.set('offset', String(query.offset));
  let response: Response;
  try {
    response = await fetch(`/api/exams?${params.toString()}`, { headers: authHeaders(), cache: 'no-store' });
  } catch {
    throw networkApiError();
  }
  if (!response.ok) throw await apiErrorFromResponse(response, '公告列表读取失败');
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    data?: unknown;
    hasMore?: unknown;
  } | null;
  if (!payload?.ok || !Array.isArray(payload.data)) throw await apiErrorFromResponse(response, '公告列表读取失败');
  return {
    items: payload.data.map(parseAnnouncement).filter((item): item is SchoolExamAnnouncement => item !== null),
    hasMore: payload.hasMore === true,
  };
}

/** 发送考试公告（权限：major.edit；范围与考试范围同一套口径）。 */
export async function sendExamAnnouncement(input: SendExamAnnouncementInput): Promise<SchoolExamAnnouncement> {
  let response: Response;
  try {
    response = await fetch('/api/exams', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action: 'announce-send', ...input }),
    });
  } catch {
    throw networkApiError();
  }
  if (!response.ok) throw await apiErrorFromResponse(response, '公告发送失败');
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null;
  const parsed = parseAnnouncement(payload?.data);
  if (!payload?.ok || !parsed) throw await apiErrorFromResponse(response, '公告发送失败');
  return parsed;
}

/** 撤回公告（权限：major.edit）；撤回后大屏下一次轮询即不再展示，记录仍保留在列表里。 */
export async function revokeSchoolAnnouncement(id: string): Promise<SchoolExamAnnouncement> {
  let response: Response;
  try {
    response = await fetch('/api/exams', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action: 'announce-revoke', id }),
    });
  } catch {
    throw networkApiError();
  }
  if (!response.ok) throw await apiErrorFromResponse(response, '公告撤回失败');
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null;
  const parsed = parseAnnouncement(payload?.data);
  if (!payload?.ok || !parsed) throw await apiErrorFromResponse(response, '公告撤回失败');
  return parsed;
}

/**
 * 上传公告正文图片（权限：major.edit）。
 *
 * 图片存在学校库里（`exam_announcement_images`），返回同源地址；正文里只保存地址，
 * 于是教室大屏和后台预览看到的是同一张图，换域名也不会裂图。
 */
export async function uploadSchoolAnnouncementImage(input: {
  filename: string;
  mimeType: string;
  base64: string;
}): Promise<UploadedAnnouncementImage> {
  let response: Response;
  try {
    response = await fetch('/api/exams?resource=announcement-image', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action: 'announce-image-upload', ...input }),
    });
  } catch {
    throw networkApiError();
  }
  if (!response.ok) throw await apiErrorFromResponse(response, '图片上传失败');
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    image?: Partial<UploadedAnnouncementImage>;
  } | null;
  const image = payload?.image;
  if (!payload?.ok || !image || typeof image.url !== 'string' || !image.url) {
    throw await apiErrorFromResponse(response, '图片上传失败');
  }
  return {
    id: Number(image.id) || 0,
    url: image.url,
    filename: typeof image.filename === 'string' ? image.filename : input.filename,
    mimeType: typeof image.mimeType === 'string' ? image.mimeType : input.mimeType,
    sizeBytes: Number(image.sizeBytes) || 0,
  };
}

/** 删除公告正文图片（权限：major.edit）；正文里已经插入的引用需要管理员手动改掉。 */
export async function deleteSchoolAnnouncementImage(id: number): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/exams?resource=announcement-image', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action: 'announce-image-delete', id }),
    });
  } catch {
    throw networkApiError();
  }
  if (!response.ok) throw await apiErrorFromResponse(response, '图片删除失败');
}
