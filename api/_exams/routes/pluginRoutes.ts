// ClassIsland 插件协议相关路由：元信息、配对流程、状态查询/启动信息、查看端心跳。
// 从 api/exams.ts 拆分而来，逻辑与对外行为保持不变。
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database, ensureTableOnce } from "../db.js";
import { examPayload } from "../payload.js";
import {
  CLASSISLAND_API_VERSION,
  PLUGIN_ID_RE,
  PLUGIN_PAIR_TTL_MS,
  PLUGIN_TOKEN_RE,
  PLUGIN_VIEWER_ONLINE_MS,
  classIslandApiMeta,
  classLabel,
  equalHash,
  pluginCredentials,
  resolvePluginExams,
  sha256,
} from "../plugin.js";
import type { ExamRow, PluginInstanceRow } from "../types.js";

export async function handlePluginApi(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Cache-Control", "public, max-age=300");
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  res.status(200).json({ ok: true, ...classIslandApiMeta() });
  return;
}

export async function handlePluginPairStart(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  const credentials = pluginCredentials(req.body ?? {});
  const pairToken = String(req.body?.pairToken ?? "").trim();
  if (!credentials || !PLUGIN_TOKEN_RE.test(pairToken)) {
    res
      .status(400)
      .json({ ok: false, error: "Invalid plugin credentials" });
    return;
  }
  await ensureTableOnce();
  const existing =
    (await sql`SELECT client_secret_hash FROM classisland_plugin_instances WHERE plugin_instance_id=${credentials.instanceId}`) as unknown as PluginInstanceRow[];
  const secretHash = sha256(credentials.secret);
  if (
    existing[0]?.client_secret_hash &&
    !equalHash(existing[0].client_secret_hash, secretHash)
  ) {
    res
      .status(401)
      .json({ ok: false, error: "Plugin credentials rejected" });
    return;
  }
  const now = Date.now();
  await sql`
    INSERT INTO classisland_plugin_instances
      (plugin_instance_id, client_secret_hash, pair_token_hash, pair_expires_at, paired, created_at, updated_at)
    VALUES (${credentials.instanceId}, ${secretHash}, ${sha256(pairToken)}, ${now + PLUGIN_PAIR_TTL_MS}, FALSE, ${now}, ${now})
    ON CONFLICT (plugin_instance_id) DO UPDATE SET
      client_secret_hash=CASE
        WHEN classisland_plugin_instances.client_secret_hash='' THEN EXCLUDED.client_secret_hash
        ELSE classisland_plugin_instances.client_secret_hash
      END,
      pair_token_hash=EXCLUDED.pair_token_hash, pair_expires_at=EXCLUDED.pair_expires_at,
      paired=FALSE, updated_at=EXCLUDED.updated_at
  `;
  res
    .status(200)
    .json({
      ok: true,
      ...classIslandApiMeta(),
      pairExpiresAt: now + PLUGIN_PAIR_TTL_MS,
    });
  return;
}

export async function handlePluginPairInfo(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  const pairToken = String(req.query?.token ?? "").trim();
  if (!PLUGIN_TOKEN_RE.test(pairToken)) {
    res.status(400).json({ ok: false, error: "Invalid pairing token" });
    return;
  }
  await ensureTableOnce();
  const rows =
    (await sql`SELECT plugin_instance_id, pair_expires_at, paired FROM classisland_plugin_instances WHERE pair_token_hash=${sha256(pairToken)}`) as unknown as PluginInstanceRow[];
  const plugin = rows[0];
  if (!plugin || Number(plugin.pair_expires_at ?? 0) < Date.now()) {
    res.status(410).json({ ok: false, error: "Pairing request expired" });
    return;
  }
  const viewerInstanceId = String(req.query?.viewerInstanceId ?? "")
    .trim()
    .slice(0, 128);
  const examRows =
    (await sql`SELECT grades, classes FROM exam_data WHERE id=1`) as unknown as ExamRow[];
  const payload = examPayload(examRows[0] ?? {});
  const deviceRows = viewerInstanceId
    ? ((await sql`SELECT grade_id, class_id, revoked, is_management, last_seen_at FROM device_instances WHERE instance_id=${viewerInstanceId}`) as unknown as Array<{
        grade_id: string;
        class_id: string;
        revoked: boolean;
        is_management: boolean;
        last_seen_at: number | string;
      }>)
    : [];
  const device = deviceRows[0];
  const binding = device
    ? {
        gradeId: device.grade_id ?? "",
        classId: device.class_id ?? "",
        revoked: device.revoked === true,
        isManagement: device.is_management === true,
        classTag: classLabel(
          payload,
          device.grade_id ?? "",
          device.class_id ?? "",
        ),
      }
    : null;
  res
    .status(200)
    .json({
      ok: true,
      ...classIslandApiMeta(),
      pluginInstanceId: plugin.plugin_instance_id,
      expiresAt: Number(plugin.pair_expires_at),
      binding,
    });
  return;
}

