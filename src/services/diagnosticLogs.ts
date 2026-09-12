import { getInstanceId, APP_VERSION, COMMIT_SHA } from './telemetry';
import {
  getDiagnosticBundles,
  getDiagnosticCaptureConfig,
  getLocalLogEntries,
  setDiagnosticCaptureConfig,
  type DiagnosticCaptureConfig,
  type LocalDiagnosticBundle,
} from '../utils/logger';

export type { DiagnosticCaptureConfig, LocalDiagnosticBundle };

const TOKEN_KEY = 'admin_auth_token';

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

export async function sendDiagnosticLogs(input: {
  mode: 'date' | 'error';
  fromTs: number;
  toTs: number;
  entries: LocalDiagnosticBundle['entries'];
  bundleId?: string;
  errorEventId?: string;
  fingerprint?: string;
  errorCode?: string;
}): Promise<{ bundleId: string; status: string }> {
  const data = await request('/api/diagnostic-logs', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      instanceId: getInstanceId(),
      appVersion: APP_VERSION,
      commitSha: COMMIT_SHA,
    }),
  });
  return { bundleId: String(data.bundleId || input.bundleId || ''), status: String(data.status || 'failed') };
}

export function localDiagnosticSnapshot(): { config: DiagnosticCaptureConfig; bundles: LocalDiagnosticBundle[] } {
  return { config: getDiagnosticCaptureConfig(), bundles: getDiagnosticBundles() };
}

export function entriesForDate(fromTs: number, toTs: number) {
  return getLocalLogEntries(fromTs, toTs);
}
