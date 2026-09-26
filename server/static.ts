import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createDbClient } from '../api/_dbAdapter.js';
import { buildSeoDescription, buildSeoTitle } from '../src/shared/seo.js';
import {
  MISSING_ASSET_CACHE_CONTROL,
  cacheControlForStaticRequest,
  resolveStaticRequestKind,
} from '../src/shared/staticAssetPolicy.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DIST_DIR = path.resolve(__dirname, '../../dist');

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: wss:; worker-src 'self' blob:; manifest-src 'self'; frame-src https:",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)',
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

function applySecurityHeaders(res: ServerResponse) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(key, value);
  }
}

interface SeoInfo {
  schoolName: string;
  titleSuffix: string;
  description: string;
  keywords: string;
  siteUrl: string;
}
let seoCache: { at: number; info: SeoInfo } | null = null;
let rawHtmlCache: { path: string; html: string } | null = null;
let injectedHtmlCache: { key: string; html: string } | null = null;

async function getSeoInfo(): Promise<SeoInfo | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (seoCache && Date.now() - seoCache.at < 60_000) return seoCache.info;
  try {
    const sql = createDbClient(url);
    const rows = (await sql`SELECT initialization FROM exam_data WHERE id=1 LIMIT 1`) as Array<{
      initialization: Record<string, unknown>;
    }>;
    const init = (rows[0]?.initialization ?? {}) as Record<string, unknown>;
    const seo = (init.seo ?? {}) as Record<string, unknown>;
    const info: SeoInfo = {
      schoolName: typeof init.schoolName === 'string' ? init.schoolName.trim() : '',
      titleSuffix: typeof seo.titleSuffix === 'string' ? seo.titleSuffix.trim() : '',
      description: typeof seo.description === 'string' ? seo.description.trim() : '',
      keywords: typeof seo.keywords === 'string' ? seo.keywords.trim() : '',
      siteUrl: typeof seo.siteUrl === 'string' ? seo.siteUrl.trim().replace(/\/+$/, '') : '',
    };
    seoCache = { at: Date.now(), info };
    return info;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function requestOrigin(req: IncomingMessage): string {
  const proto = req.headers['x-forwarded-proto'] ?? 'http';
  const host = req.headers.host ?? 'localhost';
  return `${proto}://${host}`;
}

function injectSeo(html: string, info: SeoInfo, origin: string): string {
  const title = buildSeoTitle(info.schoolName, info.titleSuffix) ?? 'Novora · 考试管理与教室大屏';
  const description = buildSeoDescription(info.schoolName, info.description);
  const siteUrl = info.siteUrl || origin;
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
  out = out.replace(
    /<meta name="description" content="[^"]*"/,
    `<meta name="description" content="${escapeHtml(description)}"`,
  );
  const head = info.keywords ? `\n  <meta name="keywords" content="${escapeHtml(info.keywords)}">` : '';
  const og = `\n  ${head}\n  <meta property="og:title" content="${escapeHtml(title)}">\n  <meta property="og:description" content="${escapeHtml(description)}">\n  <meta property="og:type" content="website">\n  <meta property="og:url" content="${escapeHtml(siteUrl + '/')}">\n  <link rel="canonical" href="${escapeHtml(siteUrl + '/')}">`;
  const h1 = `<h1 class="seo-fallback">${escapeHtml(title)}</h1>`;
  const withH1 = out.replace(/<h1 class="seo-fallback">[\s\S]*?<\/h1>/, h1);
  return withH1.replace('</head>', og + '\n  </head>');
}

function resolveSafePath(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  const filePath = path.resolve(DIST_DIR, '.' + decoded);
  if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + path.sep)) {
    return null;
  }
  return filePath;
}

export function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  applySecurityHeaders(res);

  if (pathname.startsWith('/api/')) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
    return;
  }

  const requestPath = pathname === '/' || pathname === '' ? '/index.html' : pathname;

  if (requestPath === '/robots.txt') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`User-agent: *\nAllow: /\nSitemap: ${requestOrigin(req)}/sitemap.xml\n`);
    return;
  }
  if (requestPath === '/sitemap.xml') {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.end(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${requestOrigin(req)}/</loc></url>\n  <url><loc>${requestOrigin(req)}/login</loc></url>\n  <url><loc>${requestOrigin(req)}/exam</loc></url>\n</urlset>\n`,
    );
    return;
  }

  const safePath = resolveSafePath(requestPath);
  const candidate = safePath && existsSync(safePath) && statSync(safePath).isFile() ? safePath : null;

  // 旧页面请求已被新版本删除的哈希分包时必须 404：把 index.html 当成 200 的 JS
  // 回退会让浏览器抛出 “Failed to fetch dynamically imported module”，并把这份
  // HTML 按 immutable 缓存住，详见 src/shared/staticAssetPolicy.ts。
  if (resolveStaticRequestKind(requestPath, Boolean(candidate)) === 'missing-asset') {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', MISSING_ASSET_CACHE_CONTROL);
    res.end('Not Found');
    return;
  }

  if (requestPath === '/service-worker.js' || requestPath === '/manifest.webmanifest') {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  } else {
    res.setHeader('Cache-Control', cacheControlForStaticRequest(requestPath, Boolean(candidate)));
  }

  const filePath = candidate ?? path.join(DIST_DIR, 'index.html');
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  if (req.method === 'HEAD') {
    res.statusCode = 200;
    res.end();
    return;
  }
  if (ext === '.html') {
    if (!rawHtmlCache || rawHtmlCache.path !== filePath) {
      try {
        rawHtmlCache = { path: filePath, html: readFileSync(filePath, 'utf8') };
      } catch {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
    }
    const html = rawHtmlCache.html;
    const origin = requestOrigin(req);
    void getSeoInfo()
      .then((info) => {
        const key = info
          ? `${info.schoolName}|${info.titleSuffix}|${info.description}|${info.keywords}|${info.siteUrl}|${origin}`
          : '';
        if (key && injectedHtmlCache && injectedHtmlCache.key === key) {
          res.statusCode = 200;
          res.end(injectedHtmlCache.html);
          return;
        }
        const out = info ? injectSeo(html, info, origin) : html;
        if (key) injectedHtmlCache = { key, html: out };
        res.statusCode = 200;
        res.end(out);
      })
      .catch(() => {
        res.statusCode = 200;
        res.end(html);
      });
    return;
  }
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    res.statusCode = 404;
    res.end('Not Found');
  });
  stream.pipe(res);
}