export async function handlePluginPairConfirm(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  const pairToken = String(req.body?.pairToken ?? "").trim();
  const viewerInstanceId = String(req.body?.viewerInstanceId ?? "")
    .trim()
    .slice(0, 128);
  if (!PLUGIN_TOKEN_RE.test(pairToken) || !viewerInstanceId) {
    res.status(400).json({ ok: false, error: "Incomplete pairing data" });
    return;
  }
  await ensureTableOnce();
  const rows =
    (await sql`SELECT plugin_instance_id, pair_expires_at FROM classisland_plugin_instances WHERE pair_token_hash=${sha256(pairToken)}`) as unknown as PluginInstanceRow[];
  const plugin = rows[0];
  if (!plugin || Number(plugin.pair_expires_at ?? 0) < Date.now()) {
    res.status(410).json({ ok: false, error: "Pairing request expired" });
    return;
  }
  const examRows =
    (await sql`SELECT grades, classes FROM exam_data WHERE id=1`) as unknown as ExamRow[];
  const payload = examPayload(examRows[0] ?? {});
  const deviceRows =
    (await sql`SELECT grade_id, class_id, revoked, is_management FROM device_instances WHERE instance_id=${viewerInstanceId}`) as unknown as Array<{
      grade_id: string;
      class_id: string;
      revoked: boolean;
      is_management: boolean;
    }>;
  const device = deviceRows[0];
  if (
    !device ||
    device.revoked ||
    device.is_management ||
    !device.grade_id ||
    !device.class_id
  ) {
    res
      .status(409)
      .json({
        ok: false,
        code: "VIEWER_CLASS_REQUIRED",
        error: device?.is_management
          ? "管理设备不能绑定 ClassIsland，请先改为班级考试端"
          : "看板尚未绑定有效班级，请先在看板首页完成绑定",
      });
    return;
  }
  const gradeId = String(device.grade_id);
  const classId = String(device.class_id);
  const gradeValid = (payload.grades as any[]).some(
    (item) => item?.id === gradeId && item?.enabled !== false,
  );
  const classValid = (payload.classes as any[]).some(
    (item) =>
      item?.id === classId &&
      item?.gradeId === gradeId &&
      item?.enabled !== false,
  );
  if (!gradeValid || !classValid) {
    res.status(400).json({ ok: false, error: "Invalid class binding" });
    return;
  }
  await sql`UPDATE classisland_plugin_instances SET grade_id=${gradeId}, class_id=${classId}, viewer_instance_id=${viewerInstanceId}, paired=TRUE, pair_token_hash=NULL, pair_expires_at=NULL, updated_at=${Date.now()} WHERE plugin_instance_id=${plugin.plugin_instance_id}`;
  res
    .status(200)
    .json({
      ok: true,
      ...classIslandApiMeta(),
      binding: {
        gradeId,
        classId,
        classTag: classLabel(payload, gradeId, classId),
      },
    });
  return;
}

