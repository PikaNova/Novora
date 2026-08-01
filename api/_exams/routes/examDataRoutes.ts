// 核心考试数据读写路由：初始化引导信息、带 ETag 的读取、乐观并发写入。
// 从 api/exams.ts 拆分而来，逻辑与对外行为保持不变。
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  database,
  ensureTableOnce,
  ensureUpdatedAtBigIntOnce,
  missingRelation,
  updatedAtIntegerOverflow,
} from "../db.js";
import { examPayload } from "../payload.js";
import {
  isolateQuickMajorCreate,
  sanitizeStaleSnapshot,
  validateMutation,
} from "../permissions.js";
import { computeRemovedScopeIds } from "../scopeCleanup.js";
import type { ExamRow, UpdatedRow } from "../types.js";
import {
  type AdminActor,
  authSql,
  ensureGeneratedRecoveryKey,
  isPasswordRequired,
  requireActor,
  writeAudit,
} from "../../_auth.js";

export async function handleBootstrap(req: VercelRequest, res: VercelResponse, startedAt: number): Promise<void> {
  const sql = database();
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  const instanceId = String(req.query?.instanceId ?? "")
    .trim()
    .slice(0, 128);
  if (!instanceId) {
    res.status(400).json({ ok: false, error: "instanceId is required" });
    return;
  }
  const selectBootstrap = async (): Promise<ExamRow[]> =>
    (await sql`
      SELECT items, title, majors, active_major_id, alerts, weekly_plans, schedule_mode,
             active_weekly_plan_id, active_weekly_plan_by_class, weekly_conflict_policy, grades, classes, initialization, design_policy, updated_at,
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
  res.setHeader("Server-Timing", `app;dur=${Date.now() - startedAt}`);
  const hasDeviceBinding =
    row.bound_class_id != null || row.binding_is_management === true;
  res
    .status(200)
    .json({
      ...examPayload(row),
      binding: hasDeviceBinding
        ? {
            gradeId: row.bound_grade_id ?? "",
            classId: row.bound_class_id ?? "",
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
  const selectRow = async (): Promise<ExamRow[]> =>
    (await sql`SELECT items, title, majors, active_major_id, alerts, weekly_plans, schedule_mode, active_weekly_plan_id, active_weekly_plan_by_class, weekly_conflict_policy, grades, classes, initialization, design_policy, updated_at FROM exam_data WHERE id = 1`) as unknown as ExamRow[];
  let rows: ExamRow[];
  try {
    rows = await selectRow();
  } catch (e) {
    if (!missingRelation(e)) throw e;
    await ensureTableOnce();
    rows = await selectRow();
  }
  const row = rows[0] ?? {
    items: [],
    title: "",
    majors: [],
    active_major_id: "",
    alerts: null,
    weekly_plans: [],
    schedule_mode: "major-only",
    active_weekly_plan_id: "",
    active_weekly_plan_by_class: {},
    weekly_conflict_policy: null,
    updated_at: 0,
  };
  const payload = examPayload(row);
  const body = JSON.stringify(payload);
  const etag = `\"exam-${payload.updatedAt}\"`;
  res.setHeader("ETag", etag);
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }
  res.setHeader("Server-Timing", `app;dur=${Date.now() - startedAt}`);
  res.setHeader("Content-Type", "application/json");
  res.status(200).send(body);
  return;
}

