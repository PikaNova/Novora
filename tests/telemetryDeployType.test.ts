import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDeployType } from '../api/telemetry.js';

/**
 * 部署形态是运维分类维度：只允许与作者端约定的枚举，
 * 非法值必须落 unknown，不能把 k8s / 自定义字符串带进聚合口径。
 */

test('normalizeDeployType accepts the agreed enum and normalizes case/whitespace', () => {
  assert.equal(normalizeDeployType('nas'), 'nas');
  assert.equal(normalizeDeployType('  Docker '), 'docker');
  assert.equal(normalizeDeployType('PM2'), 'pm2');
  assert.equal(normalizeDeployType('vercel'), 'vercel');
  assert.equal(normalizeDeployType('unknown'), 'unknown');
});

test('normalizeDeployType maps illegal or missing values to unknown without leaking them', () => {
  assert.equal(normalizeDeployType('k8s'), 'unknown');
  assert.equal(normalizeDeployType('x'.repeat(64)), 'unknown');
  assert.equal(normalizeDeployType(42), 'unknown');
  assert.equal(normalizeDeployType(undefined), 'unknown');
});

test('normalizeDeployType falls back to NOVORA_DEPLOY_TYPE when the body has no value', () => {
  const original = process.env.NOVORA_DEPLOY_TYPE;
  process.env.NOVORA_DEPLOY_TYPE = 'nas';
  try {
    assert.equal(normalizeDeployType(undefined), 'nas');
    // 请求体显式给出时仍以请求体为准
    assert.equal(normalizeDeployType('docker'), 'docker');
    // 非法请求体落 unknown，不会拿环境变量去猜客户端的意图
    assert.equal(normalizeDeployType('k8s'), 'unknown');
  } finally {
    if (original == null) delete process.env.NOVORA_DEPLOY_TYPE;
    else process.env.NOVORA_DEPLOY_TYPE = original;
  }
});
