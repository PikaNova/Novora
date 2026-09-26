/**
 * 构建身份：让线上实例能自报「跑的是哪一次构建」。
 *
 * 没有这个字段时，判断"改动有没有生效"只能靠猜（chunk 哈希、schema 版本这类间接证据，
 * 而 schema 版本可能来自别人的未合并分支）。部署时把 commit 传进来，健康检查一看便知。
 *
 * 来源优先级：
 *   1. COMMIT_SHA        —— Docker 构建参数 / 本地脚本注入
 *   2. VERCEL_GIT_COMMIT_SHA —— Vercel 自动提供
 *   3. GIT_COMMIT        —— CI 常见变量
 * 容器里没有 .git（.dockerignore 排除了），所以不能靠 git 命令兜底。
 */
const MAX_COMMIT_LENGTH = 40;

let cachedCommit: string | null | undefined;

export function resolveBuildCommit(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env === process.env && cachedCommit !== undefined) return cachedCommit;
  const raw = env.COMMIT_SHA || env.VERCEL_GIT_COMMIT_SHA || env.GIT_COMMIT || '';
  const trimmed = String(raw).trim().slice(0, MAX_COMMIT_LENGTH);
  const value = trimmed.length > 0 ? trimmed : null;
  if (env === process.env) cachedCommit = value;
  return value;
}

/** 仅供测试：清掉进程级缓存。 */
export function __resetBuildInfoForTests(): void {
  cachedCommit = undefined;
}
