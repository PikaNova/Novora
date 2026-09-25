import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { canAccessClass, canAccessGrade, requireActor, writeAudit, type AdminActor } from '../../_auth.js';
import { database, ensureTableOnce, missingRelation } from '../db.js';
import { examPayload } from '../payload.js';
import { hasAllScope } from '../../../src/shared/permissionRules.js';
import {
  ANNOUNCEMENT_ACK_BATCH_MAX,
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_DEFAULT_EXPIRES_MINUTES,
  ANNOUNCEMENT_IMAGE_MAX_BYTES,
  ANNOUNCEMENT_SCOPE_ID_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  isAnnouncementImageType,
  normalizeSeenItems,
  parseAnnouncementLevelFilter,
  parseAnnouncementScopeFilter,
  parseAnnouncementStatusFilter,
  parseAnnouncementStyle,
  parseAnnouncementRemindScope,
  resolveAnnouncementStatus,
} from '../../../src/shared/examAnnouncementContracts.js';

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

/** 管理端列表一页最多返回多少条（服务端在 SQL 里多取一条用于判断还有没有下一页）。 */
const LIST_MAX_LIMIT = 100;
const LIST_DEFAULT_LIMIT = 20;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 只认真正的布尔/字符串真值，缺省为 false（静默发布这种开关不能"字符串非空就算真"）。 */
function bool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1';
  if (typeof value === 'number') return value === 1;
  return false;
}

