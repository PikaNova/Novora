// 核心考试数据读写路由：初始化引导信息、带 ETag 的读取、乐观并发写入。
// 从 api/exams.ts 拆分而来，逻辑与对外行为保持不变。
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  acquireWriteSlotOrReject,
  database,
  ensureTableOnce,
  ensureUpdatedAtBigIntOnce,
  missingRelation,
  updatedAtIntegerOverflow,
} from '../db.js';
import { examPayload } from '../payload.js';
import { examEtag, isCurrentSnapshotRequest, matchesIfNoneMatch } from '../../../src/shared/examContracts.js';
import {
  EXAM_REVISION_DOMAINS,
  EXAM_REVISION_DOMAIN_FIELDS,
  hasExamSaveDomain,
  parseExamRevisions,
  type ExamRevisionDomain,
} from '../../../src/shared/examSaveDiff.js';
import { isEdgeDeployment } from '../../_deployTarget.js';
import {
  freezeArchivedMajors,
  isolateQuickMajorCreate,
  sanitizeStaleSnapshot,
  validateMutation,
} from '../permissions.js';
import { computeRemovedScopeIds } from '../scopeCleanup.js';
import { preserveServerLifecycleFields } from '../examSnapshotPatch.js';
import { projectCurrentExamRecords } from '../examRecordProjection.js';
import { quickMajorTransitions } from '../quickMajorTransitions.js';
import { operationLogKey } from '../operationLog.js';
import type { ExamRow, UpdatedRow } from '../types.js';
import {
  type AdminActor,
  authSql,
  ensureGeneratedRecoveryKey,
  isPasswordRequired,
  requireActor,
  writeAudit,
} from '../../_auth.js';

export async function handleBootstrap(req: VercelRequest, res: VercelResponse, startedAt: number): Promise<void> {
  const sql = database();
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  const instanceId = String(req.query?.instanceId ?? '')
    .trim()
    .slice(0, 128);
  if (!instanceId) {
    res.status(400).json({ ok: false, error: 'instanceId is required' });
    return;
  }
  const selectBootstrap = async (): Promise<ExamRow[]> =>
    (await sql`
      SELECT items, title, majors, active_major_id, alerts, weekly_plans, schedule_mode,
             active_weekly_plan_id, active_weekly_plan_by_class, weekly_conflict_policy, grades, classes, initialization, design_policy, major_batch_presets, exam_metadata, lifecycle, revisions, updated_at,
             (SELECT grade_id FROM device_instances WHERE instance_id = ${instanceId}) AS bound_grade_id,
             (SELECT class_id FROM device_instances WHERE instance_id = ${instanceId}) AS bound_class_id,
             (SELECT revoked FROM device_instances WHERE instance_id = ${instanceId}) AS binding_revoked,
             (SELECT is_management FROM device_instances WHERE instance_id = ${instanceId}) AS binding_is_management
      FROM exam_data
      WHERE id = 1
    `) as unknown as ExamRow[];
  let rows: ExamRow[];
  try {
    rows = await selectBootstrap();
  } catch (error) {
    if (!missingRelation(error)) throw error;
    await ensureTableOnce();
    rows = await selectBootstrap();
  }
  const row = rows[0] ?? {};
  res.setHeader('Server-Timing', `app;dur=${Date.now() - startedAt}`);
  const hasDeviceBinding = row.bound_class_id != null || row.binding_is_management === true;
  res.status(200).json({
    ...examPayload(row),
    binding: hasDeviceBinding
      ? {
          gradeId: row.bound_grade_id ?? '',
          classId: row.bound_class_id ?? '',
          revoked: row.binding_revoked === true,
          isManagement: row.binding_is_management === true,
        }
      : null,
  });
  return;
}

