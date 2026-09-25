// api/_auth/seeds.ts
// 初始化数据与一次性数据迁移。与建表语句（./tables.ts）分开，
// 这样「加一张表」和「改一次存量数据」不会挤在同一个文件里互相牵制。
import type { DbClient } from '../_dbAdapter.js';
import { BUILTIN_ROLES } from './roles.js';

/** 内置角色的幂等种子：每次启动都对齐文案与权限清单。 */
export async function seedBuiltinRoles(sql: DbClient, now: number): Promise<void> {
  await Promise.all(
    BUILTIN_ROLES.map(
      (role) => sql`INSERT INTO app_roles (id, name, description, permissions, built_in, created_at, updated_at)
      VALUES (${role.id}, ${role.name}, ${role.description}, ${JSON.stringify(role.permissions)}::jsonb, TRUE, ${now}, ${now})
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, permissions=EXCLUDED.permissions, built_in=TRUE, updated_at=EXCLUDED.updated_at`,
    ),
  );
}

/** v1.32：精简旧内置角色。教务管理员降为全范围年级管理员，设备管理员迁移为巡考员（viewer）。 */
export async function migrateLegacyRoleAssignments(sql: DbClient, now: number): Promise<void> {
  await sql`UPDATE app_users SET role_id='grade_admin', token_version=token_version+1, updated_at=${now} WHERE role_id='academic_admin'`;
  await sql`UPDATE app_users SET role_id='viewer', token_version=token_version+1, updated_at=${now} WHERE role_id='device_admin'`;
  await sql`DELETE FROM app_roles WHERE id IN ('academic_admin','device_admin') AND NOT EXISTS (SELECT 1 FROM app_users WHERE app_users.role_id=app_roles.id)`;
  await sql`UPDATE app_roles SET name='班级访客', description='未登录设备可查看本班考试安排、周测与教室大屏，可导出核对，不修改任何数据。', updated_at=${now} WHERE id='viewer'`;
}

/** 邮件节流的单行状态，配合 email_outbox 使用。 */
export async function seedMailThrottleRow(sql: DbClient): Promise<void> {
  await sql`INSERT INTO mail_throttle (id, last_sent_at) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`;
}
