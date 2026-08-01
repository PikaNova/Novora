import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DISPLAY_TIME_ZONE,
  formatClockInZone,
  formatDateTimeInZone,
  getZonedParts,
  parseZonedTime,
} from '../src/utils/zonedTime.js';

const KNOWN_UTC_MS = Date.UTC(2024, 0, 1, 0, 0, 0);

test('zonedTime: defaults to the Shanghai display zone', () => {
  assert.equal(DISPLAY_TIME_ZONE, 'Asia/Shanghai');
});

test('zonedTime: converts a UTC instant to Shanghai calendar parts', () => {
  assert.deepEqual(getZonedParts(KNOWN_UTC_MS), {
    year: 2024,
    month: 1,
    day: 1,
    hour: 8,
    minute: 0,
    second: 0,
    weekday: 1,
  });
});

test('zonedTime: supports an explicit timezone override', () => {
  const parts = getZonedParts(KNOWN_UTC_MS, 'UTC');
  assert.equal(parts.hour, 0);
  assert.equal(parts.day, 1);
});

test('zonedTime: formats a clock with zero padding', () => {
  assert.equal(formatClockInZone(KNOWN_UTC_MS), '08:00:00');
});

test('zonedTime: formats a date-time in the display zone', () => {
  assert.equal(formatDateTimeInZone(KNOWN_UTC_MS), '2024/01/01 08:00');
});

test('zonedTime: uses a placeholder for non-finite date-time input', () => {
  assert.equal(formatDateTimeInZone(Number.NaN), '-');
  assert.equal(formatDateTimeInZone(Number.POSITIVE_INFINITY), '-');
});

test('zonedTime: parses a local Shanghai time back to its UTC instant', () => {
  const ms = parseZonedTime('2024-01-01T08:00:00');
  assert.equal(ms, KNOWN_UTC_MS);
  assert.equal(formatDateTimeInZone(ms), '2024/01/01 08:00');
});

test('zonedTime: returns NaN for missing or invalid local times', () => {
  assert.ok(Number.isNaN(parseZonedTime('')));
  assert.ok(Number.isNaN(parseZonedTime('not-a-date')));
});
