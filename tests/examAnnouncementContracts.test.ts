import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANNOUNCEMENT_EXPIRY_OPTIONS,
  ANNOUNCEMENT_IMAGE_MAX_BYTES,
  ANNOUNCEMENT_SEEN_MAX_MS,
  ANNOUNCEMENT_SEEN_MIN_MS,
  ANNOUNCEMENT_SCOPE_LABELS,
  ANNOUNCEMENT_STATUS_LABELS,
  ANNOUNCEMENT_STYLES,
  ANNOUNCEMENT_STYLE_LABELS,
  isAnnouncementImageType,
  mergeSeenItems,
  normalizeSeenItems,
  parseAnnouncementRemindScope,
  parseAnnouncementLevelFilter,
  parseAnnouncementScopeFilter,
  parseAnnouncementStatusFilter,
  parseAnnouncementStyle,
  pickRemindableAnnouncements,
  resolveAnnouncementStatus,
  shouldAutoOpenAnnouncement,
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

// 学校公告的三种大屏样式：旧数据 / 未知值必须回落成默认卡片，不能整页报错。
test('style parsing keeps known values and falls back to the default card', () => {
  assert.equal(parseAnnouncementStyle('card'), 'card');
  assert.equal(parseAnnouncementStyle('poster'), 'poster');
  assert.equal(parseAnnouncementStyle('bulletin'), 'bulletin');
  assert.equal(parseAnnouncementStyle('  '), 'card');
  assert.equal(parseAnnouncementStyle('poster-2'), 'card');
  assert.equal(parseAnnouncementStyle(undefined), 'card');
  assert.equal(parseAnnouncementStyle(null, 'poster'), 'poster');
});

test('style catalogue drives the editor picker and its labels', () => {
  assert.deepEqual(
    ANNOUNCEMENT_STYLES.map((item) => item.value),
    ['card', 'poster', 'bulletin'],
  );
  assert.deepEqual(Object.keys(ANNOUNCEMENT_STYLE_LABELS).sort(), ['bulletin', 'card', 'poster']);
  for (const item of ANNOUNCEMENT_STYLES) {
    assert.equal(ANNOUNCEMENT_STYLE_LABELS[item.value], item.label);
    assert.ok(item.description.length > 0, 'each style needs a description for the picker');
  }
});

test('image constraints match what the server accepts', () => {
  for (const mimeType of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
    assert.equal(isAnnouncementImageType(mimeType), true);
  }
  for (const mimeType of ['image/svg+xml', 'text/html', 'application/pdf', '']) {
    assert.equal(isAnnouncementImageType(mimeType), false);
  }
  assert.equal(ANNOUNCEMENT_IMAGE_MAX_BYTES, 2 * 1024 * 1024);
});

// 回执口径（2026-09-25 定稿）：设备把公告展示满 3 秒才算已读，时长累计上报。
test('seen threshold and per-report cap are the agreed values', () => {
  assert.equal(ANNOUNCEMENT_SEEN_MIN_MS, 3000);
  assert.equal(ANNOUNCEMENT_SEEN_MAX_MS, 60 * 60 * 1000);
});

test('normalizeSeenItems drops junk, clamps duration and keeps the larger duplicate', () => {
  const cleaned = normalizeSeenItems([
    { id: 'ann_a', seenMs: 3000 },
    { id: 'ann_a', seenMs: 8000 },
    { id: '', seenMs: 5000 },
    { id: 'ann_b', seenMs: -20 },
    { id: 'ann_c', seenMs: ANNOUNCEMENT_SEEN_MAX_MS * 10 },
    'nope',
    null,
  ]);
  assert.deepEqual(Object.fromEntries(cleaned.map((item) => [item.id, item.seenMs])), {
    ann_a: 8000,
    ann_b: 0,
    ann_c: ANNOUNCEMENT_SEEN_MAX_MS,
  });
  assert.deepEqual(normalizeSeenItems('not-an-array'), []);
  assert.deepEqual(normalizeSeenItems([{ id: 'ann_a', seenMs: 1000 }], 0), [{ id: 'ann_a', seenMs: 1000 }]);
});

test('mergeSeenItems accumulates pending durations for offline replay', () => {
  const pending = mergeSeenItems({ ann_a: 3000 }, [
    { id: 'ann_a', seenMs: 2000 },
    { id: 'ann_b', seenMs: 4000 },
  ]);
  assert.deepEqual(pending, { ann_a: 5000, ann_b: 4000 });
  // 累计时长有上限，设备时钟异常也不会把统计撑坏。
  const capped = mergeSeenItems({ ann_a: ANNOUNCEMENT_SEEN_MAX_MS }, [{ id: 'ann_a', seenMs: 5000 }]);
  assert.equal(capped.ann_a, ANNOUNCEMENT_SEEN_MAX_MS);
});

// 自动弹出（2026-09-26 口径）：只有"发布时选了只进列表"不弹，时间与考试状态都不再拦。
// 这条是回归：曾经按 22:00–06:00 夜间静默挡普通公告，管理端就会显示"已送达未看"。
test('shouldAutoOpenAnnouncement: only an explicit silent publish suppresses the popup', () => {
  const night = new Date(2026, 8, 25, 23, 0, 0);
  const beforeDawn = new Date(2026, 8, 26, 3, 0, 0);
  const day = new Date(2026, 8, 25, 10, 0, 0);
  for (const at of [day, night, beforeDawn]) {
    assert.equal(shouldAutoOpenAnnouncement({ level: 'normal' }, at), true);
    assert.equal(shouldAutoOpenAnnouncement({ level: 'urgent' }, at), true);
    assert.equal(shouldAutoOpenAnnouncement({ level: 'normal', silent: true }, at), false);
    assert.equal(shouldAutoOpenAnnouncement({ level: 'urgent', silent: true }, at), false);
  }
});

test('remind scope defaults to unseen and reminders only fire when newer', () => {
  assert.equal(parseAnnouncementRemindScope('all'), 'all');
  assert.equal(parseAnnouncementRemindScope('unseen'), 'unseen');
  assert.equal(parseAnnouncementRemindScope('weird'), 'unseen');
  assert.equal(parseAnnouncementRemindScope(undefined), 'unseen');

  const list = [
    { id: 'ann_new', remindAt: 200 },
    { id: 'ann_old', remindAt: 100 },
    { id: 'ann_none', remindAt: null },
  ];
  const pending = pickRemindableAnnouncements(list, { ann_old: 100, ann_none: 50 });
  assert.deepEqual(
    pending.map((item) => item.id),
    ['ann_new'],
  );
  assert.deepEqual(pickRemindableAnnouncements(list, { ann_new: 200, ann_old: 100 }), []);
});
