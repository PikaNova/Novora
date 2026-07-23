// —— 遥测连接配置：单一可信来源（Single Source of Truth，随仓库提交）——
//
// 【新逻辑：随 GitHub 更新 / 重新部署自动切换域名】
// 作者端遥测台域名到期或更换时，只需在本仓库改这里的 REPO_* 常量，提交并发布一个
// 新的 GitHub Release。各「考试看板」客户端在设置页「🚀 版本与更新」里点击
// 「检查更新 → 一键重新部署」后，Vercel Deploy Hook 会从 GitHub 拉取最新代码重新构建，
// 【在重新部署过程中自动应用】本文件里的新域名与相关变量 —— 部署者无需手动改任何 Vercel 环境变量。
//
// 解析优先级（从高到低）：
//   1) Vercel 环境变量（仅用于个别实例的临时覆盖，可留空）
//   2) 本文件仓库配置 REPO_*（作者统一维护，随更新自动下发的主渠道）
//   3) 无（REPO_* 即最终兜底，务必保持有效）
//
// 注意：本配置只在服务端函数（api/*）中使用，密钥不会随浏览器包体下发。

// ==== 作者维护区：域名/密钥变更改这里，然后发布新版本即可 ====
const REPO_BASE_URL = 'https://telemetry.pikachu2026.space';
// 如上报/公告使用了与 BASE_URL 不同规则的完整地址，可在此直接写死；留空则由 BASE_URL 自动拼接。
const REPO_COLLECT_URL = '';
const REPO_ANNOUNCE_URL = '';
const REPO_INGEST_KEY = 'tH6yZ0aN4fA1iM0rC0bP4eG9eW5sR6xM';
const REPO_IP_SALT = 'exam-board-telemetry-salt-2026';
// ============================================================

function pick(envVal: string | undefined, repoVal: string): string {
  const v = (envVal ?? '').trim();
  return v || repoVal;
}

const BASE_URL = pick(process.env.TELEMETRY_BASE_URL, REPO_BASE_URL).replace(/\/+$/, '');

export const telemetryConfig = {
  baseUrl: BASE_URL,
  collectUrl: pick(process.env.TELEMETRY_COLLECT_URL, REPO_COLLECT_URL) || `${BASE_URL}/api/collect`,
  announceUrl:
    pick(process.env.TELEMETRY_ANNOUNCE_URL, REPO_ANNOUNCE_URL) || `${BASE_URL}/api/public-announcements`,
  ingestKey: pick(process.env.TELEMETRY_INGEST_KEY, REPO_INGEST_KEY),
  ipSalt: pick(process.env.TELEMETRY_IP_SALT, REPO_IP_SALT),
} as const;

export type TelemetryConfig = typeof telemetryConfig;
