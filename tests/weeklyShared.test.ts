import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDT, weeklyPlanDetailName } from '../src/components/weekly/weeklyShared.js';

test('fmtDT: formats an ISO datetime down to minute precision', () => {
  assert.equal(fmtDT('2025-01-15T09:30:00.000Z'), '2025-01-15 09:30');
});

test('fmtDT: returns an em dash placeholder for empty/undefined input', () => {
  assert.equal(fmtDT(undefined), '\u2014');
  assert.equal(fmtDT(''), '\u2014');
});

test('weeklyPlanDetailName: strips a leading "grade \u00b7 class" prefix', () => {
  assert.equal(
    weeklyPlanDetailName('\u9ad8\u4e00 \u00b7 1\u73ed \u5468\u4e00\u5468\u4e8c\u65e9\u81ea\u4e60', '\u9ad8\u4e00', '1\u73ed'),
    '\u5468\u4e00\u5468\u4e8c\u65e9\u81ea\u4e60',
  );
});

test('weeklyPlanDetailName: strips a bare class-name prefix when grade+class prefix is absent', () => {
  assert.equal(
    weeklyPlanDetailName('1\u73ed - \u665a\u81ea\u4e60', '\u9ad8\u4e00', '1\u73ed'),
    '\u665a\u81ea\u4e60',
  );
});

test('weeklyPlanDetailName: strips repeated/duplicated prefixes (copied plans)', () => {
  assert.equal(
    weeklyPlanDetailName('1\u73ed_1\u73ed_\u65e9\u81ea\u4e60', '\u9ad8\u4e00', '1\u73ed'),
    '\u65e9\u81ea\u4e60',
  );
});

test('weeklyPlanDetailName: falls back to the original name when there is no matching prefix', () => {
  assert.equal(
    weeklyPlanDetailName('\u665a\u81ea\u4e60\u8ba1\u5212', '\u9ad8\u4e00', '1\u73ed'),
    '\u665a\u81ea\u4e60\u8ba1\u5212',
  );
});

test('weeklyPlanDetailName: falls back to the original name if stripping would leave it empty', () => {
  assert.equal(
    weeklyPlanDetailName('\u9ad8\u4e00 \u00b7 1\u73ed', '\u9ad8\u4e00', '1\u73ed'),
    '\u9ad8\u4e00 \u00b7 1\u73ed',
  );
});