function idList(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function error(res: VercelResponse, status: number, code: string, message: string): void {
  res.status(status).json({ ok: false, code, error: message });
}

function announcementJson(row: Row, now: number): Record<string, unknown> {
  const expiresAt = row.expires_at == null ? null : number(row.expires_at);
  return {
    id: text(row.id),
    title: text(row.title),
    body: text(row.body),
    level: text(row.level) === 'urgent' ? 'urgent' : 'normal',
    // 展示状态（active / expired / revoked）：数据库里的 'sent' 不再向上暴露。
    status: resolveAnnouncementStatus({ status: row.status, expiresAt }, now),
    style: parseAnnouncementStyle(row.style),
    /** 静默发布：只进列表，不自动弹。 */
    silent: row.silent === true,
    /** 管理端最近一次"提醒未读教室"的时间（大屏据此决定是否再弹）。 */
    remindAt: row.remind_at == null ? null : number(row.remind_at),
    remindScope: parseAnnouncementRemindScope(row.remind_scope),
    /** 本机对这条公告的已读时间（只有设备端接口带这一列，管理端为 null）。 */
    seenAt: row.seen_at == null ? null : number(row.seen_at),
    examId: text(row.exam_id) || null,
    scopeType: text(row.scope_type) || 'all',
    scopeIds: idList(row.scope_ids),
    createdBy: row.created_by == null ? null : number(row.created_by, 0),
    createdAt: number(row.created_at),
    expiresAt,
  };
}

/** 搜索框里的关键字：转义 LIKE 通配符，避免 `%` 变成"匹配所有"。 */
function likePattern(raw: unknown): string {
  const value = text(raw).trim().slice(0, 60);
  if (!value) return '';
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** 近 N 天的统计按上海日期分桶（与大屏/审计里的日期口径一致）。 */
function shanghaiDateKey(ms: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/**
 * 管理端列表是否对当前账号可见。
 *
 * 全校公告对所有人可见；年级/班级范围公告只对该范围内的账号可见——判定复用共享权限规则
 * （`canAccessGrade` / `canAccessClass`），与设备管理页按范围过滤设备同一套口径：
 * 班级授权也算它所属年级的可访问范围，因为该班级的大屏确实会收到年级公告。
 */
function actorSeesAnnouncement(actor: AdminActor, row: Row, classGradeIds: Map<string, string>): boolean {
  if (hasAllScope(actor)) return true;
  const scopeType = text(row.scope_type) || 'all';
  if (scopeType === 'all') return true;
  const ids = idList(row.scope_ids);
  if (!ids.length) return false;
  if (scopeType === 'grade') return ids.some((id) => canAccessGrade(actor, id));
  if (scopeType === 'class') {
    return ids.some((id) => {
      const gradeId = classGradeIds.get(id);
      if (gradeId) return canAccessClass(actor, gradeId, id);
      // 学校结构里找不到这个班（例如已删除）时，只认显式的班级授权。
      return actor.scopes.some((scope) => scope.type === 'class' && scope.classId === id);
    });
  }
  return false;
}

/** 受限范围账号才需要加载学校结构（把 classId 映射回 gradeId）。 */
async function loadClassGradeIds(sql: ReturnType<typeof database>, actor: AdminActor): Promise<Map<string, string>> {
  if (hasAllScope(actor)) return new Map();
  const rows = (await sql`SELECT grades, classes FROM exam_data WHERE id=1`) as unknown as Row[];
  const payload = examPayload(rows[0] ?? {});
  return new Map(payload.classes.map((item) => [item.id, item.gradeId]));
}

/**
 * 管理员视角：公告列表（公告管理页的唯一数据源）。
 *
 * 支持 status / level / scope 三个筛选与 limit + offset 分页；返回 hasMore 而不是总数，
 * 这样分页在"范围过滤后本页变少"时也不会给出与实际不一致的总数。
 */
async function handleAnnouncementList(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await requireActor(req, res, 'major.read');
  if (!actor) return;
  await ensureTableOnce();
  const sql = database();
  const limit = Math.max(1, Math.min(LIST_MAX_LIMIT, Math.trunc(number(req.query?.limit, LIST_DEFAULT_LIMIT))));
  const offset = Math.max(0, Math.trunc(number(req.query?.offset, 0)));
  const status = parseAnnouncementStatusFilter(req.query?.status);
  const level = parseAnnouncementLevelFilter(req.query?.level);
  const scope = parseAnnouncementScopeFilter(req.query?.scope);
  const pattern = likePattern(req.query?.q);
  const now = Date.now();
  const classGradeIds = await loadClassGradeIds(sql, actor);
  const rows = (await sql`
    SELECT a.id, a.title, a.body, a.level, a.style, a.silent, a.remind_at, a.remind_scope,
      a.exam_id, a.scope_type, a.scope_ids, a.created_by, a.created_at, a.expires_at, a.status,
      -- 回执计数：一台设备一行，delivered=拉到过，seen=真正看过（≥3 秒）
      (SELECT COUNT(*) FROM exam_announcement_receipts r WHERE r.announcement_id = a.id) AS delivered_count,
      (SELECT COUNT(*) FROM exam_announcement_receipts r
        WHERE r.announcement_id = a.id AND r.first_seen_at IS NOT NULL) AS seen_count,
      -- 应达设备数按公告范围现算（不落库：设备换绑后历史公告的应达数随之变化）
      (SELECT COUNT(*) FROM device_instances d
        WHERE d.revoked = FALSE AND d.is_management = FALSE
          AND (a.scope_type = 'all'
            OR (a.scope_type = 'grade' AND d.grade_id IN (SELECT jsonb_array_elements_text(a.scope_ids)))
            OR (a.scope_type = 'class' AND d.class_id IN (SELECT jsonb_array_elements_text(a.scope_ids))))) AS target_count
    FROM exam_announcements a
    WHERE (
        ${status} = 'all'
        OR (${status} = 'active' AND a.status = 'sent' AND (a.expires_at IS NULL OR a.expires_at > ${now}))
        OR (${status} = 'expired' AND a.status = 'sent' AND a.expires_at IS NOT NULL AND a.expires_at <= ${now})
        OR (${status} = 'revoked' AND a.status = 'revoked')
      )
      AND (${level} = 'all' OR a.level = ${level})
      AND (${scope} = 'any' OR a.scope_type = ${scope})
      AND (${pattern} = '' OR a.title ILIKE ${pattern} OR a.body ILIKE ${pattern})
    ORDER BY a.created_at DESC
    LIMIT ${limit + 1} OFFSET ${offset}
  `) as unknown as Row[];
  const visible = rows.filter((row) => actorSeesAnnouncement(actor, row, classGradeIds));
  res.status(200).json({
    ok: true,
    data: visible.slice(0, limit).map((row) => ({
      ...announcementJson(row, now),
      targetCount: number(row.target_count, 0),
      deliveredCount: number(row.delivered_count, 0),
      seenCount: number(row.seen_count, 0),
    })),
    hasMore: rows.length > limit,
    serverTime: now,
  });
}

/**
 * 教室端拉取：按设备绑定的年级/班级过滤。
 *
 * - 默认只回没过期的"当前公告"，排序：紧急优先，其次按时间倒序；
 * - `history=1` 时回本机范围内的历史公告（已过期 / 已撤回），按发布时间倒序，
 *   用于教室端公告窗口的「历史」分页（管理端撤回过的公告也留在历史里，标注状态即可）。
 *
 * 两种口径都带上本机对每条公告的已读时间（`seenAt`），教室端可以直接标出"已读/未读"。
 * 拉取当前公告即算"送达"：顺手把送达时间记进回执表。写入带 `WHERE delivered_at IS NULL` 守卫，
 * 已经送达过的公告不会真的写行（这台设备每分钟拉一次，不能每次都产生一次 UPDATE）。
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
    SELECT grade_id, class_id, client_version, revoked FROM device_instances WHERE instance_id = ${instanceId}
  `) as unknown as Row[];
  const device = deviceRows[0];
  if (!device || device.revoked === true) {
    error(res, 404, 'DEVICE_NOT_FOUND', '设备未绑定或已撤销');
    return;
  }
  const gradeId = text(device.grade_id);
  const classId = text(device.class_id);
  const now = Date.now();
  const history = text(req.query?.history ?? req.body?.history) === '1';
  if (history) {
    const limit = Math.min(50, Math.max(1, Math.trunc(number(req.query?.limit, 30))));
    const rows = (await sql`
      SELECT a.id, a.title, a.body, a.level, a.style, a.silent, a.remind_at, a.remind_scope,
        a.exam_id, a.scope_type, a.scope_ids, a.created_by, a.created_at, a.expires_at, a.status,
        r.first_seen_at AS seen_at
      FROM exam_announcements a
      LEFT JOIN exam_announcement_receipts r
        ON r.announcement_id = a.id AND r.instance_id = ${instanceId}
      WHERE (a.status = 'revoked'
          OR (a.status = 'sent' AND a.expires_at IS NOT NULL AND a.expires_at <= ${now}))
        AND (a.scope_type = 'all'
          OR (a.scope_type = 'grade' AND a.scope_ids @> ${JSON.stringify([gradeId])}::jsonb)
          OR (a.scope_type = 'class' AND a.scope_ids @> ${JSON.stringify([classId])}::jsonb))
      ORDER BY a.created_at DESC
      LIMIT ${limit}
    `) as unknown as Row[];
    res.status(200).json({ ok: true, data: rows.map((row) => announcementJson(row, now)), serverTime: now });
    return;
  }
  const rows = (await sql`
    SELECT a.id, a.title, a.body, a.level, a.style, a.silent, a.remind_at, a.remind_scope,
      a.exam_id, a.scope_type, a.scope_ids, a.created_by, a.created_at, a.expires_at, a.status,
      r.first_seen_at AS seen_at
    FROM exam_announcements a
    LEFT JOIN exam_announcement_receipts r
      ON r.announcement_id = a.id AND r.instance_id = ${instanceId}
    WHERE a.status = 'sent'
      AND (a.expires_at IS NULL OR a.expires_at > ${now})
      AND (
        a.scope_type = 'all'
        OR (a.scope_type = 'grade' AND a.scope_ids @> ${JSON.stringify([gradeId])}::jsonb)
        OR (a.scope_type = 'class' AND a.scope_ids @> ${JSON.stringify([classId])}::jsonb)
      )
    ORDER BY CASE WHEN a.level = 'urgent' THEN 0 ELSE 1 END, a.created_at DESC
    LIMIT 20
  `) as unknown as Row[];
  const deliveredIds = rows.map((row) => text(row.id)).filter(Boolean);
  if (deliveredIds.length) {
    await sql`
      INSERT INTO exam_announcement_receipts (announcement_id, instance_id, grade_id, class_id, delivered_at, updated_at)
      SELECT item.id, ${instanceId}, ${gradeId}, ${classId}, ${now}, ${now}
      FROM jsonb_to_recordset(${JSON.stringify(deliveredIds.map((id) => ({ id })))}::jsonb) AS item(id text)
      ON CONFLICT (announcement_id, instance_id) DO UPDATE SET
        delivered_at = COALESCE(exam_announcement_receipts.delivered_at, EXCLUDED.delivered_at),
        grade_id = EXCLUDED.grade_id,
        class_id = EXCLUDED.class_id,
        updated_at = EXCLUDED.updated_at
      WHERE exam_announcement_receipts.delivered_at IS NULL
    `;
  }
  res.status(200).json({ ok: true, data: rows.map((row) => announcementJson(row, now)), serverTime: now });
}

/** 发送公告：权限沿用 major.edit；范围与考试范围同一套口径（全校=两个数组都空）。 */
async function handleAnnouncementSend(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    error(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    return;
  }
  const actor = await requireActor(req, res, 'major.edit');
  if (!actor) return;
  const title = text(req.body?.title).trim().slice(0, ANNOUNCEMENT_TITLE_MAX);
  const body = text(req.body?.body).trim().slice(0, ANNOUNCEMENT_BODY_MAX);
  if (!title && !body) {
    error(res, 400, 'EMPTY_ANNOUNCEMENT', '公告标题或内容至少填一项');
    return;
  }
  const level = text(req.body?.level) === 'urgent' ? 'urgent' : 'normal';
  const style = parseAnnouncementStyle(req.body?.style);
  // 静默发布：只进公告列表，不自动弹（夜间静默由客户端按时间判断，这里是管理员显式选择）。
  const silent = bool(req.body?.silent);
  const scopeType = ['all', 'grade', 'class'].includes(text(req.body?.scopeType)) ? text(req.body?.scopeType) : 'all';
  const scopeIds = scopeType === 'all' ? [] : idList(req.body?.scopeIds).slice(0, ANNOUNCEMENT_SCOPE_ID_MAX);
  if (scopeType !== 'all' && !scopeIds.length) {
    error(res, 400, 'EMPTY_SCOPE', '指定范围时至少要选一个年级或班级');
    return;
  }
  const examId = text(req.body?.examId).trim().slice(0, 128) || null;
  const minutes = Math.max(0, Math.trunc(number(req.body?.expiresInMinutes, ANNOUNCEMENT_DEFAULT_EXPIRES_MINUTES)));
  const now = Date.now();
  const expiresAt = minutes > 0 ? now + minutes * 60_000 : null;
  const id = `ann_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  await ensureTableOnce();
  const sql = database();
  try {
    await sql`
      INSERT INTO exam_announcements (id, title, body, level, style, silent, exam_id, scope_type, scope_ids, created_by, created_at, expires_at, status)
      VALUES (${id}, ${title}, ${body}, ${level}, ${style}, ${silent}, ${examId}, ${scopeType}, ${JSON.stringify(scopeIds)}::jsonb, ${actor.id}, ${now}, ${expiresAt}, 'sent')
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
    style,
    silent,
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
      style,
      silent,
      remindAt: null,
      remindScope: 'unseen',
      status: 'active',
      examId,
      scopeType,
      scopeIds,
      createdBy: actor.id,
      createdAt: now,
      expiresAt,
    },
  });
}

