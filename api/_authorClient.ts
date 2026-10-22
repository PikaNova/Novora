import { normalizeServiceBase, resolveTelemetryUrls, telemetryConfig } from './_telemetryConfig.js';

export interface AuthorRemoteConfig {
  telemetryEnabled: boolean;
  errorReportEnabled: boolean;
  sampleRate: number;
  maxStackLength: number;
  latestVersion: string;
  latestRepoUrl: string;
  backupBaseUrl: string;
  /** 各服务基址覆盖位；空串表示未覆盖，回落到 REPO_* / 内置地址。 */
  updateBaseUrl: string;
  ingestBaseUrl: string;
  contentBaseUrl: string;
  authBaseUrl: string;
  disabledVersions: string[];
  updatedAt: number;
}

const DEFAULT_CONFIG: AuthorRemoteConfig = {
  telemetryEnabled: true,
  errorReportEnabled: true,
  sampleRate: 1,
  maxStackLength: 8000,
  latestVersion: '',
  latestRepoUrl: '',
  backupBaseUrl: '',
  updateBaseUrl: '',
  ingestBaseUrl: '',
  contentBaseUrl: '',
  authBaseUrl: '',
  disabledVersions: [],
  updatedAt: 0,
};

/** 只接受干净的 https origin；作者端已过滤，这里再防一次被篡改的响应。 */
function serviceUrls(config: AuthorRemoteConfig): Parameters<typeof resolveTelemetryUrls>[0] {
  return {
    updateBaseUrl: normalizeServiceBase(config.updateBaseUrl),
    ingestBaseUrl: normalizeServiceBase(config.ingestBaseUrl),
    contentBaseUrl: normalizeServiceBase(config.contentBaseUrl),
  };
}

let configCache: { value: AuthorRemoteConfig; at: number } | null = null;
const CONFIG_TTL_MS = 15 * 60 * 1000;

export async function getAuthorConfig(): Promise<AuthorRemoteConfig> {
  if (configCache && Date.now() - configCache.at < CONFIG_TTL_MS) return configCache.value;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    const response = await fetch(`${telemetryConfig.announceUrl}?resource=config`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`status ${response.status}`);
    const data = await response.json();
    const incoming = (data?.config || {}) as Partial<AuthorRemoteConfig>;
    const config: AuthorRemoteConfig = {
      ...DEFAULT_CONFIG,
      ...incoming,
      updateBaseUrl: normalizeServiceBase(incoming.updateBaseUrl),
      ingestBaseUrl: normalizeServiceBase(incoming.ingestBaseUrl),
      contentBaseUrl: normalizeServiceBase(incoming.contentBaseUrl),
      authBaseUrl: normalizeServiceBase(incoming.authBaseUrl),
    };
    configCache = { value: config, at: Date.now() };
    return config;
  } catch {
    if (configCache) return configCache.value;
    return DEFAULT_CONFIG;
  }
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();
const TOKEN_SAFETY_MARGIN_MS = 2 * 60 * 1000;

export async function getIngestToken(channel: 'v1' | 'v2', instanceId: string): Promise<string | null> {
  const key = `${channel}:${instanceId}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt - Date.now() > TOKEN_SAFETY_MARGIN_MS) return cached.token;
  try {
    const config = await getAuthorConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    const response = await fetch(resolveTelemetryUrls(serviceUrls(config)).tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId, channel }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.ok || typeof data.token !== 'string') return null;
    const expiresAt = Number(data.expiresAt) || Date.now() + 10 * 60 * 1000;
    tokenCache.set(key, { token: data.token, expiresAt });
    return data.token;
  } catch {
    return null;
  }
}

export function shouldSample(rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}
