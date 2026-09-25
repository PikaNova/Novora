import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeenTracker } from '../src/utils/announcementSeen.js';
import type { AnnouncementSeenItem } from '../src/shared/examAnnouncementContracts.js';

// 回执口径：大屏把公告真正展示满 3 秒才算已读。
// 时间由测试注入（clock），所以这些用例不依赖真实计时器，不会因为机器忙而抖。
const MIN_MS = 3000;

function collect() {
  const seen: AnnouncementSeenItem[] = [];
  return { seen, onSeen: (item: AnnouncementSeenItem) => seen.push(item) };
}

function makeTracker(id: string, onSeen: (item: AnnouncementSeenItem) => void) {
  let clock = 1_000_000;
  const tracker = createSeenTracker({ id, minMs: MIN_MS, now: () => clock, onSeen });
  return {
    tracker,
    /** 往前拨 clock（模拟屏幕一直亮着）。 */
    advance(ms: number) {
      clock += ms;
    },
  };
}

test('公告看过计时：跨过门槛上报一次，带上这段停留时长', () => {
  const { seen, onSeen } = collect();
  const { tracker, advance } = makeTracker('ann_1', onSeen);
  tracker.setVisible(true);
  advance(MIN_MS + 500);
  tracker.setVisible(false);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, 'ann_1');
  assert.equal(seen[0].seenMs, MIN_MS + 500);
  assert.equal(tracker.snapshot().reported, true);
});

test('公告看过计时：不足门槛就切走/关闭都不算已读', () => {
  const { seen, onSeen } = collect();
  const { tracker, advance } = makeTracker('ann_2', onSeen);
  tracker.setVisible(true);
  advance(MIN_MS - 1);
  tracker.setVisible(false);
  tracker.dispose();
  assert.equal(seen.length, 0);
  assert.equal(tracker.snapshot().reported, false);
});

test('公告看过计时：滚动出视野再滚回来，时长累加而不是清零', () => {
  const { seen, onSeen } = collect();
  const { tracker, advance } = makeTracker('ann_split', onSeen);
  tracker.setVisible(true);
  advance(MIN_MS - 1000);
  tracker.setVisible(false); // 滚出视野：还没到门槛，先不报
  assert.equal(seen.length, 0);
  tracker.setVisible(true);
  advance(1000);
  tracker.setVisible(false); // 两段加起来够门槛
  assert.equal(seen.length, 1);
  assert.equal(seen[0].seenMs, MIN_MS);
});

test('公告看过计时：长停留关闭时补报增量（累计时长不丢）', () => {
  const { seen, onSeen } = collect();
  const { tracker, advance } = makeTracker('ann_3', onSeen);
  tracker.setVisible(true);
  advance(MIN_MS);
  tracker.setVisible(false);
  assert.equal(seen.length, 1, '先报第一次');

  advance(1000);
  tracker.setVisible(true);
  advance(MIN_MS * 2);
  tracker.dispose();
  assert.equal(seen.length, 2, '关闭时把新增时长补报');
  assert.equal(seen[1].id, 'ann_3');
  assert.equal(seen[1].seenMs, MIN_MS * 2);
  assert.equal(
    seen.reduce((sum, item) => sum + item.seenMs, 0),
    MIN_MS * 3,
  );
});

test('公告看过计时：不足门槛的零头不报，避免"报了个几毫秒"', () => {
  const { seen, onSeen } = collect();
  const { tracker, advance } = makeTracker('ann_4', onSeen);
  tracker.setVisible(true);
  advance(MIN_MS);
  tracker.setVisible(false);
  advance(MIN_MS - 1);
  tracker.setVisible(true);
  advance(0);
  tracker.dispose();
  assert.equal(seen.length, 1, '第二次只有 0ms，不该多报一条');
});

test('公告看过计时：重复 setVisible(true) 不会重复计时或提前上报', () => {
  const { seen, onSeen } = collect();
  const { tracker, advance } = makeTracker('ann_5', onSeen);
  tracker.setVisible(true);
  tracker.setVisible(true);
  advance(MIN_MS - 1);
  assert.equal(seen.length, 0, '还没到门槛就不该上报');
  advance(1);
  tracker.dispose();
  assert.equal(seen.length, 1);
});

// 唯一一条用真实计时器的用例：验证"停在屏幕上不动，到点也会自己上报"。
// 阈值压到 20ms、等待 300ms，留足余量，避免机器繁忙时抖动。
test('公告看过计时：一直亮着也会在门槛到点后自动上报', async () => {
  const { seen, onSeen } = collect();
  const tracker = createSeenTracker({ id: 'ann_live', minMs: 20, onSeen });
  tracker.setVisible(true);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(seen.length >= 1, '阈值计时器到点要自动上报');
  assert.equal(seen[0].id, 'ann_live');
  assert.ok(seen[0].seenMs >= 20);
  tracker.dispose();
});