export async function handleExamDataGet(req: VercelRequest, res: VercelResponse, startedAt: number): Promise<void> {
  const sql = database();
  // 已移除按实例内存缓存 GET 响应体的机制（原 getCache/GET_CACHE_MS）：
  // Vercel 上同一部署会有多个独立的“热”函数实例，写入只会让
  // 处理这次写入的那个实例清空自己的内存缓存，其余实例仍会在最多 3 秒内
  // 继续把自己之前缓存的旧数据（例如年级/班级还是空的）返回给恰好被路由过去的请求，
  // 这正是“刚建好班级、第一次进后台却提示未创建，刷新一次才出现”的根本原因。
  // 现在每次 GET 都直接查库，只用 ETag 做协商缓存（304），保证任何时刻返回的
  // 都是当次真实查询到的最新数据。
  const selectUpdatedAt = async (): Promise<Array<{ updated_at?: unknown }>> =>
    (await sql`SELECT updated_at FROM exam_data WHERE id = 1`) as unknown as Array<{ updated_at?: unknown }>;
  const selectRow = async (): Promise<ExamRow[]> =>
    (await sql`SELECT items, title, majors, active_major_id, alerts, weekly_plans, schedule_mode, active_weekly_plan_id, active_weekly_plan_by_class, weekly_conflict_policy, grades, classes, initialization, design_policy, major_batch_presets, exam_metadata, lifecycle, revisions, updated_at FROM exam_data WHERE id = 1`) as unknown as ExamRow[];

  let versionRows: Array<{ updated_at?: unknown }>;
  try {
    versionRows = await selectUpdatedAt();
  } catch (error) {
    if (!missingRelation(error)) throw error;
    await ensureTableOnce();
    versionRows = await selectUpdatedAt();
  }
  const currentVersion = versionRows[0]?.updated_at;
  const edgeDeployment = isEdgeDeployment();
  const snapshotRequest = String(req.query?.resource ?? '') === 'snapshot';
  if (isCurrentSnapshotRequest({ edgeDeployment, requestedVersion: req.query?.v, currentVersion })) {
    // 版本化快照（仅 Vercel）：URL 里带着版本号，数据变化后客户端会换用新 URL，
    // 所以这一份内容可以交给边缘长期缓存，命中时既不进函数也不查 Neon。
    // 不使用 ETag 协商：这里要的就是「边缘直接返回整份快照」。
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=3600');
  } else {
    // 改造前的行为：只做 ETag 协商缓存。版本已过期的快照请求也落到这里，
    // 并显式 no-store，避免把当前内容错误地缓存到旧版本 URL 下。
    if (edgeDeployment && snapshotRequest) res.setHeader('Cache-Control', 'private, no-store');
    const etag = examEtag(currentVersion);
    res.setHeader('ETag', etag);
    // 用弱比较：反代 gzip 后会把强 ETag 改写成 W/ 形式，严格相等会让 304 永远不命中。
    // 兼容大小写：真实 Node 请求头是小写，个别适配器/测试会传原样的大小写。
    if (matchesIfNoneMatch(req.headers['if-none-match'] ?? req.headers['If-None-Match'], etag)) {
      res.status(304).end();
      return;
    }
  }

  let rows: ExamRow[];
  try {
    rows = await selectRow();
  } catch (error) {
    if (!missingRelation(error)) throw error;
    await ensureTableOnce();
    rows = await selectRow();
  }
  const row = rows[0] ?? {
    items: [],
    title: '',
    majors: [],
    active_major_id: '',
    alerts: null,
    weekly_plans: [],
    schedule_mode: 'major-only',
    active_weekly_plan_id: '',
    active_weekly_plan_by_class: {},
    weekly_conflict_policy: null,
    updated_at: 0,
  };
  const payload = examPayload(row);
  const body = JSON.stringify(payload);
  res.setHeader('Server-Timing', `app;dur=${Date.now() - startedAt}`);
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(body);
  return;
}

/**
 * 409 时只回冲突域的载荷：按修订域取出对应的保存域字段，再附上修订号与文档版本。
 * 客户端用自己手里的基线补全其余字段（其余域按定义与基线一致），所以服务端不必回整份快照。
 */
function scopedConflictRemote(
  payload: ReturnType<typeof examPayload>,
  domains: readonly ExamRevisionDomain[],
): Record<string, unknown> {
  const record = payload as unknown as Record<string, unknown>;
  const scoped: Record<string, unknown> = {};
  for (const domain of domains) {
    for (const field of EXAM_REVISION_DOMAIN_FIELDS[domain]) scoped[field] = record[field];
  }
  scoped.revisions = payload.revisions ?? {};
  scoped.updatedAt = payload.updatedAt;
  return scoped;
}

