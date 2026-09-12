// 设备终端自助服务路由（无需管理员身份，由设备自己调用）：绑定查询/自报、心跳上报。
// 从 api/exams.ts 拆分而来，逻辑与对外行为保持不变。
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { acquireWriteSlotOrReject, database, ensureTableOnce, missingRelation } from '../db.js';
import {
  DEVICE_HEARTBEAT_REFRESH_MS,
  DEVICE_ONLINE_WINDOW_MS,
  parseDeviceCommand,
} from '../../../src/shared/deviceContracts.js';
import { parseExamVersion } from '../../../src/shared/examContracts.js';
import { isEdgeDeployment } from '../../_deployTarget.js';

type DeviceHeartbeatRow = {
  grade_id: string;
  class_id: string;
  revoked: boolean;
  is_management: boolean;
  temporary_command?: unknown;
  exam_version?: unknown;
};

export async function handleDeviceBinding(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = database();
  const instanceId = String(req.method === 'GET' ? (req.query?.instanceId ?? '') : (req.body?.instanceId ?? ''))
    .trim()
    .slice(0, 128);
  if (!instanceId) {
    res.status(400).json({ ok: false, error: 'instanceId is required' });
    return;
  }
  const runBinding = async () => {
    if (req.method === 'GET') {
      const rows =
        (await sql`SELECT grade_id, class_id, revoked, is_management FROM device_instances WHERE instance_id = ${instanceId}`) as unknown as Array<{
          grade_id?: string;
          class_id?: string;
          revoked?: boolean;
          is_management?: boolean;
        }>;
      res.status(200).json({
        ok: true,
        binding: rows[0]
          ? {
              gradeId: rows[0].grade_id ?? '',
              classId: rows[0].class_id ?? '',
              revoked: rows[0].revoked === true,
              isManagement: rows[0].is_management === true,
            }
          : null,
      });
      return;
    }
    if (req.method === 'POST') {
      const gradeId = String(req.body?.gradeId ?? '')
        .trim()
        .slice(0, 128);
      const classId = String(req.body?.classId ?? '')
        .trim()
        .slice(0, 128);
      const replaceExisting = req.body?.replaceExisting === true;
      if (!gradeId || !classId) {
        res.status(400).json({ ok: false, error: 'gradeId and classId are required' });
        return;
      }
      const occupied =
        (await sql`SELECT instance_id, last_seen_at FROM device_instances WHERE class_id=${classId} AND revoked=FALSE AND instance_id<>${instanceId} ORDER BY updated_at DESC LIMIT 1`) as unknown as Array<{
          instance_id: string;
          last_seen_at: number | string;
        }>;
      if (occupied[0] && !replaceExisting) {
        const lastSeenAt = Number(occupied[0].last_seen_at ?? 0);
        res.status(409).json({
          ok: false,
          code: 'CLASS_DEVICE_EXISTS',
          error: '该班级已绑定其他考试端',
          existing: {
            instanceId: occupied[0].instance_id,
            lastSeenAt,
            online: Date.now() - lastSeenAt <= DEVICE_ONLINE_WINDOW_MS,
          },
        });
        return;
      }
      if (!(await acquireWriteSlotOrReject(req, res))) return;
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
      res.status(200).json({
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
    res.status(405).json({ ok: false, error: 'Method not allowed' });
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
  const instanceId = String(req.body?.instanceId ?? '')
    .trim()
    .slice(0, 128);
  if (!instanceId) {
    res.status(400).json({ ok: false, error: 'instanceId is required' });
    return;
  }
  const now = Date.now();
  const value = (key: string, max = 160) =>
    String(req.body?.[key] ?? '')
      .trim()
      .slice(0, max);
  const run = async () => {
    const acknowledgedCommandId = value('acknowledgedCommandId', 128);
    const failedCommandId = value('failedCommandId', 128);
    const commandFailureReason = value('commandFailureReason', 500);
    if (acknowledgedCommandId) {
      await sql`UPDATE device_commands SET status='acknowledged', acknowledged_at=${now}, failure_reason='' WHERE id=${acknowledgedCommandId} AND instance_id=${instanceId} AND status IN ('pending','claimed')`;
      await sql`UPDATE device_instances SET temporary_command=NULL WHERE instance_id=${instanceId} AND temporary_command->>'id'=${acknowledgedCommandId}`;
    }
    if (failedCommandId) {
      await sql`UPDATE device_commands SET status='failed', failure_reason=${commandFailureReason || '设备执行失败'} WHERE id=${failedCommandId} AND instance_id=${instanceId} AND status IN ('pending','claimed')`;
      await sql`UPDATE device_instances SET temporary_command=NULL WHERE instance_id=${instanceId} AND temporary_command->>'id'=${failedCommandId}`;
    }
    // 心跳写入合并成一条语句：内容没变且 60 秒内已经刷新过 last_seen_at 时，DO UPDATE 的
    // WHERE 不成立就不会真正写行（省掉一次 UPDATE 的 WAL 与死元组）；命中写入时用 RETURNING
    // 直接取回绑定与命令状态，省掉原来紧跟其后的那次 SELECT。
    const writtenRows =
      (await sql`INSERT INTO device_instances (instance_id, page, client_version, status, current_exam, current_subject, exam_start, exam_end, last_seen_at, updated_at)
      VALUES (${instanceId}, ${value('page')}, ${value('clientVersion', 40)}, ${value('status', 40)}, ${value('currentExam')}, ${value('currentSubject')}, ${value('examStart', 40)}, ${value('examEnd', 40)}, ${now}, ${now})
      ON CONFLICT (instance_id) DO UPDATE SET page=EXCLUDED.page, client_version=EXCLUDED.client_version, status=EXCLUDED.status, current_exam=EXCLUDED.current_exam, current_subject=EXCLUDED.current_subject, exam_start=EXCLUDED.exam_start, exam_end=EXCLUDED.exam_end, last_seen_at=EXCLUDED.last_seen_at, updated_at=EXCLUDED.updated_at
      WHERE device_instances.last_seen_at <= EXCLUDED.last_seen_at - ${DEVICE_HEARTBEAT_REFRESH_MS}
        OR device_instances.page IS DISTINCT FROM EXCLUDED.page
        OR device_instances.client_version IS DISTINCT FROM EXCLUDED.client_version
        OR device_instances.status IS DISTINCT FROM EXCLUDED.status
        OR device_instances.current_exam IS DISTINCT FROM EXCLUDED.current_exam
        OR device_instances.current_subject IS DISTINCT FROM EXCLUDED.current_subject
        OR device_instances.exam_start IS DISTINCT FROM EXCLUDED.exam_start
        OR device_instances.exam_end IS DISTINCT FROM EXCLUDED.exam_end
      RETURNING grade_id, class_id, revoked, is_management, temporary_command, (SELECT updated_at FROM exam_data WHERE id=1) AS exam_version`) as unknown as DeviceHeartbeatRow[];
    // 跳过写入时拿不到 RETURNING 行；把这个补读并进下面同一个事务，避免多一次往返。
    const needsRowFallback = writtenRows.length === 0;
    const commandResults = await sql.transaction((transaction) => [
      ...(needsRowFallback
        ? [
            transaction`SELECT grade_id, class_id, revoked, is_management, temporary_command, (SELECT updated_at FROM exam_data WHERE id=1) AS exam_version FROM device_instances WHERE instance_id=${instanceId}`,
          ]
        : []),
      transaction`UPDATE device_commands SET status='expired', failure_reason='命令已过期' WHERE instance_id=${instanceId} AND status IN ('pending','claimed') AND expires_at IS NOT NULL AND expires_at <= ${now}`,
      transaction`UPDATE device_commands SET status='claimed', claimed_at=${now}
        WHERE id = (
          SELECT id FROM device_commands
          WHERE instance_id=${instanceId} AND status='pending' AND (expires_at IS NULL OR expires_at > ${now})
          ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
        )
        RETURNING id, action, minutes, created_at, status, idempotency_key, expires_at, claimed_at, acknowledged_at, failure_reason`,
    ]);
    const device = (needsRowFallback ? commandResults[0] : writtenRows)[0] as DeviceHeartbeatRow | undefined;
    const pending = commandResults[commandResults.length - 1] as unknown as Array<Record<string, unknown>>;
    const claimed = pending[0];
    // BIGINT 列在两种驱动下都可能以字符串返回，统一转成数字后再交给 parseDeviceCommand
    //（与 deviceAdminRoutes 的读数口径一致），否则刚认领的命令会因为类型不符被丢弃。
    const queued = claimed
      ? parseDeviceCommand({
          id: claimed.id,
          action: claimed.action,
          minutes: claimed.minutes == null ? undefined : Number(claimed.minutes),
          createdAt: Number(claimed.created_at),
          status: claimed.status,
          idempotencyKey: claimed.idempotency_key,
          expiresAt: claimed.expires_at == null ? undefined : Number(claimed.expires_at),
          claimedAt: claimed.claimed_at == null ? undefined : Number(claimed.claimed_at),
          acknowledgedAt: claimed.acknowledged_at == null ? undefined : Number(claimed.acknowledged_at),
          failureReason: claimed.failure_reason,
        })
      : null;
    const hasBinding = !!device && (device.revoked === true || device.is_management === true || !!device.class_id);
    // 仅 Vercel：把当前快照版本号随心跳带回，设备据此决定要不要再拉一次快照，
    // 这样常规轮询只剩心跳这一条请求；本地部署后续走 WSS 推送，不带这个字段。
    const examVersion = parseExamVersion(device?.exam_version);
    res.status(200).json({
      ok: true,
      revoked: device?.revoked === true,
      binding: hasBinding
        ? {
            gradeId: device.grade_id ?? '',
            classId: device.class_id ?? '',
            revoked: device.revoked === true,
            isManagement: device.is_management === true,
          }
        : null,
      command: queued ?? parseDeviceCommand(device?.temporary_command) ?? null,
      ...(isEdgeDeployment() ? { version: examVersion } : {}),
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
