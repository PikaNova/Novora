import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './_cors.js';
import { telemetryConfig } from './_telemetryConfig.js';
import { NOVORA_SCHEMA_VERSION } from './_schemaMigration.js';

/**
 * 检查更新：优先读作者端发布清单（国内可达），GitHub 只作为兜底。
 * - 发布清单：`GET ${TELEMETRY_BASE_URL}/api/releases/latest.json?channel=stable`
 *   返回版本号以及 image / digest / minSchema —— 部署端据此决定拉哪个镜像、校验哪个摘要、
 *   以及当前 schema 是否达标；GitHub 答不了这三个问题，且国内学校网络通常直连不通。
 * - 更新仓库默认 https://github.com/PikaNova/Novora，可用环境变量 GITHUB_REPO 覆盖。
 * - 可选 GITHUB_TOKEN 提升速率限制（私有仓库必填）。
 * - 结果在服务端内存缓存 5 分钟，降低 GitHub API 调用。
 */

const DEFAULT_REPOSITORY_URL = 'https://github.com/PikaNova/Novora';
const DOCS_UPDATE_URL = 'https://docs.pikachu2026.space/guide/12-maintenance';
const AUTHOR_MANIFEST_PATH = '/api/releases/latest.json';
const CACHE_TTL = 5 * 60 * 1000;

/** 发布渠道：默认 stable，可由 NOVORA_RELEASE_CHANNEL=beta 切到内测渠道。 */
const RELEASE_CHANNEL = process.env.NOVORA_RELEASE_CHANNEL === 'beta' ? 'beta' : 'stable';

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface LatestInfo {
  latest: string | null;
  releaseUrl: string | null;
  notes: string | null;
  publishedAt: string | null;
  source: 'release' | 'tag' | 'none';
}

let cache: { at: number; repo: string; data: LatestInfo } | null = null;

function normalizeRepository(value: string): string {
  const input = value
    .trim()
    .replace(/\/$/, '')
    .replace(/\.git$/i, '');
  let repo = input;

  try {
    const url = new URL(input);
    if (url.hostname.toLowerCase() !== 'github.com') throw new Error('仅支持 GitHub 仓库地址');
    repo = url.pathname.replace(/^\/+|\/+$/g, '');
  } catch (error) {
    if (/^https?:\/\//i.test(input)) throw error;
  }

  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error('GITHUB_REPO 必须是 GitHub 仓库地址或 owner/repo');
  }
  return repo;
}

