import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthorConfig, getIngestToken } from '../_authorClient.js';
import { telemetryConfig } from '../_telemetryConfig.js';
import {
  buildErrorReportFingerprint,
  normalizeErrorReportLevel,
  normalizeErrorReportSeverity,
  normalizeErrorReportSource,
  normalizeErrorReportType,
  sanitizeErrorReportBreadcrumbs,
  sanitizeErrorReportContext,
  sanitizeErrorReportPayload,
  sanitizeErrorReportPath,
  sanitizeErrorReportRecord,
  sanitizeErrorReportStack,
  sanitizeErrorReportText,
} from '../../src/shared/errorReportContracts.js';

const ERROR_REPORT_URL = telemetryConfig.errorReportUrl;

function str(value: unknown, max = 2000): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function num(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

// 对外仍是 POST /api/error-report，由 api/telemetry.ts 按 ?sys=error-report 分发。
export async function handleErrorReport(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  try {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const instanceId = str(body.instanceId, 128);
    const message = str(body.message, 2000);
    if (!instanceId || !message) {
      res.status(400).json({ ok: false, error: 'missing instanceId/message' });
      return;
    }

    const config = await getAuthorConfig();
    if (!config.errorReportEnabled) {
      res.json({ ok: true, skipped: true, reason: 'disabled' });
      return;
    }
    const appVersionForGate = str(body.appVersion, 32);
    if (appVersionForGate && config.disabledVersions.includes(appVersionForGate)) {
      res.json({ ok: true, skipped: true, reason: 'version_disabled' });
      return;
    }
    const type = normalizeErrorReportType(body.type || (body.apiEndpoint ? 'api' : undefined));
    const errorName = sanitizeErrorReportText(body.errorName, 120);
    const sanitizedMessage = sanitizeErrorReportText(message);
    const route = sanitizeErrorReportPath(body.route);
    const apiEndpoint = sanitizeErrorReportPath(body.apiEndpoint, 160);
    const sanitized = sanitizeErrorReportPayload({
      instanceId,
      type,
      level: normalizeErrorReportLevel(body.level),
      fingerprint: buildErrorReportFingerprint({
        type,
        errorName,
        message: sanitizedMessage || message,
        route,
        apiEndpoint,
      }),
      errorName,
      message: sanitizedMessage || message,
      stack: sanitizeErrorReportStack(str(body.stack, config.maxStackLength)),
      route,
      action: sanitizeErrorReportText(body.action, 100),
      apiEndpoint,
      httpStatus: num(body.httpStatus),
      context: sanitizeErrorReportContext(body.context),
      // 设备与归因字段：作者端按 device_id / error_source / severity 落库。
      // 少了这里（或共享契约的白名单）它们会在中继层被静默丢掉。
      deviceId: sanitizeErrorReportText(body.deviceId, 96),
      errorSource: normalizeErrorReportSource(body.errorSource),
      severity: normalizeErrorReportSeverity(body.severity),
      operatorMessage: sanitizeErrorReportText(body.operatorMessage, 500),
      suggestedAction: sanitizeErrorReportText(body.suggestedAction, 500),
      retryable: typeof body.retryable === 'boolean' ? body.retryable : null,
      requestId: sanitizeErrorReportText(body.requestId, 128),
      traceId: sanitizeErrorReportText(body.traceId, 128),
      migrationVersion: sanitizeErrorReportText(body.migrationVersion, 96),
      // v2 诊断快照：网络/同步状态、事件序列、构建号与错误码；全部按同一套白名单过滤。
      commitSha: sanitizeErrorReportText(body.commitSha, 96),
      errorCode: sanitizeErrorReportText(body.errorCode, 96),
      userMessage: sanitizeErrorReportText(body.userMessage, 300),
      errorEventId: sanitizeErrorReportText(body.errorEventId, 96),
      occurredAt: num(body.occurredAt),
      networkState: sanitizeErrorReportRecord(body.networkState),
      syncState: sanitizeErrorReportRecord(body.syncState),
      breadcrumbs: sanitizeErrorReportBreadcrumbs(body.breadcrumbs),
      appVersion: sanitizeErrorReportText(body.appVersion, 32) || 'unknown',
      clientTs: num(body.clientTs),
      schoolName: sanitizeErrorReportText(body.schoolName, 80),
      province: sanitizeErrorReportText(body.province, 40),
      host: sanitizeErrorReportText(body.host, 128),
      userAgent:
        sanitizeErrorReportText(body.userAgent, 512) || sanitizeErrorReportText(req.headers['user-agent'], 512),
      tz: sanitizeErrorReportText(body.tz, 64),
      lang: sanitizeErrorReportText(body.lang, 32),
    });
    if (!sanitized) {
      res.status(400).json({ ok: false, error: 'invalid error report payload' });
      return;
    }
    const payload = {
      ...sanitized,
      // The author service receives only the bounded, sanitized software summary.
    };

    const token = await getIngestToken('v2', instanceId);
    if (!token) {
      res.json({ ok: true, skipped: true, reason: 'no_credential' });
      return;
    }

    const targets = [
      ERROR_REPORT_URL,
      ...(config.backupBaseUrl ? [`${config.backupBaseUrl.replace(/\/+$/, '')}/api/error-report`] : []),
    ];
    const relayStartedAt = Date.now();
    let lastError: { status?: number; detail?: string } = {};
    for (const url of targets) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        const upstream = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (upstream.ok) {
          res.json({ ok: true, relayMs: Date.now() - relayStartedAt });
          return;
        }
        lastError = { status: upstream.status, detail: (await upstream.text().catch(() => '')).slice(0, 200) };
      } catch (error) {
        lastError = { detail: error instanceof Error ? error.message : 'forward_failed' };
      }
    }
    res.status(502).json({ ok: false, error: 'forward_failed', ...lastError });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'error_report_failed' });
  }
}
