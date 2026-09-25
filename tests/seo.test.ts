import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { SEO_FALLBACK_DESCRIPTION, buildSeoDescription } from '../src/shared/seo.js';

test('SEO fallback description stays in the recommended length range', () => {
  const length = [...SEO_FALLBACK_DESCRIPTION].length;
  assert.ok(length >= 25 && length <= 160, `expected 25-160 characters, received ${length}`);
});

test('custom SEO description wins over school and product fallbacks', () => {
  assert.equal(buildSeoDescription('一中', '自定义站点描述'), '自定义站点描述');
  assert.equal(buildSeoDescription('一中', ''), '一中考试安排与教室大屏管理平台');
});

test('static HTML exposes a crawlable H1 before React mounts', () => {
  const html = readFileSync(resolve('index.html'), 'utf8');
  const h1 = /<h1\s+class="seo-fallback"[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  assert.ok(h1, 'expected a static H1 fallback in index.html');
  assert.ok(h1[1].includes('考试管理与教室大屏'));
});
