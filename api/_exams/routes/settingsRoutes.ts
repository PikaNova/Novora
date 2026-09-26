// 系统设置相关路由：设计策略更新、数据重置（需管理员权限）。
// 从 api/exams.ts 拆分而来，逻辑与对外行为保持不变。
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { acquireWriteSlotOrReject, database, ensureTableOnce, missingRelation } from '../db.js';
import { allScope } from '../permissions.js';
import { type AdminActor, isPasswordRequired, requireActor, writeAudit } from '../../_auth.js';

export type DesignPolicyRule = {
  id: string;
  scope: 'school' | 'grade' | 'class' | 'device';
  scopeId: string;
  designId: string;
};

export function sanitizeDesignPolicyRules(rawRules: unknown): DesignPolicyRule[] {
  const rules = Array.isArray(rawRules) ? rawRules : [];
  const allowedScopes = new Set(['school', 'grade', 'class', 'device']);
  const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const parsedRules = rules.slice(0, 500).flatMap((rawRule: unknown, index: number) => {
    const rule = asRecord(rawRule);
    const scope = String(rule?.scope ?? '');
    const scopeId = String(rule?.scopeId ?? '')
      .trim()
      .slice(0, 128);
    const designId = String(rule?.designId ?? '')
      .trim()
      .slice(0, 80);
    if (!allowedScopes.has(scope) || !designId || (scope !== 'school' && !scopeId)) return [];
    return [
      {
        id: String(rule?.id ?? `design-${index}`).slice(0, 128),
        scope: scope as DesignPolicyRule['scope'],
        scopeId: scope === 'school' ? '*' : scopeId,
        designId,
      },
    ];
  });
  const schoolRule = [...parsedRules].reverse().find((rule) => rule.scope === 'school');
  return schoolRule ? [schoolRule] : parsedRules;
}

export async function handleDesignPolicy(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
  let designActor: AdminActor | null = null;
  if (await isPasswordRequired()) {
    designActor = await requireActor(req, res, 'settings.edit');
    if (!designActor) return;
    if (!allScope(designActor)) {
      res.status(403).json({ ok: false, error: '只有全校范围管理员可以下发考试端设计' });
      return;
    }
  }
  const source = req.body?.designPolicy;
  const rules = sanitizeDesignPolicyRules(source?.rules);
  const updatedAt = Date.now();
  const designPolicy = { rules, updatedAt };
  if (!(await acquireWriteSlotOrReject(req, res))) return;
  const run = async () =>
    sql`UPDATE exam_data SET design_policy=${JSON.stringify(designPolicy)}::jsonb, updated_at=${updatedAt} WHERE id=1`;
  try {
    await run();
  } catch (error) {
    if (!missingRelation(error)) throw error;
    await ensureTableOnce();
    await run();
  }
  await writeAudit(designActor, 'settings.design-policy', 'exam_data', '1', { ruleCount: rules.length });
  res.status(200).json({ ok: true, designPolicy, updatedAt });
  return;
}

export function sanitizeMajorBatchPresets(raw: unknown): { subjectGroups: unknown[]; timeGroups: unknown[] } {
  const src = (raw ?? {}) as Record<string, unknown>;
  return {
    subjectGroups: Array.isArray(src.subjectGroups) ? src.subjectGroups.slice(0, 500) : [],
    timeGroups: Array.isArray(src.timeGroups) ? src.timeGroups.slice(0, 500) : [],
  };
}

export async function handleMajorBatchPresets(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
  let presetActor: AdminActor | null = null;
  if (await isPasswordRequired()) {
    presetActor = await requireActor(req, res, 'majorBatch.preset_edit');
    if (!presetActor) return;
  }
  const source =
    (req.body as Record<string, unknown>)?.presets ?? (req.body as Record<string, unknown>)?.majorBatchPresets;
  const presets = sanitizeMajorBatchPresets(source);
  const updatedAt = Date.now();
  const payload = { ...presets, updatedAt };
  if (!(await acquireWriteSlotOrReject(req, res))) return;
  const run = async () =>
    sql`UPDATE exam_data SET major_batch_presets=${JSON.stringify(payload)}::jsonb, updated_at=${updatedAt} WHERE id=1`;
  try {
    await run();
  } catch (error) {
    if (!missingRelation(error)) throw error;
    await ensureTableOnce();
    await run();
  }
  await writeAudit(presetActor, 'settings.major-batch-presets', 'exam_data', '1', {
    subjectGroups: payload.subjectGroups.length,
    timeGroups: payload.timeGroups.length,
  });
  res.status(200).json({ ok: true, majorBatchPresets: payload, updatedAt });
}

