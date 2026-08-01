// 系统设置相关路由：设计策略更新、数据重置（需管理员权限）。
// 从 api/exams.ts 拆分而来，逻辑与对外行为保持不变。
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database, ensureTableOnce, missingRelation } from "../db.js";
import { allScope } from "../permissions.js";
import {
  type AdminActor,
  isPasswordRequired,
  requireActor,
  writeAudit,
} from "../../_auth.js";

export async function handleDesignPolicy(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
  let designActor: AdminActor | null = null;
  if (await isPasswordRequired()) {
    designActor = await requireActor(req, res, "settings.edit");
    if (!designActor) return;
    if (!allScope(designActor)) {
      res
        .status(403)
        .json({ ok: false, error: "只有全校范围管理员可以下发考试端设计" });
      return;
    }
  }
  const source = req.body?.designPolicy;
  const rawRules = Array.isArray(source?.rules) ? source.rules : [];
  const allowedScopes = new Set(["school", "grade", "class", "device"]);
  const parsedRules = rawRules
    .slice(0, 500)
    .flatMap((rule: any, index: number) => {
      const scope = String(rule?.scope ?? "");
      const scopeId = String(rule?.scopeId ?? "")
        .trim()
        .slice(0, 128);
      const designId = String(rule?.designId ?? "")
        .trim()
        .slice(0, 80);
      if (
        !allowedScopes.has(scope) ||
        !designId ||
        (scope !== "school" && !scopeId)
      )
        return [];
      return [
        {
          id: String(rule?.id ?? `design-${index}`).slice(0, 128),
          scope,
          scopeId: scope === "school" ? "*" : scopeId,
          designId,
        },
      ];
    });
  const schoolRule = [...parsedRules]
    .reverse()
    .find((rule) => rule.scope === "school");
  const rules = schoolRule ? [schoolRule] : parsedRules;
  const updatedAt = Date.now();
  const designPolicy = { rules, updatedAt };
  const run = async () =>
    sql`UPDATE exam_data SET design_policy=${JSON.stringify(designPolicy)}::jsonb, updated_at=${updatedAt} WHERE id=1`;
  try {
    await run();
  } catch (error) {
    if (!missingRelation(error)) throw error;
    await ensureTableOnce();
    await run();
  }
  await writeAudit(
    designActor,
    "settings.design-policy",
    "exam_data",
    "1",
    { ruleCount: rules.length },
  );
  res.status(200).json({ ok: true, designPolicy, updatedAt });
  return;
}

export async function handleResetData(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
  let resetActor: AdminActor | null = null;
  if (await isPasswordRequired()) {
    resetActor = await requireActor(req, res, "initialization.run");
    if (!resetActor) return;
    if (!allScope(resetActor)) {
      res
        .status(403)
        .json({ ok: false, error: "只有超级管理员可以重置数据库" });
      return;
    }
  }
  await ensureTableOnce();
  const categories = Array.isArray(req.body?.categories)
    ? req.body.categories.map(String)
    : [];
  const resetAll = categories.includes("all");
  const resetMajor = resetAll || categories.includes("major");
  const resetWeekly = resetAll || categories.includes("weekly");
  const resetSchool = resetAll || categories.includes("school");
  const resetSettings = resetAll || categories.includes("settings");
  const resetDevices =
    resetAll || categories.includes("devices") || resetSchool;
  if (
    ![
      resetMajor,
      resetWeekly,
      resetSchool,
      resetSettings,
      resetDevices,
    ].some(Boolean)
  ) {
    res.status(400).json({ ok: false, error: "请选择需要重置的数据" });
    return;
  }
  const at = Date.now();
  await sql`UPDATE exam_data SET
    items=CASE WHEN ${resetMajor} THEN '[]'::jsonb ELSE items END,
    title=CASE WHEN ${resetMajor} THEN '' ELSE title END,
    majors=CASE WHEN ${resetMajor} THEN '[]'::jsonb ELSE majors END,
    active_major_id=CASE WHEN ${resetMajor} THEN '' ELSE active_major_id END,
    weekly_plans=CASE WHEN ${resetWeekly || resetSchool} THEN '[]'::jsonb ELSE weekly_plans END,
    active_weekly_plan_id=CASE WHEN ${resetWeekly || resetSchool} THEN '' ELSE active_weekly_plan_id END,
    active_weekly_plan_by_class=CASE WHEN ${resetWeekly || resetSchool} THEN '{}'::jsonb ELSE active_weekly_plan_by_class END,
    grades=CASE WHEN ${resetSchool} THEN '[]'::jsonb ELSE grades END,
    classes=CASE WHEN ${resetSchool} THEN '[]'::jsonb ELSE classes END,
    initialization=CASE WHEN ${resetSchool} THEN '{}'::jsonb ELSE initialization END,
    alerts=CASE WHEN ${resetSettings} THEN NULL ELSE alerts END,
    schedule_mode=CASE WHEN ${resetSettings} THEN 'major-only' ELSE schedule_mode END,
    weekly_conflict_policy=CASE WHEN ${resetSettings} THEN NULL ELSE weekly_conflict_policy END,
    design_policy=CASE WHEN ${resetSettings} THEN '{"rules":[],"updatedAt":0}'::jsonb ELSE design_policy END,
    updated_at=${at} WHERE id=1`;
  if (resetDevices)
    await Promise.all([
      sql`DELETE FROM device_instances`,
      sql`DELETE FROM classisland_plugin_instances`,
    ]);
  await writeAudit(resetActor, "database.reset", "exam_data", "1", {
    categories,
  });
  res.status(200).json({ ok: true, updatedAt: at });
  return;
}