function parseSemver(v: string): [number, number, number] {
  const core = String(v).trim().replace(/^v/i, '').split('-')[0].split('+')[0];
  const parts = core.split('.').map((n) => parseInt(n, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** 返回 -1 (a<b) / 0 / 1 (a>b) */
function cmpSemver(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'exam-board-update-check',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function fetchLatest(repo: string): Promise<LatestInfo> {
  // 1) 优先 releases/latest
  const relRes = await fetchWithTimeout(
    `https://api.github.com/repos/${repo}/releases/latest`,
    { headers: ghHeaders() },
    8000,
  );
  if (relRes.ok) {
    const r = (await relRes.json()) as { tag_name?: unknown; body?: unknown; published_at?: unknown };
    const tag = typeof r?.tag_name === 'string' ? r.tag_name : null;
    if (tag) {
      return {
        latest: tag.replace(/^v/i, ''),
        releaseUrl: DOCS_UPDATE_URL,
        notes: typeof r?.body === 'string' && r.body.trim() ? r.body.trim().slice(0, 4000) : null,
        publishedAt: typeof r?.published_at === 'string' ? r.published_at : null,
        source: 'release',
      };
    }
  }
  // 2) 回退 tags（尚未发布 release 时）
  const tagRes = await fetchWithTimeout(
    `https://api.github.com/repos/${repo}/tags?per_page=100`,
    { headers: ghHeaders() },
    8000,
  );
  if (tagRes.ok) {
    const tags = (await tagRes.json()) as Array<{ name?: unknown }>;
    if (Array.isArray(tags) && tags.length > 0) {
      const names = tags.map((t) => String(t?.name || '')).filter(Boolean);
      names.sort((a, b) => cmpSemver(b, a)); // 降序，取最大
      const top = names[0];
      if (top) {
        return {
          latest: top.replace(/^v/i, ''),
          releaseUrl: DOCS_UPDATE_URL,
          notes: null,
          publishedAt: null,
          source: 'tag',
        };
      }
    }
  }
  // 3) 无 release 也无 tag
  if (!relRes.ok && relRes.status !== 404) {
    throw new Error(`GitHub API ${relRes.status}`);
  }
  return { latest: null, releaseUrl: DOCS_UPDATE_URL, notes: null, publishedAt: null, source: 'none' };
}

/**
 * 作者端发布清单：版本 + 镜像 + digest + 最低 schema。
 * 拿不到（网络不可达 / 5xx / 未配置）时抛错，由调用方决定是否回退 GitHub。
 */
interface AuthorManifest {
  latest: string | null;
  origin: 'registry' | 'github';
  releaseUrl: string | null;
  notes: string | null;
  publishedAt: string | null;
  image: string | null;
  digest: string | null;
  minSchema: string | null;
  warnings: string[];
}

function optionalText(value: unknown, max = 2048): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

async function fetchAuthorManifest(): Promise<AuthorManifest> {
  const url = `${telemetryConfig.baseUrl}${AUTHOR_MANIFEST_PATH}?channel=${RELEASE_CHANNEL}`;
  const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 8000);
  if (!response.ok) throw new Error(`作者端发布清单 HTTP ${response.status}`);
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data || data.ok !== true) throw new Error('作者端发布清单响应无效');
  const version = optionalText(data.version, 64);
  return {
    latest: version ? version.replace(/^v/i, '') : null,
    origin: data.origin === 'registry' ? 'registry' : 'github',
    releaseUrl: optionalText(data.releaseUrl, 512),
    notes: optionalText(data.notes, 4000),
    publishedAt: optionalText(data.publishedAt, 64),
    image: optionalText(data.image, 256),
    digest: optionalText(data.digest, 128),
    minSchema: optionalText(data.minSchema, 16),
    warnings: Array.isArray(data.warnings)
      ? data.warnings
          .map((item) => optionalText(item, 200))
          .filter((item): item is string => item !== null)
          .slice(0, 5)
      : [],
  };
}

/** 本机 schema 是否达到清单要求；声明为纯数字才能比较，形如 13 或 13.1。 */
function schemaReadiness(minSchema: string | null): { schemaVersion: number; schemaReady: boolean | null } {
  if (!minSchema || !/^\d+(\.\d+){0,2}$/.test(minSchema)) {
    return { schemaVersion: NOVORA_SCHEMA_VERSION, schemaReady: null };
  }
  const required = Number(minSchema.split('.')[0]);
  return { schemaVersion: NOVORA_SCHEMA_VERSION, schemaReady: NOVORA_SCHEMA_VERSION >= required };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (!applyCors(req, res, { methods: ['GET'], public: true })) return;
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const repositoryUrl = process.env.GITHUB_REPO || DEFAULT_REPOSITORY_URL;
  const currentRaw = Array.isArray(req.query.current) ? req.query.current[0] : req.query.current;
  const current = typeof currentRaw === 'string' && currentRaw ? currentRaw.replace(/^v/i, '') : '0.0.0';

  // 1) 作者端发布清单优先：它同时给出镜像、digest 与最低 schema，GitHub 答不了这些。
  let authorError: string | null = null;
  try {
    const manifest = await fetchAuthorManifest();
    if (manifest.latest) {
      const { schemaVersion, schemaReady } = schemaReadiness(manifest.minSchema);
      res.status(200).json({
        ok: true,
        repo: 'author',
        origin: manifest.origin,
        current,
        channel: RELEASE_CHANNEL,
        latest: manifest.latest,
        hasUpdate: cmpSemver(current, manifest.latest) < 0,
        releaseUrl: manifest.releaseUrl || DOCS_UPDATE_URL,
        notes: manifest.notes,
        publishedAt: manifest.publishedAt,
        image: manifest.image,
        digest: manifest.digest,
        minSchema: manifest.minSchema,
        schemaVersion,
        schemaReady,
        warnings: manifest.warnings,
        source: manifest.origin === 'registry' ? 'registry' : 'author',
      });
      return;
    }
    authorError = '作者端未登记发布版本';
  } catch (error) {
    authorError = error instanceof Error ? error.message : '作者端发布清单不可用';
  }

  // 2) GitHub 兜底：只回答版本号，拿不到镜像与 digest 时前端会提示未声明摘要校验。
  try {
    const repo = normalizeRepository(repositoryUrl);
    let data: LatestInfo;
    if (cache && cache.repo === repo && Date.now() - cache.at < CACHE_TTL) {
      data = cache.data;
    } else {
      data = await fetchLatest(repo);
      cache = { at: Date.now(), repo, data };
    }
    if (!data.latest) throw new Error(authorError || '没有可用的发布版本');

    const { schemaVersion, schemaReady } = schemaReadiness(null);
    res.status(200).json({
      ok: true,
      repo,
      origin: 'github',
      current,
      channel: RELEASE_CHANNEL,
      latest: data.latest,
      hasUpdate: cmpSemver(current, data.latest) < 0,
      releaseUrl: data.releaseUrl,
      notes: data.notes,
      publishedAt: data.publishedAt,
      image: null,
      digest: null,
      minSchema: null,
      schemaVersion,
      schemaReady,
      // 兜底路径必须显式说明：没有镜像清单就没法按 digest 校验。
      warnings: [authorError ? `作者端发布清单不可用（${authorError}），已回退 GitHub` : '作者端未登记发布版本'],
      source: data.source,
    });
  } catch (error: unknown) {
    // 两条路径都拿不到版本时必须报错：返回「已是最新」会让运维以为不需要升级。
    const detail = error instanceof Error ? error.message : '检查更新失败';
    res.status(502).json({ ok: false, error: authorError ? `${detail}（${authorError}）` : detail });
  }
}