// action 为 "plugin-pair-status" 或 "plugin-bootstrap" 时共用同一段逻辑，仅在其中
// 对 action 做一次内部判断（与拆分前完全一致）。
export async function handlePluginPairStatusOrBootstrap(
  req: VercelRequest,
  res: VercelResponse,
  action: "plugin-pair-status" | "plugin-bootstrap",
): Promise<void> {
  const sql = database();
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  const credentials = pluginCredentials(req.body ?? {});
  if (!credentials) {
    res
      .status(400)
      .json({ ok: false, error: "Invalid plugin credentials" });
    return;
  }
  await ensureTableOnce();
  const rows =
    (await sql`SELECT * FROM classisland_plugin_instances WHERE plugin_instance_id=${credentials.instanceId}`) as unknown as PluginInstanceRow[];
  const plugin = rows[0];
  if (
    !plugin ||
    !equalHash(plugin.client_secret_hash, sha256(credentials.secret))
  ) {
    res
      .status(401)
      .json({ ok: false, error: "Plugin credentials rejected" });
    return;
  }
  const viewerInstanceId = String(plugin.viewer_instance_id ?? "");
  const deviceRows = viewerInstanceId
    ? ((await sql`SELECT grade_id, class_id, revoked, is_management, last_seen_at FROM device_instances WHERE instance_id=${viewerInstanceId}`) as unknown as Array<{
        grade_id: string;
        class_id: string;
        revoked: boolean;
        is_management: boolean;
        last_seen_at: number | string;
      }>)
    : [];
  const device = deviceRows[0];
  const viewerBindingValid =
    !!device &&
    !device.revoked &&
    !device.is_management &&
    !!device.grade_id &&
    !!device.class_id;
  if (!viewerBindingValid && plugin.paired === true) {
    await sql`UPDATE classisland_plugin_instances SET paired=FALSE, grade_id='', class_id='', updated_at=${Date.now()} WHERE plugin_instance_id=${credentials.instanceId}`;
  }
  if (action === "plugin-pair-status") {
    const paired = plugin.paired === true && viewerBindingValid;
    let classTag = "";
    if (paired) {
      const examRows =
        (await sql`SELECT grades, classes FROM exam_data WHERE id=1`) as unknown as ExamRow[];
      classTag = classLabel(
        examPayload(examRows[0] ?? {}),
        String(device.grade_id),
        String(device.class_id),
      );
      if (
        plugin.grade_id !== device.grade_id ||
        plugin.class_id !== device.class_id
      ) {
        await sql`UPDATE classisland_plugin_instances SET grade_id=${device.grade_id}, class_id=${device.class_id}, updated_at=${Date.now()} WHERE plugin_instance_id=${credentials.instanceId}`;
      }
    }
    res
      .status(200)
      .json({
        ok: true,
        ...classIslandApiMeta(),
        paired,
        classTag,
        pairExpiresAt: Number(plugin.pair_expires_at ?? 0) || null,
      });
    return;
  }
  if (plugin.paired !== true || !viewerBindingValid) {
    res
      .status(409)
      .json({
        ok: false,
        code: "VIEWER_CLASS_REQUIRED",
        error: "看板未绑定有效班级，ClassIsland 配对已解除",
      });
    return;
  }
  const examRows =
    (await sql`SELECT items, title, majors, active_major_id, alerts, weekly_plans, schedule_mode, active_weekly_plan_id, active_weekly_plan_by_class, weekly_conflict_policy, grades, classes, initialization, design_policy, updated_at FROM exam_data WHERE id=1`) as unknown as ExamRow[];
  const payload = examPayload(examRows[0] ?? {});
  const gradeId = String(device.grade_id);
  const classId = String(device.class_id);
  await sql`UPDATE classisland_plugin_instances SET grade_id=${gradeId}, class_id=${classId}, updated_at=${Date.now()} WHERE plugin_instance_id=${credentials.instanceId}`;
  res.status(200).json({
    ok: true,
    ...classIslandApiMeta(),
    schemaVersion: CLASSISLAND_API_VERSION,
    serverTime: new Date().toISOString(),
    binding: {
      gradeId,
      classId,
      classTag: classLabel(payload, gradeId, classId),
    },
    school: payload.initialization ?? {},
    viewerOnline:
      viewerBindingValid &&
      Date.now() - Number(device.last_seen_at ?? 0) <=
        PLUGIN_VIEWER_ONLINE_MS,
    exams: resolvePluginExams(payload, gradeId, classId),
    updatedAt: payload.updatedAt,
  });
  return;
}

export async function handlePluginViewerHeartbeat(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  const instanceId = String(req.body?.pluginInstanceId ?? "").trim();
  const viewerInstanceId = String(req.body?.viewerInstanceId ?? "")
    .trim()
    .slice(0, 128);
  if (!PLUGIN_ID_RE.test(instanceId)) {
    res.status(400).json({ ok: false, error: "Invalid plugin instance" });
    return;
  }
  await ensureTableOnce();
  const pluginRows =
    (await sql`SELECT viewer_instance_id, paired FROM classisland_plugin_instances WHERE plugin_instance_id=${instanceId}`) as unknown as PluginInstanceRow[];
  const plugin = pluginRows[0];
  const linkedViewerId = String(plugin?.viewer_instance_id ?? "");
  if (
    !plugin ||
    plugin.paired !== true ||
    !linkedViewerId ||
    (viewerInstanceId && viewerInstanceId !== linkedViewerId)
  ) {
    res
      .status(409)
      .json({ ok: false, error: "Plugin is not paired with this viewer" });
    return;
  }
  const deviceRows =
    (await sql`SELECT grade_id, class_id, revoked, is_management FROM device_instances WHERE instance_id=${linkedViewerId}`) as unknown as Array<{
      grade_id: string;
      class_id: string;
      revoked: boolean;
      is_management: boolean;
    }>;
  const device = deviceRows[0];
  if (
    !device ||
    device.revoked ||
    device.is_management ||
    !device.grade_id ||
    !device.class_id
  ) {
    await sql`UPDATE classisland_plugin_instances SET paired=FALSE, grade_id='', class_id='', updated_at=${Date.now()} WHERE plugin_instance_id=${instanceId}`;
    res
      .status(409)
      .json({
        ok: false,
        error: "Viewer class binding is no longer valid",
      });
    return;
  }
  await sql`UPDATE classisland_plugin_instances SET viewer_last_seen_at=${Date.now()}, grade_id=${device.grade_id}, class_id=${device.class_id}, updated_at=${Date.now()} WHERE plugin_instance_id=${instanceId}`;
  res.status(200).json({ ok: true });
  return;
}
