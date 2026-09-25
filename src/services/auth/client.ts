// src/services/auth/client.ts
// 带鉴权与统一 401 语义的请求入口。
//
// 与 ./session.ts 的分工：session 只管「凭据存在哪儿、还在不在」，client 管「怎么带着它发请求」。
// 拆开的原因是 session 必须保持零依赖（它会出现在纯 node 单测的模块图里），而 client 需要
// fetchWithTimeout（超时、GET 在途合并、诊断埋点）。

import { fetchWithTimeout, type FetchOptions } from '../fetchWithTimeout';
import { clearAuthSession, getAuthToken } from './session';

function mergeHeaders(headers: HeadersInit | undefined, extra: Record<string, string>): HeadersInit {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    const merged = new Headers(headers);
    for (const [key, value] of Object.entries(extra)) merged.set(key, value);
    return merged;
  }
  if (Array.isArray(headers)) {
    return [...headers, ...Object.entries(extra)];
  }
  return { ...((headers as Record<string, string> | undefined) ?? {}), ...extra };
}

/**
 * 带鉴权的 fetch：自动补 Authorization，并在「本请求确实带了令牌却被回 401」时清会话。
 *
 * 只看带了令牌的请求：401 也可能来自本来就要匿名访问的接口，那时不该把管理端会话清掉。
 * 超时、GET 在途合并、错误分类照旧交给 fetchWithTimeout，调用方原有的 ApiError 处理不变。
 */
export async function apiFetch(url: RequestInfo | URL, init: FetchOptions = {}, timeoutMs = 15_000): Promise<Response> {
  const token = getAuthToken();
  const response = await fetchWithTimeout(
    url,
    token ? { ...init, headers: mergeHeaders(init.headers, { Authorization: `Bearer ${token}` }) } : init,
    timeoutMs,
  );
  if (token && response.status === 401) clearAuthSession();
  return response;
}
