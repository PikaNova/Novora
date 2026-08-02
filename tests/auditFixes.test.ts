import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const permissionsSource = readFileSync(
  path.join(process.cwd(), 'api/_exams/permissions.ts'),
  'utf8',
);
const outboxSource = readFileSync(
  path.join(process.cwd(), 'src/services/examOutbox.ts'),
  'utf8',
);
const loginSource = readFileSync(
  path.join(process.cwd(), 'api/login.ts'),
  'utf8',
);

test('quick temporary major ownership has one shared permission predicate', () => {
  const definitions = permissionsSource.match(/const isOwnedQuickTemporaryMajor\s*=/g) ?? [];
  assert.equal(definitions.length, 1);
  const validateStart = permissionsSource.indexOf('export function validateMutation');
  assert.ok(validateStart >= 0);
  const validateSource = permissionsSource.slice(validateStart);
  assert.doesNotMatch(validateSource, /const isOwnedQuickTemporaryMajor\s*=/);
  assert.match(validateSource, /isOwnedQuickTemporaryMajor\(actor, major\)/);
});

test('ghost-save default clock uses the freshness-aware shared time source', () => {
  assert.match(outboxSource, /import \{ nowMs \} from '\.\.\/utils\/timeSource';/);
  assert.match(outboxSource, /now = nowMs\(\)/);
});

test('login failure paths use one shared delay constant', () => {
  assert.match(loginSource, /const AUTH_FAILURE_DELAY_MS = 400;/);
  const delays = loginSource.match(/setTimeout\(resolve, AUTH_FAILURE_DELAY_MS\)/g) ?? [];
  assert.equal(delays.length, 4);
});
