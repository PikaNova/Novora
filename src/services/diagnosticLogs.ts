import { getInstanceId, APP_VERSION, COMMIT_SHA } from './telemetry';
import { recordUserAction } from '../utils/diagnostics';
import {
  getDiagnosticBundles,
  getDiagnosticCaptureConfig,
  getLocalLogEntries,
  setDiagnosticCaptureConfig,
  type DiagnosticCaptureConfig,
  type LocalDiagnosticBundle,
} from '../utils/logger';
import { splitDiagnosticParts } from '../shared/diagnosticLogContracts';

export type { DiagnosticCaptureConfig, LocalDiagnosticBundle };

const TOKEN_KEY = 'admin_auth_token';
const LAST_UPLOAD_KEY = 'novora_diagnostic_last_upload_v1';

function authorizationHeader(): Record<string, string> {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...authorizationHeader(), ...(init.headers || {}) },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `请求失败（${response.status}）`);
  return data;
}

export async function loadDiagnosticSettings(): Promise<DiagnosticCaptureConfig> {
  const data = await request('/api/diagnostic-logs?resource=settings');
  const raw = (data.settings || {}) as Partial<DiagnosticCaptureConfig>;
  return setDiagnosticCaptureConfig(raw);
}

export async function saveDiagnosticSettings(config: DiagnosticCaptureConfig): Promise<DiagnosticCaptureConfig> {
  const data = await request('/api/diagnostic-logs?resource=settings', { method: 'PUT', body: JSON.stringify(config) });
  const raw = (data.settings || config) as Partial<DiagnosticCaptureConfig>;
  return setDiagnosticCaptureConfig(raw);
}

function readLastUpload(): Record<string, number> {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_UPLOAD_KEY) || '{}');
    return value && typeof value === 'object' ? (value as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** 上次成功上传（按发送模式分别记录）的时间戳；没有记录时返回 0，即「从有日志起全部」。 */
export function getLastUploadAt(mode: 'date' | 'error'): number {
  const value = readLastUpload()[mode];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function markUploaded(mode: 'date' | 'error', at: number): void {
  try {
    const store = readLastUpload();
    store[mode] = Math.max(getLastUploadAt(mode), Math.round(at));
    localStorage.setItem(LAST_UPLOAD_KEY, JSON.stringify(store));
  } catch {
    /* best effort */
  }
}

/** 「上次上传以来」的全部本地日志：没有上传记录时就是当前保留窗口内的全部日志。 */
export function entriesSinceLastUpload(mode: 'date' | 'error', now = Date.now()) {
  const from = getLastUploadAt(mode);
  return getLocalLogEntries(from > 0 ? from + 1 : 0, now);
}

export async function sendDiagnosticLogs(input: {
  mode: 'date' | 'error';
  fromTs: number;
  toTs: number;
  entries: LocalDiagnosticBundle['entries'];
  bundleId?: string;
  errorEventId?: string;
  fingerprint?: string;
  errorCode?: string;
}): Promise<{ bundleId: string; status: string; parts: number; truncatedCount: number; toTs: number }> {
  recordUserAction(input.mode === 'date' ? '导出诊断日志（按日期）' : '导出诊断日志（按错误）');
  const { parts, truncatedCount } = splitDiagnosticParts(input.entries);
  if (!parts.length) throw new Error('没有可发送的本地日志');
  const baseId = input.bundleId || `bundle_${Date.now().toString(36)}`;
  let bundleId = baseId;
  let status = 'failed';
  for (let index = 0; index < parts.length; index += 1) {
    const partNo = index + 1;
    // 单分片沿用原 bundleId（幂等重试仍然命中同一条记录），多分片才加后缀。
    const partBundleId = parts.length > 1 ? `${baseId}-p${partNo}` : baseId;
    const partEntries = parts[index];
    // 首次上传（还没有「上次上传」记录）时不能把 fromTs 传成 0：服务端按无效范围拒绝。
    // 这种情况下区间从第一条日志算起，语义仍是「全部日志」。
    const firstAt = partEntries[0].at;
    const partFromTs = input.fromTs > 0 ? Math.min(input.fromTs, firstAt) : firstAt;
    const data = await request('/api/diagnostic-logs', {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        bundleId: partBundleId,
        entries: partEntries,
        partNo,
        partTotal: parts.length,
        truncatedCount,
        fromTs: partFromTs,
        toTs: Math.max(...partEntries.map((entry) => entry.at), input.toTs),
        instanceId: getInstanceId(),
        appVersion: APP_VERSION,
        commitSha: COMMIT_SHA,
      }),
    });
    bundleId = String(data.bundleId || partBundleId);
    status = String(data.status || 'failed');
    if (status !== 'sent') break;
  }
  const toTs = Math.max(...input.entries.map((entry) => entry.at), input.toTs);
  if (status === 'sent') markUploaded(input.mode, toTs);
  return { bundleId, status, parts: parts.length, truncatedCount, toTs };
}

export function localDiagnosticSnapshot(): { config: DiagnosticCaptureConfig; bundles: LocalDiagnosticBundle[] } {
  return { config: getDiagnosticCaptureConfig(), bundles: getDiagnosticBundles() };
}

export function entriesForDate(fromTs: number, toTs: number) {
  return getLocalLogEntries(fromTs, toTs);
}
