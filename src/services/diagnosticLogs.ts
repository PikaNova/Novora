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
import { authHeaders } from './auth/session';

export type { DiagnosticCaptureConfig, LocalDiagnosticBundle };

const MINUTE_MS = 60000;
/** 「按时间发送」的默认区间：最近 24 小时；管理员可自行收窄或放宽。 */
const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000;

async function request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init.headers || {}) },
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

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** DateTimeField 的线格式（本地时间、不带时区）：YYYY-MM-DDTHH:mm。 */
export function timestampToField(at: number): string {
  const date = new Date(at);
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

/**
 * 把 DateTimeField 的值解析成本地时间戳。
 * 只接受完整的 `YYYY-MM-DDTHH:mm`；格式不符或日期本身不存在（例如 2026-02-30）返回 null，
 * 避免把 Date 的自动进位当成合法输入。
 */
export function timestampFromField(value: string): number | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const hour = Number(matched[4]);
  const minute = Number(matched[5]);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  return date.getTime();
}

/** 「按时间发送」的默认区间：最近 24 小时，截到分钟。 */
export function defaultDiagnosticRange(now = Date.now()): { from: string; to: string } {
  const to = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  return { from: timestampToField(to - DEFAULT_RANGE_MS), to: timestampToField(to) };
}

/** 指定时间区间内的本地日志（闭区间）。 */
export function entriesInRange(fromTs: number, toTs: number) {
  return getLocalLogEntries(fromTs, toTs);
}

/** 本机保留期内的全部日志：一键「发送错误日志」打的诊断包用。 */
export function allRetainedEntries(now = Date.now()) {
  return getLocalLogEntries(0, now);
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
    // 服务端拒收 fromTs<=0；调用方没给区间时落到本片第一条日志，语义仍是「这些日志的全量」。
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
  return { bundleId, status, parts: parts.length, truncatedCount, toTs };
}

export function localDiagnosticSnapshot(): { config: DiagnosticCaptureConfig; bundles: LocalDiagnosticBundle[] } {
  return { config: getDiagnosticCaptureConfig(), bundles: getDiagnosticBundles() };
}
