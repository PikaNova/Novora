// 设备终端自助服务路由（无需管理员身份，由设备自己调用）：绑定查询/自报、心跳上报。
// 从 api/exams.ts 拆分而来，逻辑与对外行为保持不变。
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database, ensureTableOnce, missingRelation } from "../db.js";

export async function handleDeviceBinding(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
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

export async function handleDeviceHeartbeat(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
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
