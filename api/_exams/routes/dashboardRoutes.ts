// api/_exams/routes/dashboardRoutes.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireActor } from "../../_auth.js";
import { hasAllScope } from "../../../src/shared/permissionRules.js";
import { database, ensureTableOnce, missingRelation } from "../db.js";
import {
  aggregateStats,
  buildGradeDistribution,
  buildOngoing,
  buildRecentEnded,
  buildSubjectDistribution,
  buildUpcoming,
  actorVisibleGradeIds,
  classifyDevices,
  collectScopedItems,
  dashboardScopeLabel,
  scopedDevices,
  type DashboardClass,
  type DashboardDevice,
  type DashboardGrade,
  type DashboardMajor,
} from "../dashboard.js";

type ExamRowLite = {
  majors?: unknown;
  grades?: unknown;
  classes?: unknown;
  updated_at?: number | string | null;
};

export async function handleDashboard(
  req: VercelRequest,
  res: VercelResponse,
  startedAt: number,
): Promise<void> {
  const actor = await requireActor(req, res, "overview.read");
  if (!actor) return;
  const sql = database();
  const selectRow = async (): Promise<ExamRowLite[]> =>
    (await sql`SELECT majors, grades, classes, updated_at FROM exam_data WHERE id=1`) as unknown as ExamRowLite[];
  let rows: ExamRowLite[];
  try {
    rows = await selectRow();
  } catch (error) {
    if (!missingRelation(error)) throw error;
    await ensureTableOnce();
    rows = await selectRow();
  }
  const row = rows[0] ?? {};
  const majors = (Array.isArray(row.majors) ? row.majors : []) as DashboardMajor[];
  const grades = (Array.isArray(row.grades) ? row.grades : []) as DashboardGrade[];
  const classes = (Array.isArray(row.classes) ? row.classes : []) as DashboardClass[];
  const deviceRows = (await sql`
    SELECT instance_id, grade_id, class_id, revoked, is_management, last_seen_at, current_exam, exam_start, exam_end, status
    FROM device_instances
  `) as unknown as DashboardDevice[];
  const now = Date.now();
  const items = collectScopedItems(majors, grades, classes, actor);
  const devices = scopedDevices(deviceRows, actor, classes);
  const deviceStats = classifyDevices(devices, now);
  const updatedAt = Number(row.updated_at ?? 0);
  res.setHeader("Server-Timing", "app;dur=" + (Date.now() - startedAt));
  res.status(200).json({
    ok: true,
    scopeLabel: dashboardScopeLabel(actor, grades),
    isAllScope:
      actor.permissions.includes("*") ||
      actor.scopes.some(scope => scope.type === "all"),
    stats: { ...aggregateStats(items, now), ...deviceStats },
    ongoing: buildOngoing(items, now),
    upcoming: buildUpcoming(items, now),
    recentEnded: buildRecentEnded(items, now),
    subjectDistribution: buildSubjectDistribution(items, now),
    gradeDistribution: buildGradeDistribution(items, grades, hasAllScope(actor) ? undefined : actorVisibleGradeIds(actor, grades)),
    updatedAt,
  });
}
