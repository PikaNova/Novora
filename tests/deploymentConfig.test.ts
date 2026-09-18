import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('deployment config supplies security and PWA revalidation headers', async () => {
  const config = JSON.parse(await readFile('vercel.json', 'utf8')) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const global = config.headers.find((item) => item.source === '/(.*)');
  const names = new Set(global?.headers.map((header) => header.key));
  for (const name of [
    'Content-Security-Policy',
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Referrer-Policy',
    'Permissions-Policy',
  ]) {
    assert.ok(names.has(name), `missing ${name}`);
  }
  const csp = global?.headers.find((header) => header.key === 'Content-Security-Policy')?.value ?? '';
  for (const directive of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"]) {
    assert.ok(csp.includes(directive), `missing CSP directive: ${directive}`);
  }
  for (const source of ['/service-worker.js', '/manifest.webmanifest']) {
    const rule = config.headers.find((item) => item.source === source);
    assert.equal(
      rule?.headers.find((header) => header.key === 'Cache-Control')?.value,
      'public, max-age=0, must-revalidate',
    );
  }
});

test('service worker uses the current shell cache and removes stale Novora caches', async () => {
  const worker = await readFile('public/service-worker.js', 'utf8');
  assert.match(worker, /novora-shell-v2\.8\.0/);
  assert.match(worker, /novora-runtime-v2\.8\.0/);
  assert.match(worker, /key\.startsWith\('novora-shell-'\)/);
  assert.match(worker, /key\.startsWith\('novora-runtime-'\)/);
});

// 服务端曾把缺失的哈希分包兜底成 200 的 index.html，Service Worker 又把它按脚本
// URL 写进缓存，导致该 URL 永远返回 HTML（Failed to fetch dynamically imported
// module）。缓存写入必须排除这种「类型不符」的响应。
test('service worker refuses to cache HTML served for non-document requests', async () => {
  const worker = await readFile('public/service-worker.js', 'utf8');
  assert.match(worker, /contentType\.includes\('text\/html'\)\s*&&\s*request\.mode !== 'navigate'/);
  assert.match(worker, /if \(canCache\(request, response\)\)/);
});

test('static server returns 404 for missing assets instead of an HTML fallback', async () => {
  const source = await readFile('server/static.ts', 'utf8');
  assert.match(source, /resolveStaticRequestKind\(requestPath, Boolean\(candidate\)\) === 'missing-asset'/);
  assert.match(source, /MISSING_ASSET_CACHE_CONTROL/);
});
