import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

// Vercel Hobby 用「api/ 目录直连函数」时是「一个文件 = 一个 Serverless Function」，
// 单次部署上限 12 个：2026-09-06 新增 api/diagnostic-logs.ts 后正好越线，部署直接失败。
// 下划线开头的私有模块不计入，纯类型声明的 .d.ts 也不产生函数。
test('api directory stays within the Vercel Hobby function limit', async () => {
  const entries = (await readdir('api', { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('_') && name.endsWith('.ts') && !name.endsWith('.d.ts'));
  assert.ok(
    entries.length <= 12,
    `api/ 公开函数 ${entries.length} 个，超过 Vercel Hobby 的 12 个上限：${entries.join('、')}`,
  );
});

// 合并入口后，旧 URL 靠 vercel.json rewrite 保住（老客户端、公告正文里的绝对地址都还在用）。
test('merged api entries keep their legacy urls working', async () => {
  const config = JSON.parse(await readFile('vercel.json', 'utf8')) as {
    rewrites: Array<{ source: string; destination: string }>;
  };
  const rewrites = new Map(config.rewrites.map((rule) => [rule.source, rule.destination]));
  for (const legacy of [
    '/api/health',
    '/api/status',
    '/api/email-worker',
    '/api/diagnostic-worker',
    '/api/time',
    '/api/update-check',
    '/api/redeploy',
    '/api/error-report',
    '/api/announcement-images',
  ]) {
    assert.ok(rewrites.has(legacy), `缺少 ${legacy} 的 rewrite`);
  }
  // 图片代理的目标必须不带查询串：destination 自带 query 时，源请求的 ?id= 有被替换掉的风险。
  assert.equal(rewrites.get('/api/announcement-images'), '/api/announcements');

  // 本地 / 内网部署走 server/routes.ts，同一批 URL 必须映射到同一个合并入口。
  const routes = await readFile('server/routes.ts', 'utf8');
  for (const [name, module] of [
    ['time', 'system'],
    ['update-check', 'system'],
    ['redeploy', 'system'],
    ['announcement-images', 'announcements'],
    ['error-report', 'telemetry'],
  ]) {
    assert.match(routes, new RegExp(`['"]?${name}['"]?:\\s*'${module}'`), `${name} 应映射到 ${module}`);
  }
});

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
