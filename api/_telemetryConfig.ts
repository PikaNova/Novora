// —— 遥测连接配置：单一可信来源（Single Source of Truth，随仓库提交）——
//
// 【新架构：不再随源码下发任何固定密钥】
// 之前版本在这里硬编码固定上报凭据，随公开仓库源码一起下发，起不到真正保护作用。
// 现在改为运行时向作者端换取短期签名 token，上报时用它代替固定密钥。
// token 只存在于本 Vercel 函数的内存里，过期自动换新。详见 ./_authorClient.ts。
//
// 解析优先级（从高到低）：
//   1) Vercel 环境变量（仅用于个别实例的临时覆盖，可留空）
//   2) 本文件仓库配置 REPO_*（作者统一维护，随更新自动下发）
//   3) 无（REPO_* 即最终兜底，务必保持有效）
//
// 注意：本配置只在服务端函数（api/*）中使用，不会随浏览器包体下发。

import { ensureTelemetryIpSalt } from './_telemetry/ipSalt.js';

// ==== 作者维护区：域名变更改这里，然后发布新版本即可 ====
const REPO_BASE_URL = 'https://telemetry.pikachu2026.space';
const REPO_COLLECT_URL = '';
const REPO_ANNOUNCE_URL = '';
const REPO_ERROR_REPORT_URL = '';
const REPO_TOKEN_URL = '';
const REPO_UPDATE_URL = '';
const REPO_IMAGES_URL = '';
const REPO_DIAGNOSTIC_URL = '';
// ============================================================

function pick(envVal: string | undefined, repoVal: string): string {
  const value = (envVal ?? '').trim();
  return value || repoVal;
}

const BASE_URL = pick(process.env.TELEMETRY_BASE_URL, REPO_BASE_URL).replace(/\/+$/, '');

export const telemetryConfig = {
  baseUrl: BASE_URL,
  collectUrl: pick(process.env.TELEMETRY_COLLECT_URL, REPO_COLLECT_URL) || `${BASE_URL}/api/collect`,
  announceUrl: pick(process.env.TELEMETRY_ANNOUNCE_URL, REPO_ANNOUNCE_URL) || `${BASE_URL}/api/public-announcements`,
  errorReportUrl: pick(process.env.TELEMETRY_ERROR_REPORT_URL, REPO_ERROR_REPORT_URL) || `${BASE_URL}/api/error-report`,
  tokenUrl: pick(process.env.TELEMETRY_TOKEN_URL, REPO_TOKEN_URL) || `${BASE_URL}/api/issue-client-token`,
  // 下面三条此前直接拼 baseUrl，没有独立覆盖位，所以作者端拆域名时它们无法单独迁移。
  updateUrl: pick(process.env.TELEMETRY_UPDATE_URL, REPO_UPDATE_URL) || `${BASE_URL}/api/releases/latest.json`,
  imagesUrl: pick(process.env.TELEMETRY_IMAGES_URL, REPO_IMAGES_URL) || `${BASE_URL}/api/announcement-images`,
  diagnosticUrl:
    pick(process.env.TELEMETRY_DIAGNOSTIC_URL, REPO_DIAGNOSTIC_URL) || `${BASE_URL}/api/diagnostic-log-bundles`,
} as const;

export type TelemetryConfig = typeof telemetryConfig;

let resolvedIpSaltPromise: Promise<string> | null = null;

export async function resolveIpSalt(): Promise<string> {
  const override = (process.env.TELEMETRY_IP_SALT ?? '').trim();
  if (override) return override;
  if (!resolvedIpSaltPromise) {
    resolvedIpSaltPromise = ensureTelemetryIpSalt().catch((error) => {
      resolvedIpSaltPromise = null;
      throw error;
    });
  }
  return resolvedIpSaltPromise;
}
