import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeenTracker } from '../src/utils/announcementSeen.js';
import type { AnnouncementSeenItem } from '../src/shared/examAnnouncementContracts.js';

// 回执口径：大屏把公告真正展示满 3 秒才算已读。
// 这里把门槛压到 20ms，用真实计时验证"什么时候报、报多少"（尽量少占机器时间，
// 免得和同一批并行跑的其它计时型用例互相拖慢）。
const MIN_MS = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function collect() {
  const seen: AnnouncementSeenItem[] = [];
  return { seen, onSeen: (item: AnnouncementSeenItem) => seen.push(item) };
}

test('公告看过计时：跨过门槛立刻上报一次，并把停留时长带上', async () => {
  const { seen, onSeen } = collect();
  const tracker = createSeenTracker({ id: 'ann_1', minMs: MIN_MS, onSeen });
  tracker.setVisible(true);
  await sleep(MIN_MS * 3);
  assert.ok(seen.length >= 1, '跨过门槛就该上报');
  assert.equal(seen[0].id, 'ann_1');
  assert.ok(seen[0].seenMs >= MIN_MS, `expected >= ${MIN_MS}ms, got ${seen[0].seenMs}`);
  tracker.dispose();
  // 每次上报的时长都必须够门槛：不足门槛的零头会被丢弃，不允许出现"报了个几毫秒"。
  for (const item of seen) assert.ok(item.seenMs >= MIN_MS, `report below threshold: ${item.seenMs}`);
});

test('公告看过计时：不足门槛就切走/关闭都不算已读', async () => {
  const { seen, onSeen } = collect();
  const tracker = createSeenTracker({ id: 'ann_2', minMs: MIN_MS, onSeen });
  tracker.setVisible(true);
  await sleep(Math.floor(MIN_MS / 3));
  tracker.setVisible(false);
  tracker.dispose();
  assert.deepEqual(seen, []);
  assert.equal(tracker.snapshot().reported, false);
});

test('公告看过计时：长停留关闭时补报增量（累计时长不丢）', async () => {
  const { seen, onSeen } = collect();
  const tracker = createSeenTracker({ id: 'ann_3', minMs: MIN_MS, onSeen });
  tracker.setVisible(true);
  await sleep(MIN_MS * 5);
  assert.ok(seen.length >= 1, '跨过门槛先报一次');
  tracker.setVisible(false);
  assert.ok(seen.length >= 2, '关闭时把新增时长补报一次');
  for (const item of seen) assert.equal(item.id, 'ann_3');

  const totalMs = seen.reduce((sum, item) => sum + item.seenMs, 0);
  assert.ok(totalMs >= MIN_MS * 2, `total accumulated should cover the stay, got ${totalMs}`);
});

test('公告看过计时：连续两次展示会分别上报（seen_count 会累加）', async () => {
  const { seen, onSeen } = collect();
  const tracker = createSeenTracker({ id: 'ann_4', minMs: MIN_MS, onSeen });
  tracker.setVisible(true);
  await sleep(MIN_MS * 2);
  tracker.setVisible(false);
  await sleep(5);
  tracker.setVisible(true);
  await sleep(MIN_MS * 2);
  tracker.dispose();
  assert.ok(seen.length >= 2, '两次展示会话都应产生上报');
  for (const item of seen) assert.equal(item.id, 'ann_4');
});

test('公告看过计时：重复 setVisible(true) 不会重复计时或提前上报', async () => {
  const { seen, onSeen } = collect();
  const tracker = createSeenTracker({ id: 'ann_5', minMs: MIN_MS, onSeen });
  tracker.setVisible(true);
  tracker.setVisible(true);
  await sleep(Math.floor(MIN_MS / 2));
  assert.deepEqual(seen, [], '还没到门槛就不该上报');
  await sleep(MIN_MS);
  assert.ok(seen.length >= 1);
  tracker.dispose();
});
