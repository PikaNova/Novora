import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthorConfig, getIngestToken, shouldSample } from './_authorClient.js';
import { telemetryConfig } from './_telemetryConfig.js';

const ERROR_REPORT_URL = telemetryConfig.errorReportUrl;
const ALLOWED_LEVELS = new Set(['error', 'warning', 'info']);

function str(value: unknown, max = 2000): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function num(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
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
    if (!shouldSample(config.errorSampleRate)) {
      res.json({ ok: true, skipped: true, reason: 'sampled_out' });
      return;
    }

    const level = str(body.level, 16);
    const context = body.context && typeof body.context === 'object' && !Array.isArray(body.context) ? body.context : null;
    const payload = {
      instanceId,
      message,
      errorName: str(body.errorName, 200),
      stack: str(body.stack, config.maxStackLength),
      fingerprint: str(body.fingerprint, 256),
      level: level && ALLOWED_LEVELS.has(level) ? level : 'error',
      route: str(body.route, 256),
      action: str(body.action, 200),
      apiEndpoint: str(body.apiEndpoint, 256),
      httpStatus: num(body.httpStatus),
      context,
      appVersion: str(body.appVersion, 32),
      clientChannel: str(body.clientChannel, 16) || 'novora-client',
      schoolName: str(body.schoolName, 80),
      province: str(body.province, 40),
      host: str(body.host, 128),
      userAgent: str(body.userAgent, 512) || str(req.headers['user-agent'], 512),
      tz: str(body.tz, 64),
      lang: str(body.lang, 32),
      clientTs: num(body.clientTs),
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