/**
 * 撤回公告：仅作者本人学校的管理员可撤回（权限沿用 major.edit）。
 * 撤回后教室端下一次轮询（≤60s）即不再展示，但记录保留在列表里可追溯。
 */
async function handleAnnouncementRevoke(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    error(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    return;
  }
  const actor = await requireActor(req, res, 'major.edit');
  if (!actor) return;
  const id = text(req.body?.id).trim().slice(0, 128);
  if (!id) {
    error(res, 400, 'INVALID_ANNOUNCEMENT', 'id is required');
    return;
  }
  await ensureTableOnce();
  const sql = database();
  const now = Date.now();
  const rows = (await sql`
    UPDATE exam_announcements SET status = 'revoked'
    WHERE id = ${id} AND status = 'sent'
    RETURNING id, title, body, level, style, exam_id, scope_type, scope_ids, created_by, created_at, expires_at, status
  `) as unknown as Row[];
  if (!rows.length) {
    error(res, 404, 'ANNOUNCEMENT_NOT_FOUND', '公告不存在或已经撤回');
    return;
  }
  await writeAudit(actor, 'exam.announcement.revoke', 'exam_announcement', id, {
    title: text(rows[0].title).slice(0, 80),
  });
  res.status(200).json({ ok: true, data: announcementJson(rows[0], now) });
}

