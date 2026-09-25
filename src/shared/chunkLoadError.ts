/**
 * 动态分包加载失败的识别与自动恢复节流。
 *
 * 触发场景见 `src/shared/staticAssetPolicy.ts`：发布新版本后，停留在旧 index.html
 * 上的页面会请求已被删除的旧哈希分包，浏览器抛出下列错误。这类失败刷新一次即可
 * 恢复，但必须节流，否则离线或服务端异常时会陷入刷新循环。
 */
export const CHUNK_RELOAD_COOLDOWN_MS = 20_000;

export const CHUNK_LOAD_ERROR_PATTERNS = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'failed to load module script',
  'unable to preload css for',
] as const;

export function chunkErrorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';
  const record = error as { name?: unknown; message?: unknown };
  const name = typeof record.name === 'string' ? record.name : '';
  const message = typeof record.message === 'string' ? record.message : '';
  return `${name} ${message}`.trim();
}

export function isChunkLoadError(error: unknown): boolean {
  const text = chunkErrorText(error).toLowerCase();
  if (!text) return false;
  return CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

/** 距离上次自动刷新超过冷却时间（或从未刷新过）时才允许再次刷新。 */
export function shouldRetryChunkLoad(lastAttemptAt: number | null | undefined, now: number): boolean {
  if (!lastAttemptAt || !Number.isFinite(lastAttemptAt)) return true;
  return now - lastAttemptAt >= CHUNK_RELOAD_COOLDOWN_MS;
}
