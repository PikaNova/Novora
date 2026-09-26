/**
 * 静态资源与 SPA 回退的响应策略。
 *
 * 背景：发布新版本后，客户端可能仍停留在上一版的 index.html 上（用户没刷新页面，
 * 或页面正好跨越了一次发布）。这时延迟加载的分包会去请求上一版的哈希文件名，而该
 * 文件已经随新版本一起被删除。如果服务端此时把 index.html 当成 200 的 JS 返回，
 * 浏览器会因 MIME 不符（text/html 不是 JavaScript）抛出
 * “Failed to fetch dynamically imported module”；更糟的是这个 HTML 响应会带着
 * `immutable, max-age=31536000` 被写进浏览器缓存，之后即使文件补回来也拿不到。
 *
 * 因此约定：缺失的资源必须 404 + no-store，SPA 回退只用于真正的路由路径。
 */
export const IMMUTABLE_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const SPA_FALLBACK_CACHE_CONTROL = 'no-cache';
export const MISSING_ASSET_CACHE_CONTROL = 'no-store';

export type StaticRequestKind = 'file' | 'spa-fallback' | 'missing-asset';

/** 构建产物目录：这里的缺失文件绝不回退到 index.html。 */
const ASSET_PREFIXES = ['/assets/', '/fonts/'];

function isUnderAssetPrefix(pathname: string): boolean {
  return ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** 带扩展名的路径按静态文件对待（`/favicon.svg`、`/robots.txt`、`/assets/x.js`），
 *  不带扩展名的路径才是前端路由（`/login`、`/settings/design`）。 */
export function isAssetLikePath(pathname: string): boolean {
  if (isUnderAssetPrefix(pathname)) return true;
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  return /\.[A-Za-z0-9]+$/.test(lastSegment);
}

export function resolveStaticRequestKind(pathname: string, fileExists: boolean): StaticRequestKind {
  if (fileExists) return 'file';
  return isAssetLikePath(pathname) ? 'missing-asset' : 'spa-fallback';
}

export function cacheControlForStaticRequest(pathname: string, fileExists: boolean): string {
  if (resolveStaticRequestKind(pathname, fileExists) === 'missing-asset') {
    return MISSING_ASSET_CACHE_CONTROL;
  }
  if (isUnderAssetPrefix(pathname)) return IMMUTABLE_ASSET_CACHE_CONTROL;
  return SPA_FALLBACK_CACHE_CONTROL;
}