export async function handleExamDataPost(req: VercelRequest, res: VercelResponse, startedAt: number): Promise<void> {
  const sql = database();
  let actor: AdminActor | null = null;
  if (await isPasswordRequired()) {
    actor = await requireActor(req, res);
    if (!actor) return;
  }
  const { action } = req.body ?? {};
  // 客户端现在只提交改动的域（见 src/shared/examSaveDiff.ts），所以不再强制要求携带 items；
  // 但仍要求至少携带一个可写域，避免空请求白占一次全局写槽。
  const requestBody = (req.body ?? {}) as Record<string, unknown>;
  if (!hasExamSaveDomain(requestBody)) {
    res.status(400).json({ ok: false, error: 'request must carry at least one exam data field' });
    return;
  }
  if (Object.prototype.hasOwnProperty.call(requestBody, 'items') && !Array.isArray(requestBody.items)) {
    res.status(400).json({ ok: false, error: 'items must be an array' });
    return;
  }
  // 快速考试走本地优先保存管道，没有显式动作；这里留下旧 majors 以便保存后补记生命周期转换。
  let priorMajors: unknown = null;
  /** 本次保存中被「归档只读」挡下的考试 id（仅用于回传提示，不影响写入）。 */
  let frozenArchivedIds: string[] = [];
  let frozenArchivedMajors: unknown[] = [];
  if (actor || action === 'initialize') {
    let currentRows: ExamRow[];
    try {
      currentRows =
        (await sql`SELECT items, title, majors, active_major_id, alerts, weekly_plans, schedule_mode, active_weekly_plan_id, active_weekly_plan_by_class, weekly_conflict_policy, grades, classes, initialization, design_policy, major_batch_presets, exam_metadata, lifecycle, revisions, updated_at FROM exam_data WHERE id=1`) as unknown as ExamRow[];
    } catch (error) {
      if (!missingRelation(error)) throw error;
      await ensureTableOnce();
      currentRows =
        (await sql`SELECT items, title, majors, active_major_id, alerts, weekly_plans, schedule_mode, active_weekly_plan_id, active_weekly_plan_by_class, weekly_conflict_policy, grades, classes, initialization, design_policy, major_batch_presets, revisions, updated_at FROM exam_data WHERE id=1`) as unknown as ExamRow[];
    }
    const currentPayload = examPayload(currentRows[0] ?? {});
    priorMajors = currentPayload.majors;
    // Scope 删除后，旧 token 仍可能在有效期内；无 scope 的受限账号不得借助
    // stale-snapshot 清洗把越权写请求伪装成“无变化”并获得 200。
    if (actor && !actor.permissions.includes('*') && actor.scopes.length === 0) {
      res.status(403).json({
        ok: false,
        code: 'PERMISSION_DENIED',
        error: '当前账号已没有可管理的数据范围',
        requestId: res.getHeader('X-Request-Id'),
      });
      return;
    }
    if (action === 'initialize') {
      const alreadyInitialized =
        Number((currentPayload.initialization as { completedAt?: unknown } | null)?.completedAt ?? 0) > 0 ||
        currentPayload.grades.length > 0 ||
        currentPayload.classes.length > 0;
      if (alreadyInitialized) {
        res.status(409).json({
          ok: false,
          code: 'ALREADY_INITIALIZED',
          error: '云端已经存在学校结构，请在年级与班级页面调整，或先从数据维护中重置学校数据',
          requestId: res.getHeader('X-Request-Id'),
        });
        return;
      }
      if (actor && !actor.permissions.includes('*')) {
        res.status(403).json({
          ok: false,
          code: 'PERMISSION_DENIED',
          error: '只有超级管理员可以执行首次初始化',
          requestId: res.getHeader('X-Request-Id'),
        });
        return;
      }
    }
    if (actor) {
      // 归档只读优先于其它清洗：已归档的考试任何人都改不动，需要修改先取消归档。
      const archived = freezeArchivedMajors(
        currentPayload,
        isolateQuickMajorCreate(actor, currentPayload, req.body ?? {}),
      );
      frozenArchivedIds = archived.frozenIds;
      frozenArchivedMajors = archived.frozenMajors;
      const sanitized = sanitizeStaleSnapshot(actor, currentPayload, archived.body);
      const permission = validateMutation(actor, currentPayload, sanitized);
      if (!permission.ok) {
        res.status(403).json({
          ...permission,
          code: 'PERMISSION_DENIED',
          requestId: res.getHeader('X-Request-Id'),
        });
        return;
      }
      // 运行期字段（暂停/延长/发布/结束/归档…）是服务端后台动作写的，客户端整份保存不能覆盖：
      // 否则一次普通编辑就会把它们抹掉，教室端（读权威快照）永远看不到这些更改。
      // 放在权限校验之后：权限判定看的是客户端意图，不该被这次存储层修正影响。
      req.body = Array.isArray(sanitized.majors)
        ? { ...sanitized, majors: preserveServerLifecycleFields(currentPayload.majors, sanitized.majors) }
        : sanitized;
    }
  }
  const {
    items,
    title,
    majors,
    activeMajorId,
    alerts,
    weeklyPlans,
    scheduleMode,
    activeWeeklyPlanId,
    activeWeeklyPlanIdByClassId,
    weeklyConflictPolicy,
    grades,
    classes,
    initialization,
    metadata,
    lifecycle,
    baseUpdatedAt,
  } = req.body ?? {};
  // 域级提交：未携带的域保持服务端当前值（曾是无条件覆写，会把客户端没发的域清空）。
  // 用 hasOwnProperty 判定「携带」，从而保留「显式 null = 清空 alerts」的语义。
  const writeBody = (req.body ?? {}) as Record<string, unknown>;
  const carries = (field: string) => Object.prototype.hasOwnProperty.call(writeBody, field);
  const hasItems = carries('items');
  const hasTitle = carries('title');
  const hasMajors = carries('majors');
  const hasActiveMajorId = carries('activeMajorId');
  const hasAlerts = carries('alerts');
  const hasWeeklyPlans = carries('weeklyPlans');
  const hasScheduleMode = carries('scheduleMode');
  const hasActiveWeeklyPlanId = carries('activeWeeklyPlanId');
  const hasActiveWeeklyPlanByClass = carries('activeWeeklyPlanIdByClassId');
  const hasGrades = carries('grades');
  const hasClasses = carries('classes');
  const hasInitialization = carries('initialization');
  const hasWeeklyConflictPolicy = carries('weeklyConflictPolicy');
  // 每个新值只序列化一次：既要写进列，也要参与「这个域到底变没变」的判定。
  const itemsJson = JSON.stringify(Array.isArray(items) ? items : []);
  const titleText = typeof title === 'string' ? title : '';
  const majorsJson = JSON.stringify(Array.isArray(majors) ? majors : []);
  const activeMajorIdText = typeof activeMajorId === 'string' ? activeMajorId : '';
  const alertsJson = alerts && typeof alerts === 'object' ? JSON.stringify(alerts) : null;
  const weeklyPlansJson =
    weeklyPlans !== undefined ? JSON.stringify(Array.isArray(weeklyPlans) ? weeklyPlans : []) : null;
  const scheduleModeText = typeof scheduleMode === 'string' ? scheduleMode : null;
  const activeWeeklyPlanIdText = typeof activeWeeklyPlanId === 'string' ? activeWeeklyPlanId : null;
  const activeWeeklyPlanByClassJson =
    activeWeeklyPlanIdByClassId && typeof activeWeeklyPlanIdByClassId === 'object'
      ? JSON.stringify(activeWeeklyPlanIdByClassId)
      : null;
  const weeklyConflictPolicyJson =
    weeklyConflictPolicy && typeof weeklyConflictPolicy === 'object' ? JSON.stringify(weeklyConflictPolicy) : null;
  const gradesJson = Array.isArray(grades) ? JSON.stringify(grades) : null;
  const classesJson = Array.isArray(classes) ? JSON.stringify(classes) : null;
  const initializationJson =
    initialization && typeof initialization === 'object' ? JSON.stringify(initialization) : null;
  // ── 域级并发判定（v2.8.8）──
  // 客户端携带 baseRevisions 时，只校验「本次真要写的修订域」：改不同域的两台设备不再互相 409；
  // 同一个域被并发修改仍然冲突（修订号不等）。老客户端不带该字段，退回整行 updated_at 比较。
  // 客户端提供了 baseRevisions 就按域校验：表里没有的域按 0 处理（服务端计数从 0 开始）。
  // 「没带这个字段」与「表里全是 0」必须区分——前者是老客户端/老快照，只能走整行版本比较。
  const baseRevisionsInput = writeBody.baseRevisions as unknown;
  const hasBaseRevisions =
    !!baseRevisionsInput && typeof baseRevisionsInput === 'object' && !Array.isArray(baseRevisionsInput);
  const baseRevisions = hasBaseRevisions ? parseExamRevisions(baseRevisionsInput) : {};
  const guardedRevisionDomains = hasBaseRevisions
    ? EXAM_REVISION_DOMAINS.filter((domain) => EXAM_REVISION_DOMAIN_FIELDS[domain].some((field) => carries(field)))
    : [];
  const guardedRevisionSet = new Set<ExamRevisionDomain>(guardedRevisionDomains);
  const usesRevisions = guardedRevisionSet.size > 0;
  const guardsRevisionDomain = (domain: ExamRevisionDomain) => guardedRevisionSet.has(domain);
  const baseRevisionOf = (domain: ExamRevisionDomain) =>
    guardedRevisionSet.has(domain) ? (baseRevisions[domain] ?? 0) : 0;
  const expectedVersion = Number(baseUpdatedAt ?? 0);
  const updatedAt = Date.now();
  let removedGradeIds: string[] = [];
  let removedClassIds: string[] = [];
  if (Array.isArray(grades) || Array.isArray(classes)) {
    const priorRows = (await sql`SELECT grades, classes FROM exam_data WHERE id = 1`) as unknown as Array<{
      grades: unknown;
      classes: unknown;
    }>;
    const priorGrades = Array.isArray(priorRows[0]?.grades)
      ? (priorRows[0].grades as Array<Record<string, unknown>>)
      : [];
    const priorClasses = Array.isArray(priorRows[0]?.classes)
      ? (priorRows[0].classes as Array<Record<string, unknown>>)
      : [];
    ({ removedGradeIds, removedClassIds } = computeRemovedScopeIds(priorGrades, priorClasses, grades, classes));
  }
  if (!(await acquireWriteSlotOrReject(req, res))) return;
  const runUpdate = async (): Promise<UpdatedRow[]> => {
    const results = await sql.transaction((transaction) => [
      transaction`
      UPDATE exam_data
      SET items = CASE WHEN ${hasItems}::boolean THEN ${itemsJson}::jsonb ELSE items END,
          title = CASE WHEN ${hasTitle}::boolean THEN ${titleText} ELSE title END,
          majors = CASE WHEN ${hasMajors}::boolean THEN ${majorsJson}::jsonb ELSE majors END,
          active_major_id = CASE WHEN ${hasActiveMajorId}::boolean THEN ${activeMajorIdText} ELSE active_major_id END,
          alerts = CASE WHEN ${hasAlerts}::boolean THEN ${alertsJson}::jsonb ELSE alerts END,
          -- 周测字段：仅当请求显式携带时才覆写，否则 COALESCE 保留既有值（后台保存不带周测→不丢失）。
          weekly_plans = COALESCE(${weeklyPlansJson}::jsonb, weekly_plans),
          schedule_mode = COALESCE(${scheduleModeText}, schedule_mode),
          active_weekly_plan_id = COALESCE(${activeWeeklyPlanIdText}, active_weekly_plan_id),
          active_weekly_plan_by_class = COALESCE(${activeWeeklyPlanByClassJson}::jsonb, active_weekly_plan_by_class),
          grades = COALESCE(${gradesJson}::jsonb, grades),
          classes = COALESCE(${classesJson}::jsonb, classes),
          initialization = COALESCE(${initializationJson}::jsonb, initialization),
          exam_metadata = COALESCE(${metadata && typeof metadata === 'object' ? JSON.stringify(metadata) : null}::jsonb, exam_metadata),
          lifecycle = COALESCE(${lifecycle && typeof lifecycle === 'object' ? JSON.stringify(lifecycle) : null}::jsonb, lifecycle),
          weekly_conflict_policy = COALESCE(${weeklyConflictPolicyJson}::jsonb, weekly_conflict_policy),
          -- 域级修订号：只有该域的列真的变了才 +1（IS DISTINCT FROM 读的是本语句更新前的旧值）。
          -- 没有任何变化时修订号不动，所以「提交相同的域」不会平白制造别人的冲突。
          revisions = COALESCE(revisions, '{}'::jsonb) || jsonb_build_object(
            'major', COALESCE((revisions->>'major')::bigint, 0) + CASE WHEN
              (${hasMajors}::boolean AND majors IS DISTINCT FROM ${majorsJson}::jsonb)
              OR (${hasItems}::boolean AND items IS DISTINCT FROM ${itemsJson}::jsonb)
              OR (${hasTitle}::boolean AND title IS DISTINCT FROM ${titleText})
              OR (${hasActiveMajorId}::boolean AND active_major_id IS DISTINCT FROM ${activeMajorIdText})
              THEN 1 ELSE 0 END,
            'alerts', COALESCE((revisions->>'alerts')::bigint, 0) + CASE WHEN
              (${hasAlerts}::boolean AND alerts IS DISTINCT FROM ${alertsJson}::jsonb)
              THEN 1 ELSE 0 END,
            'weekly', COALESCE((revisions->>'weekly')::bigint, 0) + CASE WHEN
              (${hasWeeklyPlans}::boolean AND weekly_plans IS DISTINCT FROM ${weeklyPlansJson}::jsonb)
              OR (${hasActiveWeeklyPlanId}::boolean AND active_weekly_plan_id IS DISTINCT FROM ${activeWeeklyPlanIdText})
              OR (${hasActiveWeeklyPlanByClass}::boolean AND active_weekly_plan_by_class IS DISTINCT FROM ${activeWeeklyPlanByClassJson}::jsonb)
              THEN 1 ELSE 0 END,
            'schedule', COALESCE((revisions->>'schedule')::bigint, 0) + CASE WHEN
              (${hasScheduleMode}::boolean AND schedule_mode IS DISTINCT FROM ${scheduleModeText})
              OR (${hasWeeklyConflictPolicy}::boolean AND weekly_conflict_policy IS DISTINCT FROM ${weeklyConflictPolicyJson}::jsonb)
              THEN 1 ELSE 0 END,
            'grades', COALESCE((revisions->>'grades')::bigint, 0) + CASE WHEN
              (${hasGrades}::boolean AND grades IS DISTINCT FROM ${gradesJson}::jsonb)
              THEN 1 ELSE 0 END,
            'classes', COALESCE((revisions->>'classes')::bigint, 0) + CASE WHEN
              (${hasClasses}::boolean AND classes IS DISTINCT FROM ${classesJson}::jsonb)
              THEN 1 ELSE 0 END,
            'initialization', COALESCE((revisions->>'initialization')::bigint, 0) + CASE WHEN
              (${hasInitialization}::boolean AND initialization IS DISTINCT FROM ${initializationJson}::jsonb)
              THEN 1 ELSE 0 END
          ),
          updated_at = ${updatedAt}
      -- 携带 baseRevisions 时按域判定并发（只看本次要写的域），否则沿用整行版本比较。
      -- 显式 BIGINT：毫秒级 baseUpdatedAt 不能在与字面量 0 比较时被 PostgreSQL 推断为 INTEGER。
      WHERE id = 1 AND CASE WHEN ${usesRevisions}::boolean THEN (
              (NOT ${guardsRevisionDomain('major')}::boolean OR COALESCE((revisions->>'major')::bigint, 0) = ${baseRevisionOf('major')}::bigint)
          AND (NOT ${guardsRevisionDomain('alerts')}::boolean OR COALESCE((revisions->>'alerts')::bigint, 0) = ${baseRevisionOf('alerts')}::bigint)
          AND (NOT ${guardsRevisionDomain('weekly')}::boolean OR COALESCE((revisions->>'weekly')::bigint, 0) = ${baseRevisionOf('weekly')}::bigint)
          AND (NOT ${guardsRevisionDomain('schedule')}::boolean OR COALESCE((revisions->>'schedule')::bigint, 0) = ${baseRevisionOf('schedule')}::bigint)
          AND (NOT ${guardsRevisionDomain('grades')}::boolean OR COALESCE((revisions->>'grades')::bigint, 0) = ${baseRevisionOf('grades')}::bigint)
          AND (NOT ${guardsRevisionDomain('classes')}::boolean OR COALESCE((revisions->>'classes')::bigint, 0) = ${baseRevisionOf('classes')}::bigint)
          AND (NOT ${guardsRevisionDomain('initialization')}::boolean OR COALESCE((revisions->>'initialization')::bigint, 0) = ${baseRevisionOf('initialization')}::bigint)
        ) ELSE (${expectedVersion}::BIGINT <= 0 OR updated_at = ${expectedVersion}::BIGINT) END
      RETURNING updated_at, revisions
    `,
      projectCurrentExamRecords(transaction),
    ]);
    return (results[0] ?? []) as unknown as UpdatedRow[];
  };
  let updatedRows: UpdatedRow[];
  try {
    updatedRows = await runUpdate();
  } catch (e) {
    if (missingRelation(e)) {
      await ensureTableOnce();
      updatedRows = await runUpdate();
    } else if (updatedAtIntegerOverflow(e)) {
      // 旧实例数据库的 updated_at 仍为 INTEGER：自动升级后重试本次保存。
      await ensureUpdatedAtBigIntOnce();
      updatedRows = await runUpdate();
    } else {
      throw e;
    }
  }
  if (!updatedRows?.length) {
    const rows =
      (await sql`SELECT items, title, majors, active_major_id, alerts, weekly_plans, schedule_mode, active_weekly_plan_id, active_weekly_plan_by_class, weekly_conflict_policy, grades, classes, initialization, design_policy, major_batch_presets, exam_metadata, lifecycle, revisions, updated_at FROM exam_data WHERE id = 1`) as unknown as ExamRow[];
    const row = rows[0] ?? {};
    const currentPayload = examPayload(row);
    const { ok: _ok, ...remote } = currentPayload;
    // 只列出「本次携带、且基线修订号已经对不上」的域：客户端据此知道是哪个域被并发改了，
    // 而不是把整份快照都当成冲突。老客户端（不带 baseRevisions）得到空数组，行为与改动前一致。
    const conflicts = guardedRevisionDomains.filter(
      (domain) => (currentPayload.revisions?.[domain] ?? 0) !== (baseRevisions[domain] ?? 0),
    );
    // 客户端带了 baseRevisions 时只回冲突域：其余域按定义与它的基线一致，客户端拿手里的基线补全即可。
    // 老客户端（不带 baseRevisions）拿不到域级信息，仍然回整份 remote，行为与改动前一致。
    const scopedRemote = usesRevisions && conflicts.length ? scopedConflictRemote(currentPayload, conflicts) : null;
    res.status(409).json({
      ok: false,
      code: 'DATA_CONFLICT',
      error: '云端数据已发生变化',
      conflicts,
      revisions: currentPayload.revisions ?? {},
      remote: scopedRemote ?? remote,
      ...(scopedRemote ? { remotePartial: true } : {}),
      requestId: res.getHeader('X-Request-Id'),
    });
    return;
  }
  if (removedGradeIds.length || removedClassIds.length) {
    const authDb = authSql();
    await Promise.all([
      ...removedClassIds.map(
        (classId) => authDb`DELETE FROM app_user_scopes WHERE scope_type = 'class' AND class_id = ${classId}`,
      ),
      ...removedGradeIds.map(
        (gradeId) => authDb`DELETE FROM app_user_scopes WHERE scope_type = 'grade' AND grade_id = ${gradeId}`,
      ),
    ]);
  }
  const recoveryKey = action === 'initialize' ? await ensureGeneratedRecoveryKey() : null;
  // 快速考试的生命周期转换补记操作日志：本地优先路径也要留下「谁在什么时候改了什么」。
  const quickTransitions = quickMajorTransitions(priorMajors, majors);
  if (quickTransitions.length) {
    await Promise.all(
      quickTransitions.map(
        (transition) => sql`
        INSERT INTO exam_record_operations (
          idempotency_key, action, source_record_id, result_record_id,
          actor_id, from_status, to_status, reason, created_at
        )
        VALUES (${operationLogKey(transition.recordId, transition.action, updatedAt)}, ${transition.action},
          ${transition.recordId}, ${transition.recordId}, ${actor?.id ?? null},
          ${transition.fromStatus}, ${transition.toStatus}, '', ${updatedAt})
        ON CONFLICT (idempotency_key) DO NOTHING
      `,
      ),
    );
  }
  if (actor)
    await writeAudit(actor, 'exam-data.update', 'exam_data', '1', {
      updatedAt,
    });
  res.setHeader('Server-Timing', `app;dur=${Date.now() - startedAt}`);
  res.status(200).json({
    ok: true,
    updatedAt,
    // 客户端用它推进「本次提交过的域」的并发基线，其余域保持旧修订号（本地内容仍基于旧版本）。
    revisions: parseExamRevisions((updatedRows[0] as { revisions?: unknown } | undefined)?.revisions),
    ...(recoveryKey ? { recoveryKey } : {}),
    ...(frozenArchivedIds.length ? { ignoredArchivedMajors: frozenArchivedIds } : {}),
    // 冻结条目的服务端版本：客户端用它把本地副本纠回来（否则本地显示删除/改名、刷新又回来）。
    ...(frozenArchivedMajors.length ? { frozenMajors: frozenArchivedMajors } : {}),
  });
  return;
}
