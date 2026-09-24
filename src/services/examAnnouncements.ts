import { apiErrorFromResponse, networkApiError } from './apiError';

/**
 * 学校侧考试公告（T-286-03 一期）。
 * 与作者端统一公告（`services/announcements.ts`）分开：这条通道是学校自己发给指定教室的，
 * 支持 全校 / 年级 / 班级 三种范围；`urgent` 在大屏置顶且不可关闭，并优先于作者端公告。
 */
export type SchoolExamAnnouncement = {
  id: string;
  title: string;
  body: string;
  level: 'normal' | 'urgent';
  examId: string | null;
  scopeType: 'all' | 'grade' | 'class';
  scopeIds: string[];
  createdBy: number | null;
  createdAt: number;
  expiresAt: number | null;
};

export type SendExamAnnouncementInput = {
  title: string;
  body: string;
  level: 'normal' | 'urgent';
  scopeType: 'all' | 'grade' | 'class';
  scopeIds?: string[];
  examId?: string;
  /** 有效期（分钟）；<=0 表示不过期。 */
  expiresInMinutes?: number;
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
  const scopeType = row.scopeType === 'grade' || row.scopeType === 'class' ? row.scopeType : 'all';
  return {
    id,
    title: typeof row.title === 'string' ? row.title : '',
    body: typeof row.body === 'string' ? row.body : '',
    level: row.level === 'urgent' ? 'urgent' : 'normal',
    examId: typeof row.examId === 'string' && row.examId ? row.examId : null,
    scopeType,
    scopeIds: Array.isArray(row.scopeIds)
      ? row.scopeIds.filter((item): item is string => typeof item === 'string')
      : [],
    createdBy: typeof row.createdBy === 'number' ? row.createdBy : null,
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0,
    expiresAt: typeof row.expiresAt === 'number' ? row.expiresAt : null,
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

/** 管理端：最近发过的公告（审计/回看）。 */
export async function fetchExamAnnouncementHistory(limit = 20): Promise<SchoolExamAnnouncement[]> {
  const params = new URLSearchParams({ resource: 'announcements', limit: String(limit) });
  let response: Response;
  try {
    response = await fetch(`/api/exams?${params.toString()}`, { headers: authHeaders(), cache: 'no-store' });
  } catch {
    throw networkApiError();
  }
  if (!response.ok) throw await apiErrorFromResponse(response, '公告记录读取失败');
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null;
  if (!payload?.ok || !Array.isArray(payload.data)) throw await apiErrorFromResponse(response, '公告记录读取失败');
  return payload.data.map(parseAnnouncement).filter((item): item is SchoolExamAnnouncement => item !== null);
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
