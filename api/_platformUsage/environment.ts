// 平台运行环境识别：决定前端是否展示 Vercel / Neon 额度面板。
//
// 约定（与产品需求一致）：
// - 本地 / 内网部署不启用该功能，即使 DATABASE_URL 指向 Neon 也不启用；
// - Vercel 卡片只在 Vercel 运行时出现；
// - Neon 卡片只在「Vercel 运行时 + Neon 数据库」同时成立时出现。
//
// 这两个开关分开计算，前端按平台分别渲染，互不影响。

export type PlatformRuntime = 'vercel' | 'local';
export type PlatformDatabase = 'neon' | 'postgres' | 'unknown';

export type PlatformEnvironment = {
  runtime: PlatformRuntime;
  database: PlatformDatabase;
  /** Vercel 额度面板是否启用。 */
  vercel: boolean;
  /** Neon 额度面板是否启用。 */
  neon: boolean;
  /** 本地部署（不展示任何平台面板）。 */
  local: boolean;
};

/**
 * 判断连接串是否指向 Neon。
 *
 * 与 api/_dbAdapter.ts 的 isNeonEndpoint 保持同一判据（host 含 neon.tech 或带
 * channel_binding 参数），但这里不导入数据库驱动，避免把 Neon HTTP 客户端带进
 * 单元测试与本地构建。
 */
export function isNeonConnectionString(connectionString: string | null | undefined): boolean {
  if (!connectionString) return false;
  try {
    const url = new URL(connectionString);
    return url.hostname.toLowerCase().includes('neon.tech') || url.searchParams.has('channel_binding');
  } catch {
    return connectionString.toLowerCase().includes('neon.tech');
  }
}

export function detectPlatformEnvironment(
  env: { VERCEL?: string | undefined } = process.env,
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): PlatformEnvironment {
  const runtime: PlatformRuntime = env?.VERCEL ? 'vercel' : 'local';
  const database: PlatformDatabase = databaseUrl
    ? isNeonConnectionString(databaseUrl)
      ? 'neon'
      : 'postgres'
    : 'unknown';
  const isVercel = runtime === 'vercel';
  return {
    runtime,
    database,
    vercel: isVercel,
    neon: isVercel && database === 'neon',
    local: !isVercel,
  };
}
