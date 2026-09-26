import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEmailFormat } from '../api/_auth.js';
import { presetSmtpConfig, SMTP_PRESETS } from '../src/services/emailSender.js';
import { normalizeInitBindPolicy } from '../api/_emailAuth.js';

test('validateEmailFormat: accepts common valid admin emails', () => {
  assert.equal(validateEmailFormat('admin@school.com'), true);
  assert.equal(validateEmailFormat('a.b@edu.cn'), true);
  assert.equal(validateEmailFormat('user+tag@163.com'), true);
  assert.equal(validateEmailFormat('novora@qq.com'), true);
});

test('validateEmailFormat: rejects empty, malformed and spaced inputs', () => {
  assert.equal(validateEmailFormat(''), false);
  assert.equal(validateEmailFormat('admin'), false);
  assert.equal(validateEmailFormat('admin@'), false);
  assert.equal(validateEmailFormat('@school.com'), false);
  assert.equal(validateEmailFormat('admin@school'), false);
  assert.equal(validateEmailFormat('admin@school.'), false);
  assert.equal(validateEmailFormat('a b@school.com'), false);
  assert.equal(validateEmailFormat('   '), false);
});

test('SMTP_PRESETS: qq and 163 expose expected hosts and ports', () => {
  assert.equal(SMTP_PRESETS.qq.host, 'smtp.qq.com');
  assert.equal(SMTP_PRESETS.qq.port, 465);
  assert.equal(SMTP_PRESETS.qq.secure, true);
  assert.equal(SMTP_PRESETS['163'].host, 'smtp.163.com');
  assert.equal(SMTP_PRESETS['163'].port, 465);
});

test('presetSmtpConfig: qq preset fills host/port/secure and merges overrides', () => {
  const cfg = presetSmtpConfig('qq', { from: 'novora@qq.com', user: 'novora@qq.com', pass: 'authcode' });
  assert.equal(cfg?.host, 'smtp.qq.com');
  assert.equal(cfg?.port, 465);
  assert.equal(cfg?.secure, true);
  assert.equal(cfg?.from, 'novora@qq.com');
  assert.equal(cfg?.pass, 'authcode');
  assert.equal(cfg?.fromName, 'Novora考试系统');
});

test('presetSmtpConfig: 163 preset fills expected values', () => {
  const cfg = presetSmtpConfig('163', { from: 'school@163.com' });
  assert.equal(cfg?.host, 'smtp.163.com');
  assert.equal(cfg?.port, 465);
  assert.equal(cfg?.secure, true);
});

test('presetSmtpConfig: custom requires host+from, otherwise returns null', () => {
  assert.equal(presetSmtpConfig('custom', {}), null);
  assert.equal(presetSmtpConfig('unknown', { host: 'mail.school.edu.cn' }), null);
  const cfg = presetSmtpConfig('custom', { host: 'mail.school.edu.cn', from: 'noreply@school.edu.cn', secure: false });
  assert.equal(cfg?.host, 'mail.school.edu.cn');
  assert.equal(cfg?.secure, false);
});
test('normalizeInitBindPolicy: accepts force/skip and falls back to optional', () => {
  assert.equal(normalizeInitBindPolicy('force'), 'force');
  assert.equal(normalizeInitBindPolicy('skip'), 'skip');
  assert.equal(normalizeInitBindPolicy('optional'), 'optional');
  assert.equal(normalizeInitBindPolicy(''), 'optional');
  assert.equal(normalizeInitBindPolicy(undefined), 'optional');
  assert.equal(normalizeInitBindPolicy('FORCE'), 'optional');
  assert.equal(normalizeInitBindPolicy(123), 'optional');
});
