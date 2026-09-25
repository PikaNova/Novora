// api/_auth/audit.ts
// 审计写入。与鉴权流程解耦：未来改成异步队列或不可篡改存储时，
// 业务侧调用的 writeAudit 签名不变。
import { authSql, ensureAuthTables } from './db.js';
import type { AdminActor } from './shapes.js';

export async function writeAudit(
  actor: AdminActor | null,
  action: string,
  resourceType: string,
  resourceId = '',
  detail: unknown = null,
  gradeId = '',
  classId = '',
): Promise<void> {
  try {
    await ensureAuthTables();
    await authSql()`INSERT INTO app_audit_logs (user_id, username, action, resource_type, resource_id, grade_id, class_id, detail, created_at)
      VALUES (${actor?.id ?? null}, ${actor?.username ?? ''}, ${action}, ${resourceType}, ${resourceId}, ${gradeId}, ${classId}, ${detail == null ? null : JSON.stringify(detail)}::jsonb, ${Date.now()})`;
  } catch {
    /* 审计失败不能让业务操作产生第二次提交。 */
  }
}
