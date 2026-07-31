// api/exams.ts
// 考试看板 / ClassIsland 插件 / 设备绑定的 HTTP 入口（Vercel Serverless Function）。
// 第二阶段解耦：原本集中在本文件的数据库迁移、payload 映射与 diff、鉴权校验、
// 插件逻辑已拆到 ./_exams/* 子模块；本文件只保留请求分发与编排（thin handler）。
// 对外行为与接口保持不变。

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  canAccessClass,
  ensureGeneratedRecoveryKey,
  isPasswordRequired,
  requireActor,
  writeAudit,
  type AdminActor,
} from "./_auth.js";
import { requestId, sendDatabaseError } from "./_apiError.js";
import { applyCors } from "./_cors.js";
import {
  database,
  ensureTableOnce,
  ensureUpdatedAtBigIntOnce,
  missingRelation,
  updatedAtIntegerOverflow,
} from "./_exams/db.js";
import { examPayload } from "./_exams/payload.js";
import { allScope, validateMutation } from "./_exams/permissions.js";
import {
  CLASSISLAND_API_VERSION,
  PLUGIN_ID_RE,
  PLUGIN_PAIR_TTL_MS,
  PLUGIN_TOKEN_RE,
  PLUGIN_VIEWER_ONLINE_MS,
  actorScopeLabel,
  classIslandApiMeta,
  classLabel,
  equalHash,
  pluginCredentials,
  resolvePluginExams,
  sha256,
} from "./_exams/plugin.js";
import type { ExamRow, PluginInstanceRow, UpdatedRow } from "./_exams/types.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startedAt = Date.now();
  requestId(req, res);
  const action = String(
    req.method === "GET" ? (req.query?.action ?? "") : (req.body?.action ?? ""),
  );
  const publicPostActions = new Set([
    "plugin-pair-start",
    "plugin-pair-confirm",
    "plugin-pair-status",
    "plugin-bootstrap",
    "plugin-viewer-heartbeat",
    "device-binding",
    "device-heartbeat",
  ]);
  const publicRequest =
    req.method === "OPTIONS" ||
    (req.method === "GET" && action !== "device-bindings") ||
    (req.method === "POST" && publicPostActions.has(action));
  // 只做“协商缓存”（ETag/If-None-Match），不再声明 public 共享缓存：
  // 之前的 `public, s-maxage=3` 允许 Vercel 边缘节点在写入后的几秒内，把旧数据返回给
  // 任意用户；配合下面已移除的实例内存缓存，会出现「明明已创建班级，第一次进入却显示未创建，
  // 刷新后才恢复」的问题。改为 private + no-cache 后，每次请求都必须向源站校验 ETag，
  // 数据永远来自当次真实查询，只是命中 304 时不重复传输正文。
  if (req.method === "GET")
    res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
  else res.setHeader("Cache-Control", "no-store");
  if (!applyCors(req, res, { methods: ["GET", "POST"], public: publicRequest }))
    return;

  try {
    if (action === "plugin-api") {
      res.setHeader("Cache-Control", "public, max-age=300");
      if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
      }
      res.status(200).json({ ok: true, ...classIslandApiMeta() });
      return;
    }

    const sql = database();
    if (action === "plugin-pair-start") {
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
    if (action === "plugin-pair-info") {
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
    if (action === "plugin-pair-confirm") {
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
    if (action === "plugin-pair-status" || action === "plugin-bootstrap") {
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
    if (action === "plugin-viewer-heartbeat") {
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
    if (action === "bootstrap") {
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
    if (action === "device-bindings") {
      res.setHeader("Cache-Control", "no-store");
      if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
      }
      const currentInstanceId = String(req.query?.currentInstanceId ?? "")
        .trim()
        .slice(0, 128);
      let deviceActor: AdminActor | null = null;
      if (await isPasswordRequired()) {
        deviceActor = await requireActor(req, res, "device.read");
        if (!deviceActor) return;
      }
      await ensureTableOnce();
      const [deviceRows, pluginRows] = await Promise.all([
        sql`SELECT * FROM device_instances ORDER BY updated_at DESC LIMIT 2001` as unknown as Promise<
          Array<Record<string, any>>
        >,
        sql`SELECT plugin_instance_id, grade_id, class_id, viewer_instance_id, paired, viewer_last_seen_at, updated_at FROM classisland_plugin_instances ORDER BY updated_at DESC LIMIT 2001` as unknown as Promise<
          Array<Record<string, any>>
        >,
      ]);
      const currentManagement =
        deviceActor &&
        deviceRows.find(
          (row) =>
            String(row.instance_id ?? "") === currentInstanceId &&
            row.is_management === true,
        );
      if (deviceActor && currentManagement) {
        const scopeRows =
          (await sql`SELECT grades, classes FROM exam_data WHERE id=1`) as unknown as ExamRow[];
        const managementScopeLabel = actorScopeLabel(
          deviceActor,
          examPayload(scopeRows[0] ?? {}),
        );
        const identityChanged =
          Number(currentManagement.management_actor_id ?? 0) !==
            deviceActor.id ||
          String(currentManagement.management_role_name ?? "") !==
            deviceActor.roleName ||
          String(currentManagement.management_scope_label ?? "") !==
            managementScopeLabel;
        if (identityChanged)
          await sql`UPDATE device_instances SET management_actor_id=${deviceActor.id}, management_role_name=${deviceActor.roleName}, management_scope_label=${managementScopeLabel}, updated_at=${Date.now()} WHERE instance_id=${currentInstanceId} AND is_management=TRUE`;
        currentManagement.management_actor_id = deviceActor.id;
        currentManagement.management_role_name = deviceActor.roleName;
        currentManagement.management_scope_label = managementScopeLabel;
      }
      let rows = deviceRows;
      let visiblePluginRows = pluginRows;
      if (deviceActor)
        rows = rows.filter(
          (row) =>
            String(row.instance_id ?? "") === currentInstanceId ||
            (row.is_management === true
              ? allScope(deviceActor!) ||
                Number(row.management_actor_id ?? 0) === deviceActor!.id
              : canAccessClass(
                  deviceActor!,
                  String(row.grade_id ?? ""),
                  String(row.class_id ?? ""),
                )),
        );
      if (deviceActor)
        visiblePluginRows = visiblePluginRows.filter(
          (row) =>
            String(row.viewer_instance_id ?? "") === currentInstanceId ||
            canAccessClass(
              deviceActor!,
              String(row.grade_id ?? ""),
              String(row.class_id ?? ""),
            ),
        );
      const truncated = rows.length > 500 || visiblePluginRows.length > 500;
      res.status(200).json({
        ok: true,
        bindings: rows
          .slice(0, 500)
          .map((row) => ({
            instanceId: row.instance_id,
            gradeId: row.grade_id,
            classId: row.class_id,
            revoked: row.revoked === true,
            isManagement: row.is_management === true,
            managementRoleName: row.management_role_name ?? "",
            managementScopeLabel: row.management_scope_label ?? "",
            page: row.page,
            clientVersion: row.client_version,
            status: row.status,
            currentExam: row.current_exam,
            currentSubject: row.current_subject,
            examStart: row.exam_start,
            examEnd: row.exam_end,
            lastSeenAt: Number(row.last_seen_at),
            updatedAt: Number(row.updated_at),
          })),
        plugins: visiblePluginRows
          .slice(0, 500)
          .map((row) => ({
            pluginInstanceId: row.plugin_instance_id,
            viewerInstanceId: row.viewer_instance_id ?? "",
            gradeId: row.grade_id ?? "",
            classId: row.class_id ?? "",
            paired: row.paired === true,
            pluginLastSeenAt: Number(row.updated_at),
            viewerLastSeenAt: Number(row.viewer_last_seen_at),
          })),
        truncated,
      });
      return;
    }
    if (action === "device-binding-options") {
      res.setHeader("Cache-Control", "no-store");
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
      await ensureTableOnce();
      const rows = (await sql`
        SELECT DISTINCT class_id
        FROM device_instances
        WHERE class_id<>'' AND revoked=FALSE AND is_management=FALSE AND instance_id<>${instanceId}
      `) as unknown as Array<{ class_id: string }>;
      res
        .status(200)
        .json({
          ok: true,
          occupiedClassIds: rows.map((row) => row.class_id).filter(Boolean),
        });
      return;
    }
    if (action === "managed-device-setup" && req.method === "POST") {
      let setupActor: AdminActor | null = null;
      if (await isPasswordRequired()) {
        setupActor = await requireActor(req, res, "device.bind");
        if (!setupActor) return;
      }
      const instanceId = String(req.body?.instanceId ?? "")
        .trim()
        .slice(0, 128);
      const gradeId = String(req.body?.gradeId ?? "")
        .trim()
        .slice(0, 128);
      const classId = String(req.body?.classId ?? "")
        .trim()
        .slice(0, 128);
      const bindManagement = req.body?.bindManagement === true;
      const replaceExisting = req.body?.replaceExisting === true;
      if (!instanceId || (!bindManagement && !classId)) {
        res.status(400).json({ ok: false, error: "请选择至少一种设备用途" });
        return;
      }
      if (
        classId &&
        (!gradeId ||
          (setupActor && !canAccessClass(setupActor, gradeId, classId)))
      ) {
        res
          .status(403)
          .json({ ok: false, error: "所选班级超出当前账号的管理范围" });
        return;
      }
      await ensureTableOnce();
      if (classId) {
        const existing =
          (await sql`SELECT instance_id, last_seen_at, status FROM device_instances WHERE class_id=${classId} AND revoked=FALSE AND instance_id<>${instanceId} ORDER BY updated_at DESC LIMIT 1`) as unknown as Array<{
            instance_id: string;
            last_seen_at: number | string;
            status: string;
          }>;
        if (existing[0] && !replaceExisting) {
          const lastSeenAt = Number(existing[0].last_seen_at ?? 0);
          res
            .status(409)
            .json({
              ok: false,
              code: "CLASS_DEVICE_EXISTS",
              error: "该班级已有考试端",
              existing: {
                instanceId: existing[0].instance_id,
                status: existing[0].status,
                lastSeenAt,
                online: Date.now() - lastSeenAt <= 90_000,
              },
            });
          return;
        }
        if (existing[0]) {
          await sql`UPDATE device_instances SET revoked=TRUE, grade_id='', class_id='', updated_at=${Date.now()} WHERE instance_id=${existing[0].instance_id}`;
          await sql`UPDATE classisland_plugin_instances SET paired=FALSE, grade_id='', class_id='', updated_at=${Date.now()} WHERE viewer_instance_id=${existing[0].instance_id}`;
        }
      }
      const now = Date.now();
      const nextGradeId = bindManagement ? "" : gradeId;
      const nextClassId = bindManagement ? "" : classId;
      const managementActorId = bindManagement
        ? Number(setupActor?.id ?? 0)
        : 0;
      const managementRoleName = bindManagement
        ? String(setupActor?.roleName ?? "管理设备")
        : "";
      let managementScopeLabel = bindManagement ? "管理范围未记录" : "";
      if (bindManagement && setupActor) {
        const scopeRows =
          (await sql`SELECT grades, classes FROM exam_data WHERE id=1`) as unknown as ExamRow[];
        managementScopeLabel = actorScopeLabel(
          setupActor,
          examPayload(scopeRows[0] ?? {}),
        );
      }
      await sql`INSERT INTO device_instances (instance_id, grade_id, class_id, revoked, is_management, management_actor_id, management_role_name, management_scope_label, updated_at)
        VALUES (${instanceId}, ${nextGradeId}, ${nextClassId}, FALSE, ${bindManagement}, ${managementActorId}, ${managementRoleName}, ${managementScopeLabel}, ${now})
        ON CONFLICT (instance_id) DO UPDATE SET
          grade_id=EXCLUDED.grade_id,
          class_id=EXCLUDED.class_id,
          revoked=FALSE,
          is_management=EXCLUDED.is_management,
          management_actor_id=EXCLUDED.management_actor_id,
          management_role_name=EXCLUDED.management_role_name,
          management_scope_label=EXCLUDED.management_scope_label,
          updated_at=EXCLUDED.updated_at`;
      if (bindManagement) {
        await sql`UPDATE classisland_plugin_instances SET paired=FALSE, grade_id='', class_id='', updated_at=${now} WHERE viewer_instance_id=${instanceId}`;
      } else {
        await sql`UPDATE classisland_plugin_instances SET grade_id=${gradeId}, class_id=${classId}, updated_at=${now} WHERE viewer_instance_id=${instanceId} AND paired=TRUE`;
      }
      await writeAudit(setupActor, "device.setup", "device", instanceId, {
        bindManagement,
        gradeId,
        classId,
        replaced: replaceExisting,
      });
      res
        .status(200)
        .json({
          ok: true,
          binding: {
            gradeId: nextGradeId,
            classId: nextClassId,
            revoked: false,
            isManagement: bindManagement,
          },
          updatedAt: now,
        });
      return;
    }
    if (action === "device-role-update" && req.method === "POST") {
      const roleActor = await requireActor(req, res, "device.bind");
      if (!roleActor) return;
      const instanceId = String(req.body?.instanceId ?? "")
        .trim()
        .slice(0, 128);
      const targetRole = String(req.body?.targetRole ?? "");
      const gradeId = String(req.body?.gradeId ?? "")
        .trim()
        .slice(0, 128);
      const classId = String(req.body?.classId ?? "")
        .trim()
        .slice(0, 128);
      const replaceExisting = req.body?.replaceExisting === true;
      if (
        !instanceId ||
        (targetRole !== "management" && targetRole !== "class-terminal")
      ) {
        res.status(400).json({ ok: false, error: "设备和目标角色无效" });
        return;
      }
      await ensureTableOnce();
      const targetRows =
        (await sql`SELECT instance_id, grade_id, class_id, revoked, is_management, management_actor_id FROM device_instances WHERE instance_id=${instanceId}`) as unknown as Array<{
          instance_id: string;
          grade_id: string;
          class_id: string;
          revoked: boolean;
          is_management: boolean;
          management_actor_id: number | string;
        }>;
      const target = targetRows[0];
      if (!target) {
        res.status(404).json({ ok: false, error: "设备不存在或尚未上报状态" });
        return;
      }
      const canManageTarget = target.is_management
        ? roleActor.permissions.includes("*") ||
          roleActor.scopes.some((scope) => scope.type === "all") ||
          Number(target.management_actor_id ?? 0) === roleActor.id
        : canAccessClass(
            roleActor,
            target.grade_id ?? "",
            target.class_id ?? "",
          );
      if (!canManageTarget) {
        res
          .status(403)
          .json({ ok: false, error: "该设备超出当前账号的管理范围" });
        return;
      }

      const payloadRows =
        (await sql`SELECT grades, classes FROM exam_data WHERE id=1`) as unknown as ExamRow[];
      const payload = examPayload(payloadRows[0] ?? {});
      const now = Date.now();
      if (targetRole === "management") {
        const managementScopeLabel = actorScopeLabel(roleActor, payload);
        await sql`UPDATE classisland_plugin_instances SET paired=FALSE, grade_id='', class_id='', updated_at=${now} WHERE viewer_instance_id=${instanceId}`;
        await sql`UPDATE device_instances SET grade_id='', class_id='', revoked=FALSE, is_management=TRUE, management_actor_id=${roleActor.id}, management_role_name=${roleActor.roleName}, management_scope_label=${managementScopeLabel}, updated_at=${now} WHERE instance_id=${instanceId}`;
        await writeAudit(
          roleActor,
          "device.role.management",
          "device",
          instanceId,
          {
            previousRole: target.is_management
              ? "management"
              : "class-terminal",
            previousGradeId: target.grade_id,
            previousClassId: target.class_id,
          },
        );
        res
          .status(200)
          .json({
            ok: true,
            binding: {
              gradeId: "",
              classId: "",
              revoked: false,
              isManagement: true,
            },
            managementRoleName: roleActor.roleName,
            managementScopeLabel,
            updatedAt: now,
          });
        return;
      }

      const targetClass = (
        payload.classes as Array<Record<string, unknown>>
      ).find(
        (item) =>
          String(item.id ?? "") === classId &&
          String(item.gradeId ?? "") === gradeId,
      );
      if (!gradeId || !classId || !targetClass) {
        res.status(400).json({ ok: false, error: "请选择有效的年级和班级" });
        return;
      }
      if (!canAccessClass(roleActor, gradeId, classId)) {
        res
          .status(403)
          .json({ ok: false, error: "所选班级超出当前账号的管理范围" });
        return;
      }
      const occupied =
        (await sql`SELECT instance_id, last_seen_at, status FROM device_instances WHERE class_id=${classId} AND revoked=FALSE AND instance_id<>${instanceId} ORDER BY updated_at DESC LIMIT 1`) as unknown as Array<{
          instance_id: string;
          last_seen_at: number | string;
          status: string;
        }>;
      if (occupied[0] && !replaceExisting) {
        const lastSeenAt = Number(occupied[0].last_seen_at ?? 0);
        res
          .status(409)
          .json({
            ok: false,
            code: "CLASS_DEVICE_EXISTS",
            error: "该班级已有考试端",
            existing: {
              instanceId: occupied[0].instance_id,
              status: occupied[0].status,
              lastSeenAt,
              online: Date.now() - lastSeenAt <= 90_000,
            },
          });
        return;
      }
      if (occupied[0]) {
        await sql`UPDATE classisland_plugin_instances SET paired=FALSE, grade_id='', class_id='', updated_at=${now} WHERE viewer_instance_id IN (SELECT instance_id FROM device_instances WHERE class_id=${classId} AND revoked=FALSE AND instance_id<>${instanceId})`;
        await sql`UPDATE device_instances SET revoked=TRUE, grade_id='', class_id='', updated_at=${now} WHERE class_id=${classId} AND revoked=FALSE AND instance_id<>${instanceId}`;
      }
      await sql`UPDATE device_instances SET grade_id=${gradeId}, class_id=${classId}, revoked=FALSE, is_management=FALSE, management_actor_id=0, management_role_name='', management_scope_label='', updated_at=${now} WHERE instance_id=${instanceId}`;
      await sql`UPDATE classisland_plugin_instances SET grade_id=${gradeId}, class_id=${classId}, updated_at=${now} WHERE viewer_instance_id=${instanceId} AND paired=TRUE`;
      await writeAudit(
        roleActor,
        "device.role.class-terminal",
        "device",
        instanceId,
        {
          previousRole: target.is_management ? "management" : "class-terminal",
          gradeId,
          classId,
          replaced: !!occupied[0],
        },
        gradeId,
        classId,
      );
      res
        .status(200)
        .json({
          ok: true,
          binding: { gradeId, classId, revoked: false, isManagement: false },
          replaced: !!occupied[0],
          updatedAt: now,
        });
      return;
    }
    if (action === "device-binding") {
      const instanceId = String(
        req.method === "GET"
          ? (req.query?.instanceId ?? "")
          : (req.body?.instanceId ?? ""),
      )
        .trim()
        .slice(0, 128);
      if (!instanceId) {
        res.status(400).json({ ok: false, error: "instanceId is required" });
        return;
      }
      const runBinding = async () => {
        if (req.method === "GET") {
          const rows =
            (await sql`SELECT grade_id, class_id, revoked, is_management FROM device_instances WHERE instance_id = ${instanceId}`) as unknown as Array<{
              grade_id?: string;
              class_id?: string;
              revoked?: boolean;
              is_management?: boolean;
            }>;
          res
            .status(200)
            .json({
              ok: true,
              binding: rows[0]
                ? {
                    gradeId: rows[0].grade_id ?? "",
                    classId: rows[0].class_id ?? "",
                    revoked: rows[0].revoked === true,
                    isManagement: rows[0].is_management === true,
                  }
                : null,
            });
          return;
        }
        if (req.method === "POST") {
          const gradeId = String(req.body?.gradeId ?? "")
            .trim()
            .slice(0, 128);
          const classId = String(req.body?.classId ?? "")
            .trim()
            .slice(0, 128);
          const replaceExisting = req.body?.replaceExisting === true;
          if (!gradeId || !classId) {
            res
              .status(400)
              .json({ ok: false, error: "gradeId and classId are required" });
            return;
          }
          const occupied =
            (await sql`SELECT instance_id, last_seen_at FROM device_instances WHERE class_id=${classId} AND revoked=FALSE AND instance_id<>${instanceId} ORDER BY updated_at DESC LIMIT 1`) as unknown as Array<{
              instance_id: string;
              last_seen_at: number | string;
            }>;
          if (occupied[0] && !replaceExisting) {
            const lastSeenAt = Number(occupied[0].last_seen_at ?? 0);
            res
              .status(409)
              .json({
                ok: false,
                code: "CLASS_DEVICE_EXISTS",
                error: "该班级已绑定其他考试端",
                existing: {
                  instanceId: occupied[0].instance_id,
                  lastSeenAt,
                  online: Date.now() - lastSeenAt <= 90_000,
                },
              });
            return;
          }
          if (occupied[0]) {
            const replacedAt = Date.now();
            await sql`
              UPDATE classisland_plugin_instances
              SET paired=FALSE, grade_id='', class_id='', updated_at=${replacedAt}
              WHERE viewer_instance_id IN (
                SELECT instance_id FROM device_instances
                WHERE class_id=${classId} AND revoked=FALSE AND instance_id<>${instanceId}
              )
            `;
            await sql`UPDATE device_instances SET revoked=TRUE, grade_id='', class_id='', updated_at=${replacedAt} WHERE class_id=${classId} AND revoked=FALSE AND instance_id<>${instanceId}`;
          }
          const updatedAt = Date.now();
          await sql`
            INSERT INTO device_instances (instance_id, grade_id, class_id, revoked, updated_at)
            VALUES (${instanceId}, ${gradeId}, ${classId}, FALSE, ${updatedAt})
            ON CONFLICT (instance_id) DO UPDATE SET grade_id = EXCLUDED.grade_id, class_id = EXCLUDED.class_id, revoked = FALSE, is_management = FALSE, management_actor_id=0, management_role_name='', management_scope_label='', updated_at = EXCLUDED.updated_at
          `;
          await sql`UPDATE classisland_plugin_instances SET grade_id=${gradeId}, class_id=${classId}, updated_at=${updatedAt} WHERE viewer_instance_id=${instanceId} AND paired=TRUE`;
          res
            .status(200)
            .json({
              ok: true,
              binding: {
                gradeId,
                classId,
                revoked: false,
                isManagement: false,
              },
              updatedAt,
            });
          return;
        }
        res.status(405).json({ ok: false, error: "Method not allowed" });
      };
      try {
        await runBinding();
      } catch (error) {
        if (!missingRelation(error)) throw error;
        await ensureTableOnce();
        await runBinding();
      }
      return;
    }
    if (action === "device-heartbeat" && req.method === "POST") {
      const instanceId = String(req.body?.instanceId ?? "")
        .trim()
        .slice(0, 128);
      if (!instanceId) {
        res.status(400).json({ ok: false, error: "instanceId is required" });
        return;
      }
      const now = Date.now();
      const value = (key: string, max = 160) =>
        String(req.body?.[key] ?? "")
          .trim()
          .slice(0, max);
      const run = async () => {
        const acknowledgedCommandId = value("acknowledgedCommandId", 128);
        if (acknowledgedCommandId)
          await sql`UPDATE device_instances SET temporary_command=NULL WHERE instance_id=${instanceId} AND temporary_command->>'id'=${acknowledgedCommandId}`;
        await sql`INSERT INTO device_instances (instance_id, page, client_version, status, current_exam, current_subject, exam_start, exam_end, last_seen_at, updated_at)
          VALUES (${instanceId}, ${value("page")}, ${value("clientVersion", 40)}, ${value("status", 40)}, ${value("currentExam")}, ${value("currentSubject")}, ${value("examStart", 40)}, ${value("examEnd", 40)}, ${now}, ${now})
          ON CONFLICT (instance_id) DO UPDATE SET page=EXCLUDED.page, client_version=EXCLUDED.client_version, status=EXCLUDED.status, current_exam=EXCLUDED.current_exam, current_subject=EXCLUDED.current_subject, exam_start=EXCLUDED.exam_start, exam_end=EXCLUDED.exam_end, last_seen_at=EXCLUDED.last_seen_at, updated_at=EXCLUDED.updated_at`;
        const rows =
          (await sql`SELECT grade_id, class_id, revoked, is_management, temporary_command FROM device_instances WHERE instance_id=${instanceId}`) as unknown as Array<{
            grade_id: string;
            class_id: string;
            revoked: boolean;
            is_management: boolean;
            temporary_command?: unknown;
          }>;
        const device = rows[0];
        const hasBinding =
          !!device &&
          (device.revoked === true ||
            device.is_management === true ||
            !!device.class_id);
        res
          .status(200)
          .json({
            ok: true,
            revoked: device?.revoked === true,
            binding: hasBinding
              ? {
                  gradeId: device.grade_id ?? "",
                  classId: device.class_id ?? "",
                  revoked: device.revoked === true,
                  isManagement: device.is_management === true,
                }
              : null,
            command: device?.temporary_command ?? null,
          });
      };
      try {
        await run();
      } catch (error) {
        if (!missingRelation(error)) throw error;
        await ensureTableOnce();
        await run();
      }
      return;
    }
    if (action === "device-command" && req.method === "POST") {
      const instanceId = String(req.body?.instanceId ?? "")
        .trim()
        .slice(0, 128);
      const commandAction = String(req.body?.commandAction ?? "");
      if (
        !instanceId ||
        !["pause", "resume", "extend", "end"].includes(commandAction)
      ) {
        res.status(400).json({ ok: false, error: "Invalid device command" });
        return;
      }
      await ensureTableOnce();
      let deviceActor: AdminActor | null = null;
      if (await isPasswordRequired()) {
        deviceActor = await requireActor(req, res, "device.revoke");
        if (!deviceActor) return;
        const bindings =
          (await sql`SELECT grade_id, class_id FROM device_instances WHERE instance_id=${instanceId}`) as unknown as Array<{
            grade_id: string;
            class_id: string;
          }>;
        if (
          bindings[0] &&
          !canAccessClass(
            deviceActor,
            bindings[0].grade_id,
            bindings[0].class_id,
          )
        ) {
          res
            .status(403)
            .json({ ok: false, error: "设备超出当前账号的管理范围" });
          return;
        }
      }
      const command = {
        id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        action: commandAction,
        minutes:
          commandAction === "extend"
            ? Math.min(120, Math.max(1, Number(req.body?.minutes) || 5))
            : undefined,
        createdAt: Date.now(),
      };
      await sql`UPDATE device_instances SET temporary_command=${JSON.stringify(command)}::jsonb, updated_at=${Date.now()} WHERE instance_id=${instanceId}`;
      await writeAudit(
        deviceActor,
        `device.temporary.${commandAction}`,
        "device",
        instanceId,
      );
      res.status(200).json({ ok: true, command });
      return;
    }
    if (action === "device-revoke" && req.method === "POST") {
      const instanceId = String(req.body?.instanceId ?? "")
        .trim()
        .slice(0, 128);
      const pluginInstanceIds = Array.isArray(req.body?.pluginInstanceIds)
        ? req.body.pluginInstanceIds
            .map((value: unknown) => String(value).trim().slice(0, 128))
            .filter(Boolean)
            .slice(0, 20)
        : [];
      if (!instanceId && !pluginInstanceIds.length) {
        res
          .status(400)
          .json({ ok: false, error: "Device instance is required" });
        return;
      }
      await ensureTableOnce();
      let deviceActor: AdminActor | null = null;
      if (await isPasswordRequired()) {
        deviceActor = await requireActor(req, res, "device.revoke");
        if (!deviceActor) return;
        const bindings = instanceId
          ? ((await sql`SELECT grade_id, class_id FROM device_instances WHERE instance_id=${instanceId}`) as unknown as Array<{
              grade_id: string;
              class_id: string;
            }>)
          : [];
        if (
          bindings[0] &&
          !canAccessClass(
            deviceActor,
            bindings[0].grade_id,
            bindings[0].class_id,
          )
        ) {
          res
            .status(403)
            .json({ ok: false, error: "设备超出当前账号的管理范围" });
          return;
        }
        if (pluginInstanceIds.length) {
          const plugins =
            (await sql`SELECT grade_id, class_id FROM classisland_plugin_instances WHERE plugin_instance_id=ANY(${pluginInstanceIds})`) as unknown as Array<{
              grade_id: string;
              class_id: string;
            }>;
          if (
            plugins.some(
              (item) =>
                !canAccessClass(deviceActor!, item.grade_id, item.class_id),
            )
          ) {
            res
              .status(403)
              .json({ ok: false, error: "插件实例超出当前账号的管理范围" });
            return;
          }
        }
      }
      if (instanceId)
        await sql`UPDATE device_instances SET revoked=TRUE, grade_id='', class_id='', is_management=FALSE, updated_at=${Date.now()} WHERE instance_id=${instanceId}`;
      if (pluginInstanceIds.length && instanceId) {
        await sql`UPDATE classisland_plugin_instances SET paired=FALSE, grade_id='', class_id='', updated_at=${Date.now()} WHERE plugin_instance_id=ANY(${pluginInstanceIds}) OR viewer_instance_id=${instanceId}`;
      } else if (pluginInstanceIds.length) {
        await sql`UPDATE classisland_plugin_instances SET paired=FALSE, grade_id='', class_id='', updated_at=${Date.now()} WHERE plugin_instance_id=ANY(${pluginInstanceIds})`;
      } else if (instanceId) {
        await sql`UPDATE classisland_plugin_instances SET paired=FALSE, grade_id='', class_id='', updated_at=${Date.now()} WHERE viewer_instance_id=${instanceId}`;
      }
      await writeAudit(
        deviceActor,
        "device.revoke",
        "device",
        instanceId || pluginInstanceIds.join(","),
      );
      res.status(200).json({ ok: true });
      return;
    }
    if (action === "design-policy" && req.method === "POST") {
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
    if (action === "reset-data" && req.method === "POST") {
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

    if (req.method === "GET") {
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

    if (req.method === "POST") {
      let actor: AdminActor | null = null;
      if (await isPasswordRequired()) {
        actor = await requireActor(req, res);
        if (!actor) return;
      }
      const {
        action,
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
      if (!Array.isArray(items)) {
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
      const expectedVersion = Number(baseUpdatedAt ?? 0);
      const updatedAt = Date.now();
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

    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error: unknown) {
    sendDatabaseError(req, res, error, req.method === "GET" ? "read" : "write");
  }
}
