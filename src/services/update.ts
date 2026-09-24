/**
 * 版本与更新服务（客户端）。
 * - checkForUpdate：调用 /api/update-check 与 GitHub 最新版本比较。
 * - getRedeployConfigured：查询是否已配置 Vercel 部署钩子。
 * - triggerRedeploy：触发一键重新部署（需管理 token）。
 */

import { recordUserAction } from '../utils/diagnostics';

// 检查更新与一键部署已合并进 /api/system（Vercel Hobby 单次部署最多 12 个函数），
// 旧地址 /api/update-check、/api/redeploy 仍由 vercel.json rewrite 兜底；
// 这里直接用规范地址，查询串写在请求本身、不经过 rewrite，参数不会被丢掉。
const CHECK_URL = '/api/system?sys=update-check';
const REDEPLOY_URL = '/api/system?sys=redeploy';
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
  /** 版本来源：registry = 作者端登记的产品发布（权威）；github/release/tag = 兜底来源。 */
  origin?: 'registry' | 'github';
  source?: 'registry' | 'author' | 'release' | 'tag' | 'none';
  channel?: 'stable' | 'beta';
  /** 部署契约：拉哪个镜像、校验哪个摘要、要求 schema 到哪一版。 */
  image?: string | null;
  digest?: string | null;
  minSchema?: string | null;
  schemaVersion?: number | null;
  schemaReady?: boolean | null;
  warnings?: string[];
  error?: string;
}

export async function checkForUpdate(current: string): Promise<UpdateInfo> {
  recordUserAction('检查更新');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(`${CHECK_URL}&current=${encodeURIComponent(current)}`, {
        headers: { 'Cache-Control': 'no-store' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return { ok: false, current, latest: null, hasUpdate: false, error: data?.error || `HTTP ${res.status}` };
    }
    return data as UpdateInfo;
  } catch (e) {
    return { ok: false, current, latest: null, hasUpdate: false, error: e instanceof Error ? e.message : '网络错误' };
  }
}

export interface DeployStatus {
  configured: boolean;
  deployTarget: 'vercel' | 'local';
}

export async function getDeployStatus(): Promise<DeployStatus> {
  try {
    const res = await fetch(REDEPLOY_URL, { headers: { 'Cache-Control': 'no-store' } });
    const data = await res.json().catch(() => null);
    return {
      configured: !!data?.configured,
      deployTarget: data?.deployTarget === 'vercel' ? 'vercel' : 'local',
    };
  } catch {
    return { configured: false, deployTarget: 'local' };
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
  recordUserAction('触发重新部署');
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
