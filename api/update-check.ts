import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * 检查更新：读取 GitHub 最新发布版本，与客户端当前版本比较。
 * - 仓库默认 jinzhiyuan0327/exam-board，可用环境变量 GITHUB_REPO 覆盖（形如 owner/repo）。
 * - 可选 GITHUB_TOKEN 提升速率限制（私有仓库必填）。
 * - 结果在服务端内存缓存 5 分钟，降低 GitHub API 调用。
 */

const DEFAULT_REPO = 'jinzhiyuan0327/exam-board';
const CACHE_TTL = 5 * 60 * 1000;

interface LatestInfo {
  latest: string | null;
  releaseUrl: string | null;
  notes: string | null;
  publishedAt: string | null;
  source: 'release' | 'tag' | 'none';
}

let cache: { at: number; repo: string; data: LatestInfo } | null = null;

function parseSemver(v: string): [number, number, number] {
  const core = String(v).trim().replace(/^v/i, '').split('-')[0].split('+')[0];
  const parts = core.split('.').map(n => parseInt(n, 10));
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
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'exam-board-update-check',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function fetchLatest(repo: string): Promise<LatestInfo> {
  // 1) 优先 releases/latest
  const relRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: ghHeaders() });
  if (relRes.ok) {
    const r: any = await relRes.json();
    const tag = typeof r?.tag_name === 'string' ? r.tag_name : null;
    if (tag) {
      return {
        latest: tag.replace(/^v/i, ''),
        releaseUrl: typeof r?.html_url === 'string' ? r.html_url : `https://github.com/${repo}/releases`,
        notes: typeof r?.body === 'string' && r.body.trim() ? r.body.trim().slice(0, 4000) : null,
        publishedAt: typeof r?.published_at === 'string' ? r.published_at : null,
        source: 'release',
      };
    }
  }
  // 2) 回退 tags（尚未发布 release 时）
  const tagRes = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=100`, { headers: ghHeaders() });
  if (tagRes.ok) {
    const tags: any = await tagRes.json();
    if (Array.isArray(tags) && tags.length > 0) {
      const names = tags.map((t: any) => String(t?.name || '')).filter(Boolean);
      names.sort((a, b) => cmpSemver(b, a)); // 降序，取最大
      const top = names[0];
      if (top) {
        return {
          latest: top.replace(/^v/i, ''),
          releaseUrl: `https://github.com/${repo}/releases`,
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
  return { latest: null, releaseUrl: `https://github.com/${repo}/releases`, notes: null, publishedAt: null, source: 'none' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }

  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
  const currentRaw = Array.isArray(req.query.current) ? req.query.current[0] : req.query.current;
  const current = typeof currentRaw === 'string' && currentRaw ? currentRaw.replace(/^v/i, '') : '0.0.0';

  try {
    let data: LatestInfo;
    if (cache && cache.repo === repo && Date.now() - cache.at < CACHE_TTL) {
      data = cache.data;
    } else {
      data = await fetchLatest(repo);
      cache = { at: Date.now(), repo, data };
    }

    const hasUpdate = !!data.latest && cmpSemver(current, data.latest) < 0;
    res.status(200).json({
      ok: true,
      repo,
      current,
      latest: data.latest,
      hasUpdate,
      releaseUrl: data.releaseUrl,
      notes: data.notes,
      publishedAt: data.publishedAt,
      source: data.source,
    });
  } catch (error: unknown) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : '检查更新失败' });
  }
}