export async function handleExamDataPost(req: VercelRequest, res: VercelResponse, startedAt: number): Promise<void> {
  const sql = database();
  let actor: AdminActor | null = null;
  if (await isPasswordRequired()) {
    actor = await requireActor(req, res);
    if (!actor) return;
  }
  const { action } = req.body ?? {};
  if (!Array.isArray(req.body?.items)) {
    res.status(400).json({ ok: false, error: "items must be an array" });
    return;
  }
  if (actor || action === "initialize") {
    let currentRows: ExamRow[];
    try {
      currentRows =
        (await sql`SELECT items, title, majors, active_major_id, alerts, weekly_plans, schedule_mode, active_weekly_plan_id, active_weekly_plan_by_class, weekly_conflict_policy, grades, classes, initialization, design_policy, updated_at FROM exam_data WHERE id=1`) as unknown as ExamRow[];
    } catch (error) {
      if (!missingRelation(error)) throw error;
      await ensureTableOnce();
      currentRows =
        (await sql`SELECT items, title, majors, active_major_id, alerts, weekly_plans, schedule_mode, active_weekly_plan_id, active_weekly_plan_by_class, weekly_conflict_policy, grades, classes, initialization, design_policy, updated_at FROM exam_data WHERE id=1`) as unknown as ExamRow[];
    }
    const currentPayload = examPayload(currentRows[0] ?? {});
    if (action === "initialize") {
      const alreadyInitialized =
        Number((currentPayload.initialization as any)?.completedAt ?? 0) >
          0 ||
        currentPayload.grades.length > 0 ||
        currentPayload.classes.length > 0;
      if (alreadyInitialized) {
        res
          .status(409)
          .json({
            ok: false,
            code: "ALREADY_INITIALIZED",
            error:
              "云端已经存在学校结构，请在年级与班级页面调整，或先从数据维护中重置学校数据",
            requestId: res.getHeader("X-Request-Id"),
          });
        return;
      }
      if (actor && !actor.permissions.includes("*")) {
        res
          .status(403)
          .json({
            ok: false,
            code: "PERMISSION_DENIED",
            error: "只有超级管理员可以执行首次初始化",
            requestId: res.getHeader("X-Request-Id"),
          });
        return;
      }
    }
    if (actor) {
      req.body = sanitizeStaleSnapshot(
        actor,
        currentPayload,
        isolateQuickMajorCreate(actor, currentPayload, req.body ?? {}),
      );
      const permission = validateMutation(
        actor,
        currentPayload,
        req.body ?? {},
      );
      if (!permission.ok) {
        res
          .status(403)
          .json({
            ...permission,
            code: "PERMISSION_DENIED",
            requestId: res.getHeader("X-Request-Id"),
          });
        return;
      }
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
    baseUpdatedAt,
  } = req.body ?? {};
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
    ({ removedGradeIds, removedClassIds } = computeRemovedScopeIds(
      priorGrades,
      priorClasses,
      grades,
      classes,
    ));
  }
  const runUpdate = async (): Promise<UpdatedRow[]> =>
    (await sql`
      UPDATE exam_data
      SET items = ${JSON.stringify(items)}::jsonb,
          title = ${typeof title === "string" ? title : ""},
          majors = ${JSON.stringify(Array.isArray(majors) ? majors : [])}::jsonb,
          active_major_id = ${typeof activeMajorId === "string" ? activeMajorId : ""},
          alerts = ${alerts && typeof alerts === "object" ? JSON.stringify(alerts) : null}::jsonb,
          -- 周测字段：仅当请求显式携带时才覆写，否则 COALESCE 保留既有值（后台保存不带周测→不丢失）。
          weekly_plans = COALESCE(${weeklyPlans !== undefined ? JSON.stringify(Array.isArray(weeklyPlans) ? weeklyPlans : []) : null}::jsonb, weekly_plans),
          schedule_mode = COALESCE(${typeof scheduleMode === "string" ? scheduleMode : null}, schedule_mode),
          active_weekly_plan_id = COALESCE(${typeof activeWeeklyPlanId === "string" ? activeWeeklyPlanId : null}, active_weekly_plan_id),
          active_weekly_plan_by_class = COALESCE(${activeWeeklyPlanIdByClassId && typeof activeWeeklyPlanIdByClassId === "object" ? JSON.stringify(activeWeeklyPlanIdByClassId) : null}::jsonb, active_weekly_plan_by_class),
          grades = COALESCE(${Array.isArray(grades) ? JSON.stringify(grades) : null}::jsonb, grades),
          classes = COALESCE(${Array.isArray(classes) ? JSON.stringify(classes) : null}::jsonb, classes),
          initialization = COALESCE(${initialization && typeof initialization === "object" ? JSON.stringify(initialization) : null}::jsonb, initialization),
          weekly_conflict_policy = COALESCE(${weeklyConflictPolicy && typeof weeklyConflictPolicy === "object" ? JSON.stringify(weeklyConflictPolicy) : null}::jsonb, weekly_conflict_policy),
          updated_at = ${updatedAt}
      -- 显式 BIGINT：毫秒级 baseUpdatedAt 不能在与字面量 0 比较时被 PostgreSQL 推断为 INTEGER。
      WHERE id = 1 AND (${expectedVersion}::BIGINT <= 0 OR updated_at = ${expectedVersion}::BIGINT)
      RETURNING updated_at
    `) as unknown as UpdatedRow[];
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
      (await sql`SELECT items, title, majors, active_major_id, alerts, weekly_plans, schedule_mode, active_weekly_plan_id, active_weekly_plan_by_class, weekly_conflict_policy, grades, classes, initialization, design_policy, updated_at FROM exam_data WHERE id = 1`) as unknown as ExamRow[];
    const row = rows[0] ?? {};
    const { ok: _ok, ...remote } = examPayload(row);
    res
      .status(409)
      .json({
        ok: false,
        code: "DATA_CONFLICT",
        error: "云端数据已发生变化",
        remote,
        requestId: res.getHeader("X-Request-Id"),
      });
    return;
  }
  if (removedGradeIds.length || removedClassIds.length) {
    const authDb = authSql();
    await Promise.all([
      ...removedClassIds.map(
        (classId) =>
          authDb`DELETE FROM app_user_scopes WHERE scope_type = 'class' AND class_id = ${classId}`,
      ),
      ...removedGradeIds.map(
        (gradeId) =>
          authDb`DELETE FROM app_user_scopes WHERE scope_type = 'grade' AND grade_id = ${gradeId}`,
      ),
    ]);
  }
  const recoveryKey =
    action === "initialize" ? await ensureGeneratedRecoveryKey() : null;
  if (actor)
    await writeAudit(actor, "exam-data.update", "exam_data", "1", {
      updatedAt,
    });
  res.setHeader("Server-Timing", `app;dur=${Date.now() - startedAt}`);
  res
    .status(200)
    .json({ ok: true, updatedAt, ...(recoveryKey ? { recoveryKey } : {}) });
  return;
}
