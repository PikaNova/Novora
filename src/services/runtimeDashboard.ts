import { authHeaders } from './auth/session';
import type { RuntimeEvent } from '../shared/runtimeLog';
export type RuntimeRow = { id: string; instance_id: string; received_at: number; event: RuntimeEvent };
export type RuntimeDashboard = {
  ok: true;
  fetchedAt: number;
  range: { from: number; to: number };
  entries: RuntimeRow[];
  hasMore: boolean;
  nextCursor: string | null;
  summary: { total: number; errors: number; warnings: number };
  trend: { at: number; total: number; errors: number }[];
  devices: {
    instance_id: string;
    page: string;
    client_version: string;
    last_seen_at: number;
    revoked: boolean;
  }[];
  storage: { fileFallback: boolean; fileFailed: boolean; queued: number; dropped: number };
};
export async function runtimeRequest<T>(
  resource: string,
  params: Record<string, string> = {},
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/diagnostic-logs?${new URLSearchParams({ resource, ...params })}`, {
    method: body ? 'POST' : 'GET',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || `请求失败（${response.status}）`);
  return data as T;
}
