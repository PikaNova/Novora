import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANNOUNCEMENT_EXPIRY_OPTIONS,
  ANNOUNCEMENT_SCOPE_LABELS,
  ANNOUNCEMENT_STATUS_LABELS,
  parseAnnouncementLevelFilter,
  parseAnnouncementScopeFilter,
  parseAnnouncementStatusFilter,
  resolveAnnouncementStatus,
} from '../src/shared/examAnnouncementContracts.js';

// 学校侧公告的展示状态是"数据库 status + expires_at"现算出来的：
// 数据库只有 sent / revoked，页面要区分 生效中 / 已过期 / 已撤回。

test('resolveAnnouncementStatus treats revoked first, then expiry', () => {
  const now = 1_000_000;
  assert.equal(resolveAnnouncementStatus({ status: 'revoked', expiresAt: now + 60_000 }, now), 'revoked');
  assert.equal(resolveAnnouncementStatus({ status: 'revoked', expiresAt: null }, now), 'revoked');
  assert.equal(resolveAnnouncementStatus({ status: 'sent', expiresAt: now - 1 }, now), 'expired');
  assert.equal(resolveAnnouncementStatus({ status: 'sent', expiresAt: now + 1 }, now), 'active');
  assert.equal(resolveAnnouncementStatus({ status: 'sent', expiresAt: null }, now), 'active');
  // 缺列/异常值按"不过期"处理，避免租户数据不完整时整页显示成已过期。
  assert.equal(resolveAnnouncementStatus({ expiresAt: undefined }, now), 'active');
  assert.equal(resolveAnnouncementStatus({ expiresAt: 'not-a-number' }, now), 'active');
});

test('status filter accepts known values and falls back to all', () => {
  assert.equal(parseAnnouncementStatusFilter('active'), 'active');
  assert.equal(parseAnnouncementStatusFilter('expired'), 'expired');
  assert.equal(parseAnnouncementStatusFilter('revoked'), 'revoked');
  assert.equal(parseAnnouncementStatusFilter('all'), 'all');
  // 旧客户端传 'sent'（数据库口径）时不能让整页 500，按"不限"处理。
  assert.equal(parseAnnouncementStatusFilter('sent'), 'all');
  assert.equal(parseAnnouncementStatusFilter(undefined), 'all');
});

test('level filter accepts known values and falls back to all', () => {
  assert.equal(parseAnnouncementLevelFilter('normal'), 'normal');
  assert.equal(parseAnnouncementLevelFilter('urgent'), 'urgent');
  assert.equal(parseAnnouncementLevelFilter('weird'), 'all');
  assert.equal(parseAnnouncementLevelFilter(undefined), 'all');
});

test('scope filter uses any as the "do not filter" sentinel so all stays a real scope', () => {
  assert.equal(parseAnnouncementScopeFilter(undefined), 'any');
  assert.equal(parseAnnouncementScopeFilter(''), 'any');
  assert.equal(parseAnnouncementScopeFilter('grade'), 'grade');
  assert.equal(parseAnnouncementScopeFilter('class'), 'class');
  // 'all' 是"全校公告"这个真实范围，不能被当成"不限"。
  assert.equal(parseAnnouncementScopeFilter('all'), 'all');
  assert.equal(parseAnnouncementScopeFilter('building'), 'any');
});

test('labels and expiry presets stay in sync with the contract unions', () => {
  assert.deepEqual(Object.keys(ANNOUNCEMENT_STATUS_LABELS).sort(), ['active', 'expired', 'revoked']);
  assert.deepEqual(Object.keys(ANNOUNCEMENT_SCOPE_LABELS).sort(), ['all', 'class', 'grade']);
  assert.deepEqual(
    ANNOUNCEMENT_EXPIRY_OPTIONS.map((option) => option.value),
    ['30', '120', '480', '0'],
  );
  for (const option of ANNOUNCEMENT_EXPIRY_OPTIONS) {
    assert.ok(Number.isFinite(Number(option.value)), `expiry value must be numeric: ${option.value}`);
    assert.ok(option.label.length > 0);
  }
});
