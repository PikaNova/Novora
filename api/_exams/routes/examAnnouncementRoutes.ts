import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireActor, writeAudit } from '../../_auth.js';
import { database, ensureTableOnce, missingRelation } from '../db.js';

/**
 * 学校侧考试公告（T-286-03 一期）。
 *
 * 与作者端统一公告（`/api/announcements`）：那是全局内容，这里是学校自己发给指定教室的。
 * 一期口径（2026-09-24 定稿）：
 * - 范围只做 全校 / 年级 / 班级（**不做楼栋**，学校结构暂无楼栋字段）；
 * - **不需要回执**，展示即算送达；
 * - `urgent` 公告在大屏**置顶且不可关闭**，并优先于作者端全局公告展示。
 */

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function idList(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function error(res: VercelResponse, status: number, code: string, message: string): void {
  res.status(status).json({ ok: false, code, error: message });
}

function announcementJson(row: Row): Record<string, unknown> {
  return {
    id: text(row.id),
    title: text(row.title),
    body: text(row.body),
    level: text(row.level) === 'urgent' ? 'urgent' : 'normal',
    examId: text(row.exam_id) || null,
    scopeType: text(row.scope_type) || 'all',
    scopeIds: idList(row.scope_ids),
    createdBy: row.created_by == null ? null : number(row.created_by, 0),
    createdAt: number(row.created_at),
    expiresAt: row.expires_at == null ? null : number(row.expires_at),
  };
}

/** 管理员视角：最近发过的公告（审计与"已发送"列表）。 */
async function handleAnnouncementList(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await requireActor(req, res, 'major.read');
  if (!actor) return;
  await ensureTableOnce();
  const sql = database();
  const limit = Math.max(1, Math.min(100, Math.trunc(number(req.query?.limit, 20))));
  const rows = (await sql`
    SELECT id, title, body, level, exam_id, scope_type, scope_ids, created_by, created_at, expires_at
    FROM exam_announcements
    WHERE status = 'sent'
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as unknown as Row[];
  res.status(200).json({ ok: true, data: rows.map(announcementJson) });
}

/**
 * 教室端拉取：按设备绑定的年级/班级过滤，只回没过期的。
 * 排序：紧急优先，其次按时间倒序；一期不做回执，拉取即算送达。
 */
async function handleDeviceAnnouncements(req: VercelRequest, res: VercelResponse): Promise<void> {
  const instanceId = text(req.query?.instanceId ?? req.body?.instanceId)
    .trim()
    .slice(0, 128);
  if (!instanceId) {
    error(res, 400, 'INVALID_INSTANCE', 'instanceId is required');
    return;
  }
  await ensureTableOnce();
  const sql = database();
  const deviceRows = (await sql`
    SELECT grade_id, class_id, revoked FROM device_instances WHERE instance_id = ${instanceId}
  `) as unknown as Row[];
  const device = deviceRows[0];
  if (!device || device.revoked === true) {
    error(res, 404, 'DEVICE_NOT_FOUND', '设备未绑定或已撤销');
    return;
  }
  const gradeId = text(device.grade_id);
  const classId = text(device.class_id);
  const now = Date.now();
  const rows = (await sql`
    SELECT id, title, body, level, exam_id, scope_type, scope_ids, created_by, created_at, expires_at
    FROM exam_announcements
    WHERE status = 'sent'
      AND (expires_at IS NULL OR expires_at > ${now})
      AND (
        scope_type = 'all'
        OR (scope_type = 'grade' AND scope_ids @> ${JSON.stringify([gradeId])}::jsonb)
        OR (scope_type = 'class' AND scope_ids @> ${JSON.stringify([classId])}::jsonb)
      )
    ORDER BY CASE WHEN level = 'urgent' THEN 0 ELSE 1 END, created_at DESC
    LIMIT 20
  `) as unknown as Row[];
  res.status(200).json({ ok: true, data: rows.map(announcementJson), serverTime: now });
}

/** 发送公告：权限沿用 major.edit；范围与考试范围同一套口径（全校=两个数组都空）。 */
async function handleAnnouncementSend(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    error(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    return;
  }
  const actor = await requireActor(req, res, 'major.edit');
  if (!actor) return;
  const title = text(req.body?.title).trim().slice(0, 120);
  const body = text(req.body?.body).trim().slice(0, 4000);
  if (!title && !body) {
    error(res, 400, 'EMPTY_ANNOUNCEMENT', '公告标题或内容至少填一项');
    return;
  }
  const level = text(req.body?.level) === 'urgent' ? 'urgent' : 'normal';
  const scopeType = ['all', 'grade', 'class'].includes(text(req.body?.scopeType)) ? text(req.body?.scopeType) : 'all';
  const scopeIds = scopeType === 'all' ? [] : idList(req.body?.scopeIds).slice(0, 200);
  if (scopeType !== 'all' && !scopeIds.length) {
    error(res, 400, 'EMPTY_SCOPE', '指定范围时至少要选一个年级或班级');
    return;
  }
  const examId = text(req.body?.examId).trim().slice(0, 128) || null;
  const minutes = Math.max(0, Math.trunc(number(req.body?.expiresInMinutes, 120)));
  const now = Date.now();
  const expiresAt = minutes > 0 ? now + minutes * 60_000 : null;
  const id = `ann_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  await ensureTableOnce();
  const sql = database();
  try {
    await sql`
      INSERT INTO exam_announcements (id, title, body, level, exam_id, scope_type, scope_ids, created_by, created_at, expires_at, status)
      VALUES (${id}, ${title}, ${body}, ${level}, ${examId}, ${scopeType}, ${JSON.stringify(scopeIds)}::jsonb, ${actor.id}, ${now}, ${expiresAt}, 'sent')
    `;
  } catch (caught) {
    if (missingRelation(caught)) {
      await ensureTableOnce();
      error(res, 503, 'SCHEMA_RETRY_REQUIRED', '数据库结构正在初始化，请重试');
      return;
    }
    throw caught;
  }
  await writeAudit(actor, 'exam.announcement.send', 'exam_announcement', id, {
    level,
    scopeType,
    scopeIds,
    ...(examId ? { examId } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    title: title.slice(0, 80),
  });
  res.status(200).json({
    ok: true,
    data: {
      id,
      title,
      body,
      level,
      examId,
      scopeType,
      scopeIds,
      createdBy: actor.id,
      createdAt: now,
      expiresAt,
    },
  });
}

export async function handleExamAnnouncementRoute(
  req: VercelRequest,
  res: VercelResponse,
  actionName = '',
): Promise<void> {
  const resource = text(req.query?.resource);
  if (req.method === 'GET' && resource === 'device-announcements') {
    await handleDeviceAnnouncements(req, res);
    return;
  }
  if (req.method === 'GET' && resource === 'announcements') {
    await handleAnnouncementList(req, res);
    return;
  }
  if (actionName === 'announce-send' || text(req.body?.action) === 'announce-send') {
    await handleAnnouncementSend(req, res);
    return;
  }
  error(res, 400, 'UNKNOWN_ANNOUNCEMENT_ACTION', '未知的公告操作');
}