/**
 * 未读强提醒（`action=announce-remind`，权限 major.edit）。
 *
 * 写一个比之前更大的 remind_at，教室大屏下次轮询（≤60 秒）发现"提醒时间比本地记录新"
 * 就会把公告重新弹一次；scope='unseen' 时，已经上报过已读的教室不再被打扰。
 */
async function handleAnnouncementRemind(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    error(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    return;
  }
  const actor = await requireActor(req, res, 'major.edit');
  if (!actor) return;
  const id = text(req.body?.id).trim().slice(0, 128);
  if (!id) {
    error(res, 400, 'INVALID_ANNOUNCEMENT', 'id is required');
    return;
  }
  const scope = parseAnnouncementRemindScope(req.body?.scope);
  await ensureTableOnce();
  const sql = database();
  const now = Date.now();
  const rows = (await sql`
    UPDATE exam_announcements SET remind_at = ${now}, remind_scope = ${scope}
    WHERE id = ${id} AND status = 'sent'
    RETURNING id, title, remind_at AS "remindAt", remind_scope AS "remindScope"
  `) as unknown as Row[];
  if (!rows.length) {
    error(res, 404, 'ANNOUNCEMENT_NOT_FOUND', '公告不存在或已撤回');
    return;
  }
  await writeAudit(actor, 'exam.announcement.remind', 'exam_announcement', id, {
    scope,
    title: text(rows[0].title).slice(0, 80),
  });
  res.status(200).json({
    ok: true,
    data: { id, remindAt: now, remindScope: scope },
  });
}

/**
 * 跨公告统计（`?resource=announcement-stats&days=7`，权限 major.read）。
 *
 * 口径与回执明细一致（应达按范围现算）；这里按"每条公告算一遍再汇总"实现，
 * 数据量是公告条数级别的（近 N 天），比在 SQL 里堆子查询更易读。
 */
