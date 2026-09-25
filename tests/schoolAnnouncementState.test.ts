import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCHOOL_ANNOUNCEMENT_REMIND_KEY,
  SCHOOL_ANNOUNCEMENT_SHOWN_KEY,
  markAnnouncementsShown,
  markAnnouncementsSeenLocally,
  markRemindersHandled,
  pickUnshownAnnouncements,
  readLocallySeenIds,
  readReminderMarks,
  readShownAnnouncementIds,
} from '../src/utils/schoolAnnouncementState.js';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    raw: values,
  };
}

test('学校公告已弹标记：写入后能读回，未标记的不算弹过', () => {
  const store = memoryStorage();
  assert.deepEqual([...readShownAnnouncementIds(store)], []);
  markAnnouncementsShown(['ann_a', 'ann_b'], store);
  const shown = readShownAnnouncementIds(store);
  assert.deepEqual([...shown].sort(), ['ann_a', 'ann_b']);
  assert.ok(store.raw.get(SCHOOL_ANNOUNCEMENT_SHOWN_KEY));
});

test('学校公告已弹标记：挑出真正的新公告（服务端顺序保持不变）', () => {
  const store = memoryStorage();
  markAnnouncementsShown(['ann_old'], store);
  const list = [{ id: 'ann_old' }, { id: 'ann_new_urgent' }, { id: 'ann_new_normal' }];
  const fresh = pickUnshownAnnouncements(list, readShownAnnouncementIds(store));
  assert.deepEqual(
    fresh.map((item) => item.id),
    ['ann_new_urgent', 'ann_new_normal'],
  );
});

test('学校公告已弹标记：坏数据 / 无存储时退化成"都没弹过"，不抛异常', () => {
  const store = memoryStorage();
  store.setItem(SCHOOL_ANNOUNCEMENT_SHOWN_KEY, '{not json');
  assert.equal(readShownAnnouncementIds(store).size, 0);
  store.setItem(SCHOOL_ANNOUNCEMENT_SHOWN_KEY, '["array form"]');
  assert.equal(readShownAnnouncementIds(store).size, 0);
  // 存储不可用（隐私模式）时标记与读取都静默跳过。
  assert.doesNotThrow(() => markAnnouncementsShown(['ann_a'], null));
  assert.equal(readShownAnnouncementIds(null).size, 0);
});

test('学校公告已弹标记：只保留最近 500 条，避免无限增长', () => {
  const store = memoryStorage();
  markAnnouncementsShown(
    Array.from({ length: 520 }, (_, index) => `ann_${index}`),
    store,
  );
  assert.equal(readShownAnnouncementIds(store).size, 500);
});

test('未读强提醒标记：记录处理过的 remindAt，旧的提醒不会重复处理', () => {
  const store = memoryStorage();
  assert.deepEqual(readReminderMarks(store), {});
  markRemindersHandled([{ id: 'ann_a', remindAt: 1000 }], store);
  assert.deepEqual(readReminderMarks(store), { ann_a: 1000 });
  // 同一个公告又发了一次提醒（时间更新）：记录取较大值。
  markRemindersHandled([{ id: 'ann_a', remindAt: 2000 }], store);
  assert.equal(readReminderMarks(store).ann_a, 2000);
  // 迟到的旧提醒不能把记录倒退。
  markRemindersHandled([{ id: 'ann_a', remindAt: 1500 }], store);
  assert.equal(readReminderMarks(store).ann_a, 2000);
  assert.ok(store.raw.get(SCHOOL_ANNOUNCEMENT_REMIND_KEY));
});

test('本机已读标记：记录上报过已读的公告，供强提醒跳过', () => {
  const store = memoryStorage();
  assert.equal(readLocallySeenIds(store).size, 0);
  markAnnouncementsSeenLocally(['ann_a', 'ann_b'], store);
  const seen = readLocallySeenIds(store);
  assert.equal(seen.has('ann_a'), true);
  assert.equal(seen.has('ann_b'), true);
  assert.equal(seen.has('ann_c'), false);
});
