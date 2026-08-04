import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { getAuthorConfig, getIngestToken, shouldSample } from './_authorClient.js';
import { resolveIpSalt, telemetryConfig } from './_telemetryConfig.js';

const COLLECT_URL = telemetryConfig.collectUrl;

function str(value: unknown, max = 512): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function num(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function clientIp(req: VercelRequest): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || '';
  return (raw.split(',')[0] || '').trim();
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
    const event = str(body.event, 32);
    if (!instanceId || !event) {
      res.status(400).json({ ok: false, error: 'missing instanceId/event' });
      return;
    }

    const appVersion = str(body.appVersion, 32);
    const config = await getAuthorConfig();
    if (!config.telemetryEnabled) {
      res.json({ ok: true, skipped: true, reason: 'disabled' });
      return;
    }
    if (appVersion && config.disabledVersions.includes(appVersion)) {
      res.json({ ok: true, skipped: true, reason: 'version_disabled' });
      return;
    }
    if (!shouldSample(config.sampleRate)) {
      res.json({ ok: true, skipped: true, reason: 'sampled_out' });
      return;
    }

    const token = await getIngestToken('v2', instanceId);
    if (!token) {
      res.json({ ok: true, skipped: true, reason: 'no_credential' });
      return;
    }

    let ipHash: string | null = null;
    const ip = clientIp(req);
    if (ip) {
      try {
        const salt = await resolveIpSalt();
        ipHash = createHash('sha256').update(`${salt}|${ip}`).digest('hex').slice(0, 32);
      } catch {
        res.json({ ok: true, skipped: true, reason: 'privacy_config_unavailable' });
        return;
      }
    }
    const country = str(req.headers['x-vercel-ip-country'], 8);
    const payload = {
      instanceId,
      event,
      appVersion,
      commitSha: str(body.commitSha, 64),
      host: str(body.host, 128),
      vercelEnv: process.env.VERCEL_ENV || null,
      userAgent: str(body.userAgent, 512) || str(req.headers['user-agent'], 512),
      tz: str(body.tz, 64),
      lang: str(body.lang, 32),
      country,
      ipHash,
      clientTs: num(body.clientTs),
      perf: body.perf && typeof body.perf === 'object' && !Array.isArray(body.perf) ? body.perf : null,
      weekly: body.weekly && typeof body.weekly === 'object' && !Array.isArray(body.weekly) ? body.weekly : null,
      schoolName: str(body.schoolName, 80),
      province: str(body.province, 40),
    };

    const targets = [
      COLLECT_URL,
      ...(config.backupBaseUrl ? [`${config.backupBaseUrl.replace(/\/+$/, '')}/api/collect`] : []),
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
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'telemetry_failed' });
  }
}