export type ResetCategoryFlags = {
  resetMajor: boolean;
  resetWeekly: boolean;
  resetSchool: boolean;
  resetSettings: boolean;
  resetDevices: boolean;
};

export function resolveResetCategories(categories: readonly string[]): ResetCategoryFlags {
  const resetAll = categories.includes('all');
  const resetSchool = resetAll || categories.includes('school');
  return {
    resetMajor: resetAll || categories.includes('major'),
    resetWeekly: resetAll || categories.includes('weekly'),
    resetSchool,
    resetSettings: resetAll || categories.includes('settings'),
    resetDevices: resetAll || categories.includes('devices') || resetSchool,
  };
}

export async function handleResetData(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
  let resetActor: AdminActor | null = null;
  if (await isPasswordRequired()) {
    resetActor = await requireActor(req, res, 'initialization.run');
    if (!resetActor) return;
    if (!allScope(resetActor)) {
      res.status(403).json({ ok: false, error: '只有超级管理员可以重置数据库' });
      return;
    }
  }
  const categories = Array.isArray(req.body?.categories) ? req.body.categories.map(String) : [];
  const resetFlags = resolveResetCategories(categories);
  const { resetMajor, resetWeekly, resetSchool, resetSettings, resetDevices } = resetFlags;
  if (!Object.values(resetFlags).some(Boolean)) {
    res.status(400).json({ ok: false, error: '请选择需要重置的数据' });
    return;
  }
  await ensureTableOnce();
  if (!(await acquireWriteSlotOrReject(req, res))) return;
  const at = Date.now();
  await sql.transaction((transaction) => [
    transaction`UPDATE exam_data SET
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
      -- 重置会改掉整片数据，必须推进对应域的修订号：否则携带 baseRevisions 的客户端
      -- 会拿着重置前的修订号通过并发校验，把刚清掉的数据又写回来。
      revisions = COALESCE(revisions, '{}'::jsonb) || jsonb_build_object(
        'major', COALESCE((revisions->>'major')::bigint, 0) + CASE WHEN ${resetMajor} THEN 1 ELSE 0 END,
        'weekly', COALESCE((revisions->>'weekly')::bigint, 0) + CASE WHEN ${resetWeekly || resetSchool} THEN 1 ELSE 0 END,
        'schedule', COALESCE((revisions->>'schedule')::bigint, 0) + CASE WHEN ${resetSettings} THEN 1 ELSE 0 END,
        'alerts', COALESCE((revisions->>'alerts')::bigint, 0) + CASE WHEN ${resetSettings} THEN 1 ELSE 0 END,
        'grades', COALESCE((revisions->>'grades')::bigint, 0) + CASE WHEN ${resetSchool} THEN 1 ELSE 0 END,
        'classes', COALESCE((revisions->>'classes')::bigint, 0) + CASE WHEN ${resetSchool} THEN 1 ELSE 0 END,
        'initialization', COALESCE((revisions->>'initialization')::bigint, 0) + CASE WHEN ${resetSchool} THEN 1 ELSE 0 END
      ),
      updated_at=${at} WHERE id=1`,
    ...(resetDevices
      ? [transaction`DELETE FROM device_instances`, transaction`DELETE FROM classisland_plugin_instances`]
      : []),
  ]);
  await writeAudit(resetActor, 'database.reset', 'exam_data', '1', {
    categories,
  });
  res.status(200).json({ ok: true, updatedAt: at });
  return;
}
