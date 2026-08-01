import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MOTION_MODE, type MotionMode } from '../src/utils/settings/motion.js';
import { DEFAULT_TIME_SYNC_SETTINGS } from '../src/utils/settings/timeSync.js';
import { DEFAULT_TYPOGRAPHY, type TypographyFontId } from '../src/utils/settings/typography.js';

const validMotionModes: MotionMode[] = ['auto', 'best-effects', 'best-performance'];
const validTimeSyncProviders = ['httpDate', 'timeApi', 'ntp'];
const validFontIds: TypographyFontId[] = ['design', 'alibaba', 'sourceHan', 'smiley', 'wenkai', 'general', 'jbmono'];

const buildGlobals = globalThis as typeof globalThis & {
  __APP_VERSION__?: string;
  __COMMIT_SHA__?: string;
};
buildGlobals.__APP_VERSION__ = 'test';
buildGlobals.__COMMIT_SHA__ = 'test';
const { buildExamSaveInput } = await import('../src/utils/settings/buildExamSaveInput.js');

test('DEFAULT_MOTION_MODE is valid and stable', () => {
  assert.ok(validMotionModes.includes(DEFAULT_MOTION_MODE));
  assert.equal(DEFAULT_MOTION_MODE, 'auto');
});

test('DEFAULT_TIME_SYNC_SETTINGS has valid provider and numeric defaults', () => {
  assert.ok(validTimeSyncProviders.includes(DEFAULT_TIME_SYNC_SETTINGS.provider));
  assert.equal(DEFAULT_TIME_SYNC_SETTINGS.enabled, true);
  assert.equal(DEFAULT_TIME_SYNC_SETTINGS.autoSyncEnabled, true);
  assert.ok(DEFAULT_TIME_SYNC_SETTINGS.ntpPort > 0 && DEFAULT_TIME_SYNC_SETTINGS.ntpPort < 65536);
  assert.ok(DEFAULT_TIME_SYNC_SETTINGS.autoSyncIntervalSec > 0);
  assert.ok(DEFAULT_TIME_SYNC_SETTINGS.httpDateUrl.length > 0);
  assert.ok(DEFAULT_TIME_SYNC_SETTINGS.timeApiUrl.length > 0);
  assert.ok(DEFAULT_TIME_SYNC_SETTINGS.ntpHost.length > 0);
});

test('DEFAULT_TYPOGRAPHY uses supported font ids', () => {
  assert.ok(validFontIds.includes(DEFAULT_TYPOGRAPHY.navigation));
  assert.ok(validFontIds.includes(DEFAULT_TYPOGRAPHY.display));
  assert.ok(validFontIds.includes(DEFAULT_TYPOGRAPHY.content));
  assert.ok(validFontIds.includes(DEFAULT_TYPOGRAPHY.numeric));
});

test('buildExamSaveInput creates a complete default save payload without localStorage', () => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  const input = buildExamSaveInput() as Record<string, unknown>;
  assert.ok(Array.isArray(input.items));
  assert.equal(typeof input.title, 'string');
  assert.ok(Array.isArray(input.majors));
  assert.ok(Array.isArray(input.weeklyPlans));
  assert.ok(Array.isArray(input.grades));
  assert.ok(Array.isArray(input.classes));
  assert.equal(typeof input.scheduleMode, 'string');
  assert.equal(input.baseUpdatedAt, 0);
});

test('buildExamSaveInput applies explicit overrides after defaults', () => {
  const input = buildExamSaveInput({ title: 'custom title', baseUpdatedAt: 42 }) as Record<string, unknown>;
  assert.equal(input.title, 'custom title');
  assert.equal(input.baseUpdatedAt, 42);
});
