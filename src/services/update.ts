/**
 * 版本与更新服务（客户端）。
 * - checkForUpdate：调用 /api/update-check 与 GitHub 最新版本比较。
 * - getRedeployConfigured：查询是否已配置 Vercel 部署钩子。
 * - triggerRedeploy：触发一键重新部署（需管理 token）。
 */

const CHECK_URL = '/api/update-check';
const REDEPLOY_URL = '/api/redeploy';
const TOKEN_KEY = 'admin_auth_token';

export interface UpdateInfo {
  ok: boolean;
  repo?: string;
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  releaseUrl?: string | null;
  notes?: string | null;
  publishedAt?: string | null;
  source?: 'release' | 'tag' | 'none';
  error?: string;
}

export async function checkForUpdate(current: string): Promise<UpdateInfo> {
  try {
    const res = await fetch(`${CHECK_URL}?current=${encodeURIComponent(current)}`, {
      headers: { 'Cache-Control': 'no-store' },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return { ok: false, current, latest: null, hasUpdate: false, error: data?.error || `HTTP ${res.status}` };
    }
    return data as UpdateInfo;
  } catch (e) {
    return { ok: false, current, latest: null, hasUpdate: false, error: e instanceof Error ? e.message : '网络错误' };
  }
}

export async function getRedeployConfigured(): Promise<boolean> {
  try {
    const res = await fetch(REDEPLOY_URL, { headers: { 'Cache-Control': 'no-store' } });
    const data = await res.json().catch(() => null);
    return !!data?.configured;
  } catch {
    return false;
  }
}

export interface RedeployResult {
  ok: boolean;
  error?: string;
  code?: string;
  job?: unknown;
}

export async function triggerRedeploy(): Promise<RedeployResult> {
  try {
    const headers: Record<string, string> = {};
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(REDEPLOY_URL, { method: 'POST', headers });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, code: data?.code };
    }
    return { ok: true, job: data.job };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '网络错误' };
  }
}
