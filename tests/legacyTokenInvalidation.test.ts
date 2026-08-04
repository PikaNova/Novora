import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';

const authSource = readFileSync(path.join(process.cwd(), 'api/_auth.ts'), 'utf8');
const usersSource = readFileSync(path.join(process.cwd(), 'api/users.ts'), 'utf8');

function functionSource(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `expected exported function ${name}`);
  const end = source.indexOf('\nexport ', start + 1);
  return source.slice(start, end === -1 ? source.length : end);
}

function sourceSection(source: string, marker: string, nextMarker: string): string {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `expected ${marker}`);
  const end = source.indexOf(nextMarker, start + marker.length);
  assert.notEqual(end, -1, `expected boundary ${nextMarker}`);
  return source.slice(start, end);
}

test('legacy shared-token invalidation increments the global compatibility version', () => {
  const section = functionSource(authSource, 'invalidateLegacySharedToken');
  assert.match(section, /UPDATE app_auth SET token_version=token_version\+1/);
  assert.match(section, /WHERE id=1/);
});

test('the legacy three-part token branch validates the global compatibility version', () => {
  const section = functionSource(authSource, 'getActor');
  assert.match(section, /parts\.length === 3/);
  assert.match(section, /isLegacySharedTokenVersionCurrent\(version, auth\.token_version\)/);
  assert.match(section, /default admin account/);
});

for (const name of [
  'recoverSuperAdmin',
  'repairSuperAdmin',
  'changeOwnPassword',
  'changeOwnUsername',
  'changeOwnCredentials',
]) {
  test(`${name} invalidates legacy shared tokens before changing a user token`, () => {
    const section = functionSource(authSource, name);
    const legacyIndex = section.indexOf('await invalidateLegacySharedToken();');
    const userVersionIndex = section.indexOf('token_version=token_version+1');
    assert.ok(legacyIndex >= 0, 'expected legacy-token invalidation');
    assert.ok(userVersionIndex >= 0, 'expected per-user token invalidation');
    assert.ok(legacyIndex < userVersionIndex, 'legacy invalidation must succeed before the user change');
  });
}

test('user administration invalidates legacy shared tokens before role/status or password changes', () => {
  const update = sourceSection(usersSource, "if (action === 'update')", "if (action === 'reset-password')");
  const reset = sourceSection(usersSource, "if (action === 'reset-password')", "if (action === 'delete')");
  for (const section of [update, reset]) {
    const legacyIndex = section.indexOf('await invalidateLegacySharedToken();');
    const userVersionIndex = section.indexOf('token_version=token_version+1');
    assert.ok(legacyIndex >= 0, 'expected legacy-token invalidation');
    assert.ok(userVersionIndex >= 0, 'expected per-user token invalidation');
    assert.ok(legacyIndex < userVersionIndex, 'legacy invalidation must precede the user change');
  }
});
