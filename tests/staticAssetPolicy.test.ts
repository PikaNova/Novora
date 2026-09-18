import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IMMUTABLE_ASSET_CACHE_CONTROL,
  MISSING_ASSET_CACHE_CONTROL,
  SPA_FALLBACK_CACHE_CONTROL,
  cacheControlForStaticRequest,
  isAssetLikePath,
  resolveStaticRequestKind,
} from '../src/shared/staticAssetPolicy.js';

// 线上实例：旧页面请求已被新版本删除的哈希分包
// https://dev.pikachu2026.space/assets/LoginPage-0U8YhDpb.js
test('missing hashed bundles are reported as missing assets, never as SPA routes', () => {
  assert.equal(resolveStaticRequestKind('/assets/LoginPage-0U8YhDpb.js', false), 'missing-asset');
  assert.equal(resolveStaticRequestKind('/assets/index-DDwhb9kW.js', true), 'file');
  assert.equal(resolveStaticRequestKind('/fonts/noto.woff2', false), 'missing-asset');
  assert.equal(resolveStaticRequestKind('/favicon.svg', false), 'missing-asset');
});

test('extension-less paths stay inside the SPA fallback', () => {
  for (const pathname of ['/', '/login', '/exam', '/settings/design', '/plugin/connect']) {
    assert.equal(resolveStaticRequestKind(pathname, false), 'spa-fallback');
    assert.equal(cacheControlForStaticRequest(pathname, false), SPA_FALLBACK_CACHE_CONTROL);
  }
});

test('static cache headers never pin a missing asset', () => {
  assert.equal(cacheControlForStaticRequest('/assets/index-DDwhb9kW.js', true), IMMUTABLE_ASSET_CACHE_CONTROL);
  assert.equal(cacheControlForStaticRequest('/fonts/noto.woff2', true), IMMUTABLE_ASSET_CACHE_CONTROL);
  assert.equal(cacheControlForStaticRequest('/assets/LoginPage-0U8YhDpb.js', false), MISSING_ASSET_CACHE_CONTROL);
  assert.equal(cacheControlForStaticRequest('/favicon.svg', false), MISSING_ASSET_CACHE_CONTROL);
  // 根目录文件（robots.txt、favicon）仍需每次回源校验，避免换图后长时间不生效。
  assert.equal(cacheControlForStaticRequest('/favicon.svg', true), SPA_FALLBACK_CACHE_CONTROL);
});

test('asset-like detection covers both build output and root files', () => {
  assert.equal(isAssetLikePath('/assets/chunk.js'), true);
  assert.equal(isAssetLikePath('/fonts/noto.woff2'), true);
  assert.equal(isAssetLikePath('/robots.txt'), true);
  assert.equal(isAssetLikePath('/login'), false);
  assert.equal(isAssetLikePath('/settings/design'), false);
  assert.equal(isAssetLikePath('/'), false);
});