async function handleAnnouncementStats(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await requireActor(req, res, 'major.read');
  if (!actor) return;
  const days = Math.min(90, Math.max(1, Math.trunc(number(req.query?.days, 7))));
  await ensureTableOnce();
  const sql = database();
  const now = Date.now();
  const since = now - days * 86_400_000;
  const classGradeIds = await loadClassGradeIds(sql, actor);
  const rows = (await sql`
    SELECT a.id, a.title, a.created_at, a.scope_type, a.scope_ids,
      (SELECT COUNT(*) FROM exam_announcement_receipts r WHERE r.announcement_id = a.id) AS delivered_count,
      (SELECT COUNT(*) FROM exam_announcement_receipts r
        WHERE r.announcement_id = a.id AND r.first_seen_at IS NOT NULL) AS seen_count,
      (SELECT COUNT(*) FROM device_instances d
        WHERE d.revoked = FALSE AND d.is_management = FALSE
          AND (a.scope_type = 'all'
            OR (a.scope_type = 'grade' AND d.grade_id IN (SELECT jsonb_array_elements_text(a.scope_ids)))
            OR (a.scope_type = 'class' AND d.class_id IN (SELECT jsonb_array_elements_text(a.scope_ids))))) AS target_count
    FROM exam_announcements a
    WHERE a.created_at >= ${since}
    ORDER BY a.created_at DESC
    LIMIT 500
  `) as unknown as Row[];
  const visible = rows.filter((row) => actorSeesAnnouncement(actor, row, classGradeIds));
  const deviceRows = (await sql`
    SELECT COUNT(DISTINCT instance_id)::int AS count FROM exam_announcement_receipts WHERE updated_at >= ${since}
  `) as unknown as Row[];

  const daily = new Map<string, { date: string; announcements: number; target: number; seen: number }>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const key = shanghaiDateKey(now - offset * 86_400_000);
    daily.set(key, { date: key, announcements: 0, target: 0, seen: 0 });
  }
  let target = 0;
  let delivered = 0;
  let seen = 0;
  const lowest: Array<{ id: string; title: string; target: number; seen: number }> = [];
  for (const row of visible) {
    const rowTarget = number(row.target_count, 0);
    const rowSeen = number(row.seen_count, 0);
    target += rowTarget;
    delivered += number(row.delivered_count, 0);
    seen += rowSeen;
    const bucket = daily.get(shanghaiDateKey(number(row.created_at)));
    if (bucket) {
      bucket.announcements += 1;
      bucket.target += rowTarget;
      bucket.seen += rowSeen;
    }
    if (rowTarget > 0) lowest.push({ id: text(row.id), title: text(row.title), target: rowTarget, seen: rowSeen });
  }
  lowest.sort((left, right) => left.seen / left.target - right.seen / right.target || right.target - left.target);
  res.status(200).json({
    ok: true,
    stats: {
      days,
      announcements: visible.length,
      target,
      delivered,
      seen,
      devices: number(deviceRows[0]?.count, 0),
      daily: [...daily.values()],
      lowest: lowest.slice(0, 5),
    },
    serverTime: now,
  });
}

