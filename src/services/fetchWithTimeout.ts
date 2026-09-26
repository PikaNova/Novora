import { timeoutApiError } from './apiError';
import { noteApiResult } from '../utils/diagnostics';

export type FetchOptions = RequestInit & {
  /**
   * 相同 GET 在途时合并成一次网络请求。默认开启；非 GET 一律忽略。
   *
   * 合并的是「同时在途的重复」，不是给 GET 加缓存：`cache: 'no-store'` 的语义不变，
   * 下一次交互仍然会真正打到服务器。
   */
  dedupe?: boolean;
  /**
   * 合并窗口（毫秒）：请求完成后仍在窗口内复用同一结果，用来吸收紧挨着发出的重复。
   * 默认 0，表示只合并在途请求。
   */
  dedupeWindowMs?: number;
};

type InflightEntry = {
  promise: Promise<Response>;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  /** 本批的整批超时，后来加入的调用方可以把它延长。 */
  timeoutMs: number;
  startedAt: number;
  /** 结果窗口的到期时间；在途期间为 Number.POSITIVE_INFINITY。 */
  expiresAt: number;
  settled: boolean;
};

/**
 * 在途请求表：key 是「方法 + URL + 鉴权指纹」。
 *
 * 为什么需要它：高延迟链路上每个请求都是 0.4~1.2s，而一屏会重复发同一个查询
 * （面板挂载、依赖变化、多组件各拉一次）。合并后同样的等待时间只付一次。
 */
const inflight = new Map<string, InflightEntry>();

/** 登出 / 切换账号时调用：清空在途表，避免把上一个身份的结果复用给下一个身份。 */
export function clearRequestDedupe(): void {
  for (const entry of inflight.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  inflight.clear();
}

function httpMethod(options: RequestInit): string {
  return String(options.method || 'GET').toUpperCase();
}

function headerValue(headers: HeadersInit | undefined, name: string): string {
  if (!headers) return '';
  const wanted = name.toLowerCase();
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(name) ?? '';
  }
  if (Array.isArray(headers)) {
    const hit = headers.find(([key]) => String(key).toLowerCase() === wanted);
    return hit ? String(hit[1]) : '';
  }
  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    if (key.toLowerCase() === wanted) return String(value);
  }
  return '';
}

/** 只把鉴权头哈希进 key：不同身份（管理端 token / 设备 token）的请求不能互相复用。 */
function authFingerprint(headers: HeadersInit | undefined): string {
  const token = headerValue(headers, 'authorization');
  if (!token) return '';
  let hash = 0;
  for (let index = 0; index < token.length; index += 1) {
    hash = (hash * 31 + token.charCodeAt(index)) | 0;
  }
  return `#${(hash >>> 0).toString(36)}`;
}

function requestUrl(url: RequestInfo | URL): string {
  if (typeof url === 'string') return url;
  if (typeof URL !== 'undefined' && url instanceof URL) return url.toString();
  return (url as Request).url;
}

function endpointOf(url: RequestInfo | URL): string {
  const raw = requestUrl(url);
  const queryAt = raw.indexOf('?');
  return queryAt >= 0 ? raw.slice(0, queryAt) : raw;
}

/**
 * 带超时控制的 fetch 封装。
 *
 * - 默认 15s 超时；写操作建议传入 20s。
 * - 如果 fetch 被 AbortController 取消，抛出 NETWORK_TIMEOUT ApiError，
 *   而非原始 AbortError，方便上层统一处理。
 * - GET 默认做在途合并（见 FetchOptions），每个等待者拿到独立的 Response 副本，
 *   所以调用方照旧可以各自 `response.json()`。
 */
export async function fetchWithTimeout(
  url: RequestInfo | URL,
  options: FetchOptions = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const { dedupe = true, dedupeWindowMs = 0, ...init } = options;
  const method = httpMethod(init);
  const endpoint = endpointOf(url);
  const startedAt = Date.now();
  const canDedupe = dedupe && method === 'GET';

  /** 起一个真实请求，并把它登记为可共享的在途条目。 */
  const startEntry = (): InflightEntry => {
    const controller = new AbortController();
    const entry: InflightEntry = {
      promise: Promise.resolve(new Response()),
      controller,
      timer: setTimeout(() => controller.abort(), timeoutMs),
      timeoutMs,
      startedAt,
      expiresAt: Number.POSITIVE_INFINITY,
      settled: false,
    };
    entry.promise = (async () => {
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        noteApiResult({
          endpoint,
          status: response.status,
          durationMs: Date.now() - startedAt,
          ok: response.ok,
          method,
        });
        return response;
      } catch (err) {
        noteApiResult({ endpoint, status: null, durationMs: Date.now() - startedAt, ok: false, method });
        if ((err as Error).name === 'AbortError') throw timeoutApiError();
        throw err;
      } finally {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = null;
      }
    })();
    return entry;
  };

  // 写请求、显式关闭合并的请求：照原样每次发。
  if (!canDedupe) return startEntry().promise;

  const key = `${method} ${requestUrl(url)}${authFingerprint(init.headers)}`;
  const now = Date.now();
  const existing = inflight.get(key);
  if (existing) {
    if (existing.settled && existing.expiresAt <= now) {
      inflight.delete(key);
    } else {
      if (!existing.settled && timeoutMs > existing.timeoutMs && existing.timer) {
        // 后来者可以要求更长的超时：按「本批起点 + 新超时」延长。
        clearTimeout(existing.timer);
        existing.timeoutMs = timeoutMs;
        const remaining = Math.max(0, existing.startedAt + timeoutMs - Date.now());
        existing.timer = setTimeout(() => existing.controller.abort(), remaining);
      }
      const shared = await existing.promise;
      return shared.clone();
    }
  }

  const entry = startEntry();
  inflight.set(key, entry);

  try {
    const response = await entry.promise;
    if (dedupeWindowMs > 0) {
      entry.settled = true;
      entry.expiresAt = Date.now() + dedupeWindowMs;
      entry.timer = setTimeout(() => {
        if (inflight.get(key) === entry && Date.now() >= entry.expiresAt) inflight.delete(key);
      }, dedupeWindowMs + 10);
    } else {
      inflight.delete(key);
    }
    return response.clone();
  } catch (error) {
    inflight.delete(key);
    throw error;
  }
}
