// api/_telemetry/ipSalt.ts
// 遥测 IP 脱敏用的一次性持久盐。原先寄住在 api/_auth.ts，仅因为它要复用
// auth 的建表流程；现在独立成模块，遥测的脱敏策略改动不再开鉴权文件。
// 兼容路径不会把该值返回给任何接口或日志。
import { randomBytes } from 'node:crypto';
import { assertRows } from '../_validation.js';
import { authSql, ensureAuthTables } from '../_auth/db.js';
import { isIpSaltRow } from '../_auth/shapes.js';

let telemetryIpSaltPromise: Promise<string> | null = null;

/**
 * Creates one server-only, persistent salt for telemetry IP pseudonymization.
 * The compatibility path never exposes this value in API responses or logs.
 */
export async function ensureTelemetryIpSalt(): Promise<string> {
  if (!telemetryIpSaltPromise) {
    telemetryIpSaltPromise = (async () => {
      await ensureAuthTables();
      const sql = authSql();
      const generated = randomBytes(24).toString('base64url');
      await sql`INSERT INTO app_telemetry_config (id, ip_salt, created_at)
        VALUES (1, ${generated}, ${Date.now()}) ON CONFLICT (id) DO NOTHING`;
      const rows = assertRows(
        await sql`SELECT ip_salt FROM app_telemetry_config WHERE id=1`,
        isIpSaltRow,
        'app_telemetry_config',
      );
      const value = rows[0]?.ip_salt;
      if (!value) throw new Error('Telemetry IP salt is unavailable');
      return value;
    })().catch((error) => {
      telemetryIpSaltPromise = null;
      throw error;
    });
  }
  return telemetryIpSaltPromise;
}
