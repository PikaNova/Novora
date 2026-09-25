import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExamItem } from '../src/types/index.js';
import {
  classroomSnapshotOf,
  reconcileClassroomNotices,
  stickyClassroomNotice,
  type ClassroomExamSnapshot,
} from '../src/utils/classroomNotices.js';

/**
 * 教室端「后台动作提示」的回归：暂停/继续/延长/改时间/申请停止/结束/归档/删除
 * 都要能在教室里变成一条明确的提示，而不是只让倒计时冻结或整场消失。
 */

const DAY = '2026-09-25';
const at = (time: string) => new Date(`${DAY}T${time}:00+08:00`).getTime();

function item(partial: Partial<ExamItem> & { id: string; startTime: string; endTime: string }): ExamItem {
  return {
    name: '语文',
    enabled: true,
    order: 0,
    ...partial,
  } as ExamItem;
}

function major(overrides: Record<string, unknown> = {}) {
  return { id: 'major_1', name: '第一次月考', ...overrides };
}

function snapshot(overrides: Partial<ClassroomExamSnapshot> = {}): ClassroomExamSnapshot {
  return {
    examId: 'major_1',
    name: '第一次月考',
    source: 'formal',
    startAt: at('09:00'),
    endAt: at('10:00'),
    pausedAt: null,
    stopRequestedAt: null,
    endedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

test('快照：取当前进行中的那场，并合并记录层的暂停/申请停止/结束字段', () => {
  const items = [
    item({
      id: 'i1',
      startTime: `${DAY}T09:00:00`,
      endTime: `${DAY}T10:00:00`,
      majorExamId: 'major_1',
      majorName: '第一次月考',
    }),
  ];
  const now = at('09:30');
  const plain = classroomSnapshotOf({ items, majors: [major()], now });
  assert.equal(plain?.examId, 'major_1');
  assert.equal(plain?.pausedAt, null);

  const paused = classroomSnapshotOf({ items, majors: [major({ pausedAt: at('09:20') })], now });
  assert.equal(paused?.pausedAt, at('09:20'));

  const stopping = classroomSnapshotOf({ items, majors: [major({ stopRequestedAt: at('09:25') })], now });
  assert.equal(stopping?.stopRequestedAt, at('09:25'));
});

test('快照：暂停时"现在"钉在暂停那一刻，所以暂停中的考试仍算当前考试', () => {
  const items = [
    item({
      id: 'i1',
      startTime: `${DAY}T09:00:00`,
      endTime: `${DAY}T10:00:00`,
      majorExamId: 'major_1',
      pausedAt: at('09:10'),
    } as Partial<ExamItem> & { id: string; startTime: string; endTime: string }),
  ];
  // 真实时间已经过结束点，但暂停把它钉住了。
  const snapshotValue = classroomSnapshotOf({ items, majors: [major({ pausedAt: at('09:10') })], now: at('11:00') });
  assert.equal(snapshotValue?.examId, 'major_1');
});

test('常驻提示：暂停中 / 已申请停止各有一条横幅，其它情况没有', () => {
  assert.equal(stickyClassroomNotice(snapshot())?.kind, undefined);
  const paused = stickyClassroomNotice(snapshot({ pausedAt: at('09:20') }));
  assert.equal(paused?.kind, 'paused');
  assert.equal(paused?.sticky, true);
  assert.match(paused?.message ?? '', /倒计时已冻结/);
  const stopping = stickyClassroomNotice(snapshot({ stopRequestedAt: at('09:25') }));
  assert.equal(stopping?.kind, 'stop-requested');
  assert.match(stopping?.message ?? '', /系统会在到点/);
});

test('变化提示：暂停 → 继续（带暂停时长）', () => {
  const paused = snapshot({ pausedAt: at('09:20') });
  const notices = reconcileClassroomNotices(snapshot(), paused);
  assert.deepEqual(
    notices.map((notice) => notice.kind),
    ['paused'],
  );
  const resumed = reconcileClassroomNotices(paused, snapshot());
  assert.deepEqual(
    resumed.map((notice) => notice.kind),
    ['resumed'],
  );
  assert.match(resumed[0].message, /继续/);
});

test('变化提示：延长与缩短都会说明新的结束时间', () => {
  const extended = reconcileClassroomNotices(snapshot(), snapshot({ endAt: at('10:10') }));
  assert.deepEqual(
    extended.map((notice) => notice.kind),
    ['extended'],
  );
  assert.match(extended[0].message, /延长/);
  const shortened = reconcileClassroomNotices(snapshot(), snapshot({ endAt: at('09:45') }));
  assert.deepEqual(
    shortened.map((notice) => notice.kind),
    ['shortened'],
  );
  assert.match(shortened[0].message, /结束时间改为 09:45/);
});

test('变化提示：申请停止是一条提示（等待系统判定）', () => {
  const notices = reconcileClassroomNotices(snapshot(), snapshot({ stopRequestedAt: at('09:25') }));
  assert.deepEqual(
    notices.map((notice) => notice.kind),
    ['stop-requested'],
  );
  assert.match(notices[0].message, /停止申请/);
  assert.equal(notices[0].sticky, true);
});

test('变化提示：后台提前结束 / 归档 / 删除都能区分', () => {
  const ended = reconcileClassroomNotices(snapshot(), null, { majors: [major({ endedAt: at('09:40') })] });
  assert.deepEqual(
    ended.map((notice) => notice.kind),
    ['ended'],
  );
  assert.match(ended[0].message, /后台已结束/);

  const archived = reconcileClassroomNotices(snapshot(), null, { majors: [major({ archivedAt: at('09:41') })] });
  assert.deepEqual(
    archived.map((notice) => notice.kind),
    ['archived'],
  );

  const removed = reconcileClassroomNotices(snapshot(), null, { majors: [] });
  assert.deepEqual(
    removed.map((notice) => notice.kind),
    ['removed'],
  );
  assert.match(removed[0].message, /已删除/);
});

test('变化提示：本机临时考试结束走自己那条', () => {
  const temporary = snapshot({ examId: 'temp_1', name: '数学 - 临时考试', source: 'temporary' });
  const notices = reconcileClassroomNotices(temporary, null, {
    temporaryExam: { id: 'temp_1', subject: '数学', status: 'ended' },
  });
  assert.deepEqual(
    notices.map((notice) => notice.kind),
    ['ended'],
  );
  assert.match(notices[0].title, /临时考试/);
});

test('变化提示：没有上一轮状态时不打扰（首屏不弹）', () => {
  assert.deepEqual(reconcileClassroomNotices(null, snapshot()), []);
  assert.deepEqual(reconcileClassroomNotices(snapshot(), snapshot()), []);
});
