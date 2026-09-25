import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCHOOL_ANNOUNCEMENT_REMIND_KEY,
  SCHOOL_ANNOUNCEMENT_SHOWN_KEY,
  markAnnouncementsShown,
  markAnnouncementsSeenLocally,
  markRemindersHandled,
  pickAutoOpenAnnouncements,
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

/**
 * 自动弹出规则（2026-09-26 口径）：公告随时随地都要确保弹出。
 *
 * 这组用例守两条现场踩过的坑：
 * 1. 规则里**没有"当前是否有考试"这一维**——考试进行中、夜间都不该抑制自动弹出
 *    （曾经的"考试中先压后弹"让管理端回执一直停在「已送达未看」）；
 * 2. **紧急公告不认"弹过一次"**：大屏重启 / 整页刷新 / 被浏览器更新顶掉后要自己弹回来，
 *    只有本机真正上报过已读才算弹够；普通公告仍只弹一次。
 */
test('自动弹出：紧急公告只认"本机已读"，普通公告弹过一次就不再弹', () => {
  const list = [
    { id: 'ann_urgent', level: 'urgent' as const, silent: false, remindAt: null, remindScope: 'unseen' as const },
    { id: 'ann_normal', level: 'normal' as const, silent: false, remindAt: null, remindScope: 'unseen' as const },
  ];
  const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

  // 全新设备：两条都要弹。
  const fresh = pickAutoOpenAnnouncements(list, { shown: new Set(), seenLocally: new Set(), reminderMarks: {} });
  assert.deepEqual(ids(fresh.autoOpen), ['ann_urgent', 'ann_normal']);
  assert.deepEqual(fresh.silent, []);

  // 两条都弹过、都没看：紧急的要再弹（页面刷新/重启后补弹），普通的按"只弹一次"收手。
  const popped = pickAutoOpenAnnouncements(list, {
    shown: new Set(['ann_urgent', 'ann_normal']),
    seenLocally: new Set(),
    reminderMarks: {},
  });
  assert.deepEqual(ids(popped.autoOpen), ['ann_urgent']);

  // 紧急公告本机看满 3 秒并上报过：不再打扰。
  const seen = pickAutoOpenAnnouncements(list, {
    shown: new Set(['ann_urgent', 'ann_normal']),
    seenLocally: new Set(['ann_urgent']),
    reminderMarks: {},
  });
  assert.deepEqual(seen.autoOpen, []);
});

test('自动弹出：静默发布只记账不弹，强提醒按 remindAt 与 scope 判定', () => {
  const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);
  const list = [
    { id: 'ann_silent', level: 'urgent' as const, silent: true, remindAt: null, remindScope: 'unseen' as const },
    { id: 'ann_remind', level: 'normal' as const, silent: false, remindAt: 2000, remindScope: 'unseen' as const },
  ];

  const result = pickAutoOpenAnnouncements(list, { shown: new Set(), seenLocally: new Set(), reminderMarks: {} });
  assert.deepEqual(ids(result.autoOpen), ['ann_remind'], '静默发布的连紧急也不弹');
  assert.deepEqual(ids(result.silent), ['ann_silent'], '静默发布要交回调用方记账');

  // 已经弹过、提醒处理进度也追上了：不再弹（隔离出强提醒这一条判定，别被"没弹过"掩盖）。
  const handled = pickAutoOpenAnnouncements(list, {
    shown: new Set(['ann_remind']),
    seenLocally: new Set(),
    reminderMarks: { ann_remind: 2000 },
  });
  assert.deepEqual(handled.autoOpen, []);

  // scope='unseen' 时，已读的教室不被打扰；scope='all' 时即使读过了也再弹一次。
  const unseenScope = [
    { id: 'ann_a', level: 'normal' as const, silent: false, remindAt: 5000, remindScope: 'unseen' as const },
  ];
  const reminded = { shown: new Set(['ann_a']), seenLocally: new Set(['ann_a']), reminderMarks: {} };
  assert.deepEqual(ids(pickAutoOpenAnnouncements(unseenScope, reminded).autoOpen), []);
  const allScope = [{ ...unseenScope[0], remindScope: 'all' as const }];
  assert.deepEqual(ids(pickAutoOpenAnnouncements(allScope, reminded).autoOpen), ['ann_a']);
});
