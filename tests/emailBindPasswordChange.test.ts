import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';

// 该模块没有 default export，不是 HTTP 入口，改名带下划线以免占用 Vercel 函数名额。
const emailAuthSource = readFileSync(path.join(process.cwd(), 'api/_emailAuth.ts'), 'utf8');

function firstActorBindCall(source: string, handlerName: string): string {
  const start = source.indexOf(`async function ${handlerName}`);
  assert.notEqual(start, -1, `expected handler ${handlerName}`);
  const end = source.indexOf('\nasync function ', start + 1);
  const section = source.slice(start, end === -1 ? source.length : end);
  const call = section.match(/const actor = await requireActor\([^;]+\);/);
  assert.ok(call, `expected requireActor call in ${handlerName}`);
  return call[0];
}

test('initial-login email binding is allowed while the password change is still required', () => {
  for (const handler of ['handleBindRequest', 'handleBindConfirm']) {
    const call = firstActorBindCall(emailAuthSource, handler);
    assert.match(
      call,
      /requireActor\(req, res, undefined, true\)/,
      `${handler} must allow password-change-required actors to bind their own email`,
    );
  }
});

test('post-login unbind stays restricted to fully authenticated actors', () => {
  const call = firstActorBindCall(emailAuthSource, 'handleUnbind');
  assert.match(call, /requireActor\(req, res\)/);
  assert.doesNotMatch(call, /undefined, true/, 'unbind must not be reachable before the initial password change');
});
