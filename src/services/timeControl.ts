import { authHeaders } from './auth/session';

export type GlobalTimeControl = {
  offsetMs: number;
  revision: number;
  syncRequestId: string;
  syncRequestedAt: number;
  updatedAt: number;
  sync: { online: number; synced: number; failed: number; pending: number; total: number } | null;
};

async function request<T>(method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<T> {
  const url = method === 'GET' ? '/api/exams?action=time-control' : '/api/exams';
  const response = await fetch(url, {
    method,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    ...(body ? { body: JSON.stringify({ action: 'time-control', ...body }) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || `请求失败（${response.status}）`);
  return data as T;
}

export function getGlobalTimeControl(): Promise<GlobalTimeControl> {
  return request('GET');
}

export async function requestGlobalTimeSync(): Promise<void> {
  await request('POST', { operation: 'request-sync' });
}

export async function saveGlobalTimeOffset(offsetMs: number): Promise<void> {
  await request('POST', { operation: 'set-offset', offsetMs });
}
