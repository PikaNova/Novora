import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cumulativeToDailyRates,
  forecastUsage,
  MIN_SAMPLE_DAYS,
  type ForecastPoint,
} from '../api/_platformUsage/forecast.js';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const DAY = 86_400_000;

/** 造一段等值的日序列，日期从 startIso 起逐日递增。 */
function flatDays(count: number, value: number, startIso: string): ForecastPoint[] {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(start + index * DAY).toISOString(),
    value,
  }));
}

test('没有上限就不预测', () => {
  const result = forecastUsage({ used: 10, limit: null, series: flatDays(10, 1, '2026-09-20'), now: NOW });
  assert.equal(result.status, 'insufficient');
  assert.equal(result.daysLeft, null);
  assert.equal(result.remaining, null);
});

test('已超限直接判定，不给天数', () => {
  const result = forecastUsage({ used: 120, limit: 100, series: flatDays(10, 5, '2026-09-20'), now: NOW });
  assert.equal(result.status, 'exceeded');
  assert.equal(result.remaining, -20);
  assert.equal(result.exhaustsWithinPeriod, true);
  assert.equal(result.daysLeft, 0);
});

test('样本不足不做外推', () => {
  const result = forecastUsage({
    used: 5,
    limit: 100,
    series: flatDays(MIN_SAMPLE_DAYS - 1, 5, '2026-09-29'),
    periodStart: '2026-09-20T00:00:00Z',
    periodEnd: '2026-10-31T00:00:00Z',
    now: NOW,
  });
  assert.equal(result.status, 'insufficient');
  assert.equal(result.daysLeft, null);
  assert.equal(result.sampleDays, MIN_SAMPLE_DAYS - 1);
});

test('中位数抗突发：单日巨量不会把预测带偏', () => {
  const series = flatDays(10, 1, '2026-09-20');
  series[5] = { ...series[5], value: 1000 };
  const result = forecastUsage({
    used: 10,
    limit: 110,
    series,
    periodStart: '2026-09-20T00:00:00Z',
    periodEnd: '2026-12-31T00:00:00Z',
    now: NOW,
  });
  assert.equal(result.dailyRate, 1);
  assert.equal(result.daysLeft, 100);
  // 近 7 天均值会被那次突发抬高，于是标记为波动大。
  assert.equal(result.volatile, true);
});

test('会在本周期内用尽时给出天数与预计日期', () => {
  const result = forecastUsage({
    used: 20,
    limit: 100,
    series: flatDays(10, 8, '2026-09-20'),
    periodStart: '2026-09-20T00:00:00Z',
    periodEnd: '2026-10-31T00:00:00Z',
    now: NOW,
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.dailyRate, 8);
  assert.equal(result.remaining, 80);
  assert.equal(result.daysLeft, 10);
  assert.equal(result.daysToPeriodEnd, 30);
  assert.equal(result.exhaustsWithinPeriod, true);
  assert.equal(result.projectedExhaustDate, '2026-10-11');
});

test('周期内不会用尽时不下「用尽」结论', () => {
  const result = forecastUsage({
    used: 20,
    limit: 100,
    series: flatDays(10, 8, '2026-09-25'),
    periodStart: '2026-09-25T00:00:00Z',
    // 距周期结束只有 5 天，但按 8/天还要 10 天。
    periodEnd: '2026-10-06T12:00:00Z',
    now: NOW,
  });
  assert.equal(result.daysToPeriodEnd, 5);
  assert.equal(result.daysLeft, 10);
  assert.equal(result.exhaustsWithinPeriod, false);
  assert.equal(result.projectedExhaustDate, null);
});

test('零消耗：不会用尽，但也没有「还能用几天」', () => {
  const result = forecastUsage({
    used: 0,
    limit: 100,
    series: flatDays(10, 0, '2026-09-20'),
    periodStart: '2026-09-20T00:00:00Z',
    periodEnd: '2026-10-31T00:00:00Z',
    now: NOW,
  });
  assert.equal(result.status, 'no-usage');
  assert.equal(result.daysLeft, null);
  assert.equal(result.exhaustsWithinPeriod, false);
});

test('本周期样本不足时退回整个窗口，并标明口径', () => {
  const result = forecastUsage({
    used: 10,
    limit: 100,
    series: flatDays(30, 2, '2026-09-02'),
    // 本周期只有 2 天，达不到最小样本。
    periodStart: '2026-09-29T12:00:00Z',
    periodEnd: '2026-10-31T00:00:00Z',
    now: NOW,
  });
  assert.equal(result.basis, 'window');
  assert.equal(result.dailyRate, 2);
  assert.equal(result.daysLeft, 45);
});

test('未来日期不参与计算', () => {
  const result = forecastUsage({
    used: 10,
    limit: 100,
    series: [...flatDays(10, 1, '2026-09-20'), { date: '2026-10-20T00:00:00.000Z', value: 999 }],
    periodStart: '2026-09-20T00:00:00Z',
    periodEnd: '2026-10-31T00:00:00Z',
    now: NOW,
  });
  assert.equal(result.sampleDays, 10);
  assert.equal(result.dailyRate, 1);
});

test('没有周期信息时只给天数，不给「是否用尽」的结论', () => {
  const result = forecastUsage({ used: 20, limit: 100, series: flatDays(10, 8, '2026-09-20'), now: NOW });
  assert.equal(result.daysLeft, 10);
  assert.equal(result.daysToPeriodEnd, null);
  assert.equal(result.exhaustsWithinPeriod, null);
});

test('累计值换算成日均速度，周期重置造成的负增长被丢弃', () => {
  const points = [
    { date: '2026-09-28T00:00:00Z', value: 0 },
    { date: '2026-09-29T00:00:00Z', value: 10 },
    { date: '2026-09-30T00:00:00Z', value: 30 },
    // 周期重置：用量回落，这一步不能当成「负速度」参与中位数。
    { date: '2026-10-01T00:00:00Z', value: 5 },
  ];
  assert.deepEqual(cumulativeToDailyRates(points), [
    { date: '2026-09-29T00:00:00.000Z', value: 10 },
    { date: '2026-09-30T00:00:00.000Z', value: 20 },
  ]);
});

test('累计值样本不足或乱序时也不出错', () => {
  assert.deepEqual(cumulativeToDailyRates([]), []);
  assert.deepEqual(cumulativeToDailyRates([{ date: '2026-09-30T00:00:00Z', value: 5 }]), []);
  // 乱序输入先按时间排好再求差。
  assert.deepEqual(
    cumulativeToDailyRates([
      { date: '2026-09-30T00:00:00Z', value: 30 },
      { date: '2026-09-29T00:00:00Z', value: 10 },
      { date: '2026-09-28T00:00:00Z', value: 0 },
      { date: 'not-a-date', value: 99 },
    ]),
    [
      { date: '2026-09-29T00:00:00.000Z', value: 10 },
      { date: '2026-09-30T00:00:00.000Z', value: 20 },
    ],
  );
});
