import { isChunkLoadError, shouldRetryChunkLoad } from '../shared/chunkLoadError';

const CHUNK_RELOAD_KEY = 'novora_chunk_reload_at_v1';
/** 留出一点时间让错误上报（keepalive）先发出去，再刷新页面。 */
const RELOAD_DELAY_MS = 300;

let installed = false;

function readReloadStamp(): number | undefined {
  try {
    const value = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    // 读不到时间戳时不做自动刷新，避免陷入刷新循环。
    return undefined;
  }
}

/** 分包加载失败后自动刷新一次；返回 true 表示已经安排了刷新。 */
export function reloadOnceForChunkError(now: number = Date.now()): boolean {
  if (typeof window === 'undefined') return false;
  const stamp = readReloadStamp();
  if (stamp === undefined || !shouldRetryChunkLoad(stamp, now)) return false;
  try {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
  return true;
}

export function recoverFromChunkLoadError(error: unknown): boolean {
  if (!isChunkLoadError(error)) return false;
  return reloadOnceForChunkError();
}

/**
 * 清掉 Service Worker 与它写下的静态缓存后强刷。
 * 用于「资源版本错乱且自动刷新无效」的兜底：缓存里可能已经存了错误的响应，
 * 普通刷新仍会命中它。业务数据在 localStorage，不受影响。
 */
export async function hardReloadWithCacheClear(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('novora-')).map((key) => caches.delete(key)));
    }
  } catch {
    // 清缓存失败也照样刷新，剩下的交给浏览器强刷。
  }
  window.location.reload();
}

/**
 * 兜住不经过 React 的错误边界的分包加载失败。
 * Vite 的预加载辅助函数在 import() 失败时会派发 `vite:preloadError`
 * （payload 是原始错误），随后继续抛出该错误；React.lazy 的场景由
 * ErrorBoundary 接管。这里只负责恢复，绝不能 preventDefault，否则调用方
 * 会拿到 undefined 的模块。
 */
export function installChunkLoadRecovery(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('vite:preloadError', (event) => {
    recoverFromChunkLoadError((event as Event & { payload?: unknown }).payload);
  });
  window.addEventListener('unhandledrejection', (event) => {
    recoverFromChunkLoadError((event as PromiseRejectionEvent).reason);
  });
  window.addEventListener('error', (event) => {
    recoverFromChunkLoadError((event as ErrorEvent).error);
  });
}
