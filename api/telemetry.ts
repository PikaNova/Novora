import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { telemetryConfig } from './_telemetryConfig.js';

// —— 遥测配置（作者端收集器）——
// 客户端部署者无需配置这些；仅需设置 DATABASE_URL 与 ADMIN_PASSWORD。
// 密钥只存在于本服务端函数中，不会随浏览器包体下发。
//
// 域名/密钥集中在 ./_telemetryConfig.ts（单一可信来源）。
// 作者变更域名后发布新版，各客户端「检查更新 → 一键重新部署」时，
// 重新部署过程会从 GitHub 拉取最新代码并自动应用新域名，无需手改 Vercel 环境变量。
const COLLECT_URL = telemetryConfig.collectUrl;
const INGEST_KEY = telemetryConfig.ingestKey;
const IP_SALT = telemetryConfig.ipSalt;

function str(v: unknown, max = 512): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}
function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function clientIp(req: VercelRequest): string {
  const xf = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xf) ? xf[0] : xf || '';
  return (raw.split(',')[0] || '').trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }
  try {
    const b = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const instanceId = str(b.instanceId, 128);
    const event = str(b.event, 32);
    if (!instanceId || !event) {
      res.status(400).json({ ok: false, error: 'missing instanceId/event' });
      return;
    }

    const ip = clientIp(req);
    const ipHash = ip ? createHash('sha256').update(IP_SALT + '|' + ip).digest('hex').slice(0, 32) : null;
    const country = str(req.headers['x-vercel-ip-country'], 8);

    const payload = {
      instanceId,
      event,
      appVersion: str(b.appVersion, 32),
      commitSha: str(b.commitSha, 64),
      host: str(b.host, 128),
      vercelEnv: process.env.VERCEL_ENV || null,
      userAgent: str(b.userAgent, 512) || str(req.headers['user-agent'], 512),
      tz: str(b.tz, 64),
      lang: str(b.lang, 32),
      country,
      ipHash,
      clientTs: num(b.clientTs),
      perf: b.perf && typeof b.perf === 'object' && !Array.isArray(b.perf) ? b.perf : null,
      weekly: b.weekly && typeof b.weekly === 'object' && !Array.isArray(b.weekly) ? b.weekly : null,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const relayStartedAt = Date.now();
    const r = await fetch(COLLECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telemetry-Key': INGEST_KEY },
      body: JSON.stringify(payload), signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      res.status(502).json({ ok: false, error: 'forward_failed', status: r.status, detail: t.slice(0, 200) });
      return;
    }
    res.json({ ok: true, relayMs: Date.now() - relayStartedAt });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
