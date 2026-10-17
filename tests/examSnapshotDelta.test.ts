import assert from 'node:assert/strict';
import test from 'node:test';
import { examSnapshotDelta, mergeExamSnapshotPartial, parseSinceRevisions } from '../src/shared/examSnapshotDelta.js';
import { EXAM_REVISION_DOMAINS } from '../src/shared/examSaveDiff.js';

const CURRENT_REVISIONS = {
  major: 5,
  alerts: 2,
  weekly: 1,
  schedule: 1,
  grades: 1,
  classes: 1,
  initialization: 1,
};

/** 一份"看起来像真快照"的载荷：只有 major / alerts 两个域的内容是大的。 */
function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    items: [{ id: 'i1', name: '数学' }],
    title: '测试',
    majors: [{ id: 'm1', name: '大型考试' }],
    activeMajorId: 'm1',
    alerts: { enabled: true, updatedAt: 111 },
    weeklyPlans: [],
    scheduleMode: 'major-only',
    activeWeeklyPlanId: '',
    activeWeeklyPlanIdByClassId: { c1: null },
    weeklyConflictPolicy: { mode: 'auto' },
    grades: [{ id: 'g1', name: '高一' }],
    classes: [{ id: 'c1', name: '高一1班' }],
    initialization: { completedAt: 1 },
    designPolicy: { mode: 'standard' },
    majorBatchPresets: { subjectGroups: [] },
    metadata: {},
    lifecycle: { quiet: false },
    binding: null,
    revisions: { ...CURRENT_REVISIONS },
    updatedAt: 1_790_000_000_000,
    ...overrides,
  };
}

function sinceAll(overrides: Record<string, number> = {}): Record<string, number> {
  return { ...CURRENT_REVISIONS, ...overrides };
}

test('parseSinceRevisions: 只接受"每个域都带合法数字"的表', () => {
  assert.deepEqual(parseSinceRevisions(JSON.stringify(sinceAll())), sinceAll());
  // 缺域 = 缓存不可全信 → 整份下发
  const missing = { ...sinceAll() } as Record<string, number>;
  delete missing.classes;
  assert.equal(parseSinceRevisions(JSON.stringify(missing)), null);
  assert.equal(parseSinceRevisions(JSON.stringify({ ...sinceAll(), major: '5' })), null);
  assert.equal(parseSinceRevisions(JSON.stringify({ ...sinceAll(), major: -1 })), null);
  assert.equal(parseSinceRevisions('not json'), null);
  assert.equal(parseSinceRevisions(undefined), null);
  assert.equal(parseSinceRevisions(''), null);
});

test('examSnapshotDelta: 全部域一致时不下发任何域的字段', () => {
  const delta = examSnapshotDelta(payload(), sinceAll());
  assert.deepEqual(delta.changedDomains, []);
  // 非域字段（设计规则/预设/元数据/生命周期）每次都要刷新：它们不推进任何域的修订号。
  assert.deepEqual(Object.keys(delta.fields).sort(), ['designPolicy', 'lifecycle', 'majorBatchPresets', 'metadata']);
  assert.equal(delta.fields.binding, undefined, '设备绑定不能走增量下发（会把缓存里的绑定冲掉）');
  assert.equal(delta.fields.items, undefined);
  assert.deepEqual(delta.revisions, CURRENT_REVISIONS);
  assert.equal(delta.updatedAt, 1_790_000_000_000);
});

test('examSnapshotDelta: 只回真的变了的域（改提醒设置不该重传班级与科目）', () => {
  const delta = examSnapshotDelta(payload(), sinceAll({ alerts: 1 }));
  assert.deepEqual(delta.changedDomains, ['alerts']);
  assert.deepEqual(delta.fields.alerts, { enabled: true, updatedAt: 111 });
  assert.equal(delta.fields.classes, undefined, '班级没变就不该再下发');
  assert.equal(delta.fields.items, undefined);
  assert.equal(delta.fields.majors, undefined);
});

test('examSnapshotDelta: 改科目会带上整个 major 域的字段（majors/items/title/activeMajorId）', () => {
  const delta = examSnapshotDelta(payload(), sinceAll({ major: 4 }));
  assert.deepEqual(delta.changedDomains, ['major']);
  for (const field of ['majors', 'items', 'title', 'activeMajorId']) {
    assert.ok(Object.prototype.hasOwnProperty.call(delta.fields, field), `${field} 要一起下发`);
  }
  assert.equal(delta.fields.classes, undefined);
});

test('examSnapshotDelta: 客户端没带的域一律照发，不冒"以为它没变"的风险', () => {
  const partialSince = { alerts: 2 } as Record<string, number>;
  const delta = examSnapshotDelta(payload(), partialSince);
  assert.deepEqual(
    delta.changedDomains,
    EXAM_REVISION_DOMAINS.filter((domain) => domain !== 'alerts'),
    '只说得出 alerts 的客户端，其余域一律照发',
  );
  assert.equal(delta.fields.alerts, undefined, '唯一说得出且一致的域才不下发');
});

test('mergeExamSnapshotPartial: 与缓存叠加，缺席字段保持缓存原值', () => {
  const cached = payload({ classes: [{ id: 'c9', name: '缓存里的班' }], updatedAt: 1 });
  const merged = mergeExamSnapshotPartial(cached, {
    ok: true,
    partial: true,
    alerts: { enabled: false },
    revisions: { ...CURRENT_REVISIONS, alerts: 2 },
    updatedAt: 2,
  });
  assert.ok(merged);
  assert.deepEqual(merged.alerts, { enabled: false }, '变化的域用服务端值');
  assert.deepEqual(merged.classes, [{ id: 'c9', name: '缓存里的班' }], '没变的域保持缓存原值');
  assert.equal(merged.updatedAt, 2);
  assert.equal(merged.partial, undefined, '信封字段不并进载荷');
  assert.equal(merged.ok, true, 'ok 保持原来的 true');
  assert.equal(mergeExamSnapshotPartial(null, { alerts: null }), null, '没有缓存时交回 null，让调用方整份重取');
});
