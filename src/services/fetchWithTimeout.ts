import { timeoutApiError } from './apiError';
import { noteApiResult } from '../utils/diagnostics';

/**
 * 带超时控制的 fetch 封装。
 *
 * - 默认 15s 超时；写操作建议传入 20s。
 * - 如果 fetch 被 AbortController 取消，抛出 NETWORK_TIMEOUT ApiError，
 *   而非原始 AbortError，方便上层统一处理。
 */
export async function fetchWithTimeout(
  url: RequestInfo | URL,
  options: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = typeof url === 'string' ? url : url instanceof URL ? url.pathname : '';
  const method = String(options.method || 'GET').toUpperCase();
  const startedAt = Date.now();

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    noteApiResult({
      endpoint,
      status: response.status,
      durationMs: Date.now() - startedAt,
      ok: response.ok,
      method,
    });
    return response;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      noteApiResult({ endpoint, status: null, durationMs: Date.now() - startedAt, ok: false, method });
      throw timeoutApiError();
    }
    noteApiResult({ endpoint, status: null, durationMs: Date.now() - startedAt, ok: false, method });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
