import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('deployment config supplies security and PWA revalidation headers', async () => {
  const config = JSON.parse(await readFile('vercel.json', 'utf8')) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const global = config.headers.find(item => item.source === '/(.*)');
  const names = new Set(global?.headers.map(header => header.key));
  for (const name of ['Content-Security-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']) {
    assert.ok(names.has(name), `missing ${name}`);
  }
  const csp = global?.headers.find(header => header.key === 'Content-Security-Policy')?.value ?? '';
  for (const directive of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"]) {
    assert.ok(csp.includes(directive), `missing CSP directive: ${directive}`);
  }
  for (const source of ['/service-worker.js', '/manifest.webmanifest']) {
    const rule = config.headers.find(item => item.source === source);
    assert.equal(rule?.headers.find(header => header.key === 'Cache-Control')?.value, 'public, max-age=0, must-revalidate');
  }
});

test('service worker uses the current shell cache and removes stale Novora caches', async () => {
  const worker = await readFile('public/service-worker.js', 'utf8');
  assert.match(worker, /novora-shell-v2\.7\.1/);
  assert.match(worker, /novora-runtime-v2\.7\.1/);
  assert.match(worker, /key\.startsWith\('novora-shell-'\)/);
  assert.match(worker, /key\.startsWith\('novora-runtime-'\)/);
});
