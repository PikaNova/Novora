// 设备管理员路由（需管理员/授权身份）：绑定列表、可绑定选项、托管设备开通、角色变更、远程命令、撤销绑定。
// 从 api/exams.ts 拆分而来，逻辑与对外行为保持不变。
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { acquireWriteSlotOrReject, database, ensureTableOnce } from "../db.js";
import { examPayload } from "../payload.js";
import { allScope } from "../permissions.js";
import { actorScopeLabel } from "../plugin.js";
import type { ExamRow } from "../types.js";
import {
  type AdminActor,
  canAccessClass,
  isPasswordRequired,
  requireActor,
  writeAudit,
} from "../../_auth.js";

export async function handleDeviceBindings(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
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

export async function handleDeviceBindingOptions(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
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

export async function handleManagedDeviceSetup(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
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
    if (!(await acquireWriteSlotOrReject(req, res))) return;
    if (existing[0]) {
      await sql`UPDATE device_instances SET revoked=TRUE, grade_id='', class_id='', updated_at=${Date.now()} WHERE instance_id=${existing[0].instance_id}`;
      await sql`UPDATE classisland_plugin_instances SET paired=FALSE, grade_id='', class_id='', updated_at=${Date.now()} WHERE viewer_instance_id=${existing[0].instance_id}`;
    }
  }
  if (!classId && !(await acquireWriteSlotOrReject(req, res))) return;
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

export async function handleDeviceRoleUpdate(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
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
    if (!(await acquireWriteSlotOrReject(req, res))) return;
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
  if (!(await acquireWriteSlotOrReject(req, res))) return;
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

export async function handleDeviceCommand(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
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
  if (!(await acquireWriteSlotOrReject(req, res))) return;
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

export async function handleDeviceRevoke(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
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
  if (!(await acquireWriteSlotOrReject(req, res))) return;
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
