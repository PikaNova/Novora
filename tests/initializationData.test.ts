import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInitializationData } from '../src/utils/initializationData.js';

const base = {
  school: [{ name: '高一年级', classes: '1 班、2 班' }],
  termStart: '2026-09-01',
  weekMode: 'single' as const,
  excludeOfficialHolidays: true,
  scheduleMode: 'major-only' as const,
  schoolName: '测试中学',
  province: '福建省',
};

test('buildInitializationData: 非演示模式不再生成默认考试', () => {
  const result = buildInitializationData({ ...base, mode: 'blank' });
  // 以前这里会写死一条名叫「大型考试」、创建人显示「系统」的占位考试，
  // 它会一直躺在考试中心的列表里（就是巡检里反馈的「不是我创建的考试」之一）。
  assert.deepEqual(result.majors, []);
  assert.equal(result.activeMajorId, '');
  assert.equal(result.weeklyPlans.length, 0);
  // 年级与班级照旧生成，初始化本身不受影响。
  assert.equal(result.grades.length, 1);
  assert.equal(result.classes.length, 2);
});

test('buildInitializationData: 演示模式仍给一份带科目的示例考试', () => {
  const result = buildInitializationData({ ...base, mode: 'demo' });
  assert.equal(result.majors.length, 1);
  assert.equal(result.majors[0].id, result.activeMajorId);
  assert.equal(result.majors[0].items.length, 3);
  assert.ok(result.weeklyPlans.length > 0);
  assert.equal(result.initialization.demoDataImported, true);
});