/** 常用模板：列表（major.read）/ 保存（major.edit）/ 删除（major.edit）。 */
async function handleAnnouncementTemplates(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await requireActor(req, res, 'major.read');
  if (!actor) return;
  await ensureTableOnce();
  const sql = database();
  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT id, title, body, style, level, created_by, created_at, updated_at
      FROM exam_announcement_templates ORDER BY updated_at DESC LIMIT 50
    `) as unknown as Row[];
    res.status(200).json({
      ok: true,
      data: rows.map((row) => ({
        id: text(row.id),
        title: text(row.title),
        body: text(row.body),
        style: parseAnnouncementStyle(row.style),
        level: text(row.level) === 'urgent' ? 'urgent' : 'normal',
        createdBy: row.created_by == null ? null : number(row.created_by, 0),
        createdAt: number(row.created_at),
        updatedAt: number(row.updated_at),
      })),
    });
    return;
  }
  if (req.method !== 'POST') {
    error(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    return;
  }
  const action = text(req.body?.action);
  if (action !== 'announce-template-save' && action !== 'announce-template-delete') {
    error(res, 400, 'UNKNOWN_ANNOUNCEMENT_ACTION', '未知的模板操作');
    return;
  }
  const editor = await requireActor(req, res, 'major.edit');
  if (!editor) return;
  if (action === 'announce-template-delete') {
    const id = text(req.body?.id).trim().slice(0, 128);
    if (!id) {
      error(res, 400, 'INVALID_TEMPLATE', 'id is required');
      return;
    }
    await sql`DELETE FROM exam_announcement_templates WHERE id = ${id}`;
    res.status(200).json({ ok: true });
    return;
  }
  const title = text(req.body?.title).trim().slice(0, ANNOUNCEMENT_TITLE_MAX);
  const body = text(req.body?.body).trim().slice(0, ANNOUNCEMENT_BODY_MAX);
  if (!title && !body) {
    error(res, 400, 'EMPTY_TEMPLATE', '模板标题或内容至少填一项');
    return;
  }
  const style = parseAnnouncementStyle(req.body?.style);
  const level = text(req.body?.level) === 'urgent' ? 'urgent' : 'normal';
  const now = Date.now();
  const rows = (await sql`
    INSERT INTO exam_announcement_templates (id, title, body, style, level, created_by, created_at, updated_at)
    VALUES (${`tpl_${randomUUID().replace(/-/g, '').slice(0, 20)}`}, ${title}, ${body}, ${style}, ${level}, ${editor.id}, ${now}, ${now})
    RETURNING id
  `) as unknown as Row[];
  await writeAudit(editor, 'exam.announcement.template_save', 'exam_announcement_template', text(rows[0]?.id), {
    title: title.slice(0, 80),
  });
  res.status(200).json({ ok: true, data: { id: text(rows[0]?.id), title, body, style, level, updatedAt: now } });
}

/** 公告正文图片的同源地址（后台编辑器插入、教室大屏加载都用它）。 */
export function announcementImageUrl(id: number | string): string {
  return `/api/exams?resource=announcement-image&id=${id}`;
}

/**
 * 教室端回执上报（`action=announce-ack`，无需登录，但要求设备已绑定且未撤销）。
 *
 * 每条 = 「这台设备把这条公告展示满 ANNOUNCEMENT_SEEN_MIN_MS（3 秒）」，
 * seenMs 是本次实际停留时长。同一台设备同一条公告只保留一行：
 * 重复上报累加 seen_ms 与 seen_count，不写流水行——免费版数据库扛不住按次写。
 * 返回 recorded 让客户端知道哪些已被接受，离线补报时按这个收敛本地缓冲。
 */
async function handleAnnouncementAck(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    error(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    return;
  }
  const instanceId = text(req.body?.instanceId).trim().slice(0, 128);
  if (!instanceId) {
    error(res, 400, 'INVALID_INSTANCE', 'instanceId is required');
    return;
  }
  const seen = normalizeSeenItems(req.body?.seen, ANNOUNCEMENT_ACK_BATCH_MAX);
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
  const now = Date.now();
  // 客户端版本取设备心跳写入的那一列，设备不必在回执里重复上报。
  const clientVersion = text(device.client_version).slice(0, 40);
  if (!seen.length) {
    res.status(200).json({ ok: true, recorded: 0, serverTime: now });
    return;
  }
  const payload = JSON.stringify(seen.map((item) => ({ id: item.id, seen_ms: item.seenMs })));
  const recorded = (await sql`
    INSERT INTO exam_announcement_receipts (announcement_id, instance_id, grade_id, class_id,
      delivered_at, first_seen_at, last_seen_at, seen_count, seen_ms, client_version, updated_at)
    SELECT item.id, ${instanceId}, ${text(device.grade_id)}, ${text(device.class_id)},
      ${now}, ${now}, ${now}, 1, COALESCE(item.seen_ms, 0), ${clientVersion}, ${now}
    FROM jsonb_to_recordset(${payload}::jsonb) AS item(id text, seen_ms bigint)
    JOIN exam_announcements a ON a.id = item.id
    ON CONFLICT (announcement_id, instance_id) DO UPDATE SET
      last_seen_at = EXCLUDED.last_seen_at,
      seen_count = exam_announcement_receipts.seen_count + 1,
      seen_ms = exam_announcement_receipts.seen_ms + EXCLUDED.seen_ms,
      first_seen_at = COALESCE(exam_announcement_receipts.first_seen_at, EXCLUDED.first_seen_at),
      delivered_at = COALESCE(exam_announcement_receipts.delivered_at, EXCLUDED.delivered_at),
      grade_id = EXCLUDED.grade_id,
      class_id = EXCLUDED.class_id,
      client_version = EXCLUDED.client_version,
      updated_at = EXCLUDED.updated_at
    RETURNING announcement_id
  `) as unknown as Row[];
  res.status(200).json({ ok: true, recorded: recorded.length, serverTime: now });
}

/**
 * 管理端回执明细（`?resource=announcement-receipts&id=xx`）：公告 + 应达设备逐台状态。
 *
 * 以设备为准（2026-09-25 定稿）：设备是公告的实际受众，管理端只看"哪间教室看过/没看过"。
 * 设备清单按公告范围现算，再按当前账号的数据范围过滤，班级管理员只能看到自己范围内的教室。
 */
async function handleAnnouncementReceipts(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await requireActor(req, res, 'major.read');
  if (!actor) return;
  const id = text(req.query?.id).trim().slice(0, 128);
  if (!id) {
    error(res, 400, 'INVALID_ANNOUNCEMENT', 'id is required');
    return;
  }
  await ensureTableOnce();
  const sql = database();
  const announcementRows = (await sql`
    SELECT id, title, level, style, scope_type, scope_ids, created_at, expires_at, status
    FROM exam_announcements WHERE id = ${id}
  `) as unknown as Row[];
  const announcement = announcementRows[0];
  if (!announcement) {
    error(res, 404, 'ANNOUNCEMENT_NOT_FOUND', '公告不存在');
    return;
  }
  if (!actorSeesAnnouncement(actor, announcement, await loadClassGradeIds(sql, actor))) {
    // 范围外一律按"找不到"处理，避免通过回执接口旁路出别人范围内的公告。
    error(res, 404, 'ANNOUNCEMENT_NOT_FOUND', '公告不存在');
    return;
  }
  const scopeType = text(announcement.scope_type) || 'all';
  const scopeIdsJson = JSON.stringify(idList(announcement.scope_ids));
  const rows = (await sql`
    SELECT d.instance_id, d.grade_id, d.class_id, d.client_version,
      d.last_seen_at AS device_last_seen_at,
      r.delivered_at, r.first_seen_at, r.last_seen_at AS receipt_last_seen_at, r.seen_count, r.seen_ms
    FROM device_instances d
    LEFT JOIN exam_announcement_receipts r
      ON r.announcement_id = ${id} AND r.instance_id = d.instance_id
    WHERE d.revoked = FALSE
      AND d.is_management = FALSE
      AND (${scopeType} = 'all'
        OR (${scopeType} = 'grade' AND d.grade_id IN (SELECT jsonb_array_elements_text(${scopeIdsJson}::jsonb)))
        OR (${scopeType} = 'class' AND d.class_id IN (SELECT jsonb_array_elements_text(${scopeIdsJson}::jsonb))))
    ORDER BY d.grade_id, d.class_id, d.instance_id
  `) as unknown as Row[];
  const visible = rows.filter((row) =>
    hasAllScope(actor) ? true : canAccessClass(actor, text(row.grade_id), text(row.class_id)),
  );
  const receipts = visible.map((row) => ({
    instanceId: text(row.instance_id),
    gradeId: text(row.grade_id),
    classId: text(row.class_id),
    deliveredAt: row.delivered_at == null ? null : number(row.delivered_at),
    firstSeenAt: row.first_seen_at == null ? null : number(row.first_seen_at),
    lastSeenAt: row.receipt_last_seen_at == null ? null : number(row.receipt_last_seen_at),
    seenCount: number(row.seen_count, 0),
    seenMs: number(row.seen_ms, 0),
    clientVersion: text(row.client_version),
    lastSeenOnlineAt: number(row.device_last_seen_at, 0),
  }));
  res.status(200).json({
    ok: true,
    announcement: {
      id: text(announcement.id),
      title: text(announcement.title),
      level: text(announcement.level) === 'urgent' ? 'urgent' : 'normal',
      style: parseAnnouncementStyle(announcement.style),
      scopeType,
      scopeIds: idList(announcement.scope_ids),
      createdAt: number(announcement.created_at),
      expiresAt: announcement.expires_at == null ? null : number(announcement.expires_at),
      status: resolveAnnouncementStatus(
        { status: announcement.status, expiresAt: number(announcement.expires_at, 0) },
        Date.now(),
      ),
    },
    summary: {
      target: receipts.length,
      delivered: receipts.filter((item) => item.deliveredAt != null).length,
      seen: receipts.filter((item) => item.firstSeenAt != null).length,
    },
    receipts,
  });
}

/**
 * 公告正文图片。
 *
 * - `GET ?resource=announcement-image&id=N` 不鉴权：教室大屏按公告正文里的 Markdown
 *   直接拉图，和公告正文一样属于对教室公开的内容（与作者端公告图片接口同口径）。
 * - 上传（`action=announce-image-upload`，默认）与删除（`action=announce-image-delete`）
 *   需要 major.edit：图片存在学校库里，正文只保存 `/api/exams?resource=...&id=N` 这样的同源地址。
 */
async function handleAnnouncementImage(req: VercelRequest, res: VercelResponse): Promise<void> {
  await ensureTableOnce();
  const sql = database();
  if (req.method === 'GET') {
    const id = Number(Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id);
    if (!Number.isFinite(id)) {
      error(res, 400, 'INVALID_IMAGE', 'id is required');
      return;
    }
    const rows = (await sql`
      SELECT mime_type, encode(data, 'base64') AS data_b64 FROM exam_announcement_images WHERE id = ${id}
    `) as unknown as Row[];
    if (!rows.length) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', String(rows[0].mime_type || 'application/octet-stream'));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(Buffer.from(String(rows[0].data_b64 || ''), 'base64'));
    return;
  }
  if (req.method !== 'POST') {
    error(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    return;
  }
  const actor = await requireActor(req, res, 'major.edit');
  if (!actor) return;
  const action = text(req.body?.action);
  if (action === 'announce-image-delete') {
    const id = Number(req.body?.id);
    if (!Number.isFinite(id)) {
      error(res, 400, 'INVALID_IMAGE', 'id is required');
      return;
    }
    await sql`DELETE FROM exam_announcement_images WHERE id = ${id}`;
    res.status(200).json({ ok: true });
    return;
  }
  const mimeType = text(req.body?.mimeType);
  if (!isAnnouncementImageType(mimeType)) {
    error(res, 400, 'INVALID_IMAGE_TYPE', '仅支持 PNG、JPG、WEBP、GIF');
    return;
  }
  const raw = text(req.body?.base64).replace(/^data:[^;]+;base64,/, '');
  const data = Buffer.from(raw, 'base64');
  if (!data.length || data.length > ANNOUNCEMENT_IMAGE_MAX_BYTES) {
    error(res, 400, 'INVALID_IMAGE_SIZE', '图片不能为空且不能超过 2MB');
    return;
  }
  const filename = text(req.body?.filename).slice(0, 255) || 'image';
  const rows = (await sql`
    INSERT INTO exam_announcement_images (filename, mime_type, data, size_bytes, created_at)
    VALUES (${filename}, ${mimeType}, decode(${raw}, 'base64'), ${data.length}, ${Date.now()})
    RETURNING id
  `) as unknown as Row[];
  const id = number(rows[0]?.id, 0);
  res.status(200).json({
    ok: true,
    image: { id, filename, mimeType, sizeBytes: data.length, url: announcementImageUrl(id) },
  });
}

/**
 * 公告路由负责的 GET resource → 处理函数。
 * 与考试记录那条线同一个理由：入口（api/exams.ts）的分发直接读这张表导出的名单，
 * 不在这里写一遍 if、入口再手抄一份——手抄就会漏，漏了请求会静默掉到快照接口。
 */
const ANNOUNCEMENT_GET_HANDLERS: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void>> = {
  announcements: handleAnnouncementList,
  'device-announcements': handleDeviceAnnouncements,
  'announcement-receipts': handleAnnouncementReceipts,
  'announcement-stats': handleAnnouncementStats,
};

/**
 * 入口分发用：这些 resource 归公告路由处理。
 * `announcement-image` 与 `announcement-templates` 是任意方法都归它，所以不在 GET 映射表里。
 */
export const EXAM_ANNOUNCEMENT_GET_RESOURCES: ReadonlySet<string> = new Set([
  ...Object.keys(ANNOUNCEMENT_GET_HANDLERS),
  'announcement-image',
  'announcement-templates',
]);

export async function handleExamAnnouncementRoute(
  req: VercelRequest,
  res: VercelResponse,
  actionName = '',
): Promise<void> {
  const resource = text(req.query?.resource);
  if (
    resource === 'announcement-image' ||
    actionName === 'announce-image-upload' ||
    actionName === 'announce-image-delete'
  ) {
    await handleAnnouncementImage(req, res);
    return;
  }
  if (req.method === 'GET') {
    const getHandler = ANNOUNCEMENT_GET_HANDLERS[resource];
    if (getHandler) {
      await getHandler(req, res);
      return;
    }
  }
  // 模板：任意方法 + actionName 前缀都归它（与 announcement-image 同一类）。
  if (resource === 'announcement-templates' || actionName.startsWith('announce-template-')) {
    await handleAnnouncementTemplates(req, res);
    return;
  }
  if (actionName === 'announce-remind' || text(req.body?.action) === 'announce-remind') {
    await handleAnnouncementRemind(req, res);
    return;
  }
  if (actionName === 'announce-ack' || text(req.body?.action) === 'announce-ack') {
    await handleAnnouncementAck(req, res);
    return;
  }
  if (actionName === 'announce-send' || text(req.body?.action) === 'announce-send') {
    await handleAnnouncementSend(req, res);
    return;
  }
  if (actionName === 'announce-revoke' || text(req.body?.action) === 'announce-revoke') {
    await handleAnnouncementRevoke(req, res);
    return;
  }
  error(res, 400, 'UNKNOWN_ANNOUNCEMENT_ACTION', '未知的公告操作');
}
