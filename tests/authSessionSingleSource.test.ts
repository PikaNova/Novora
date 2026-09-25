/**
 * 前端会话凭据只有一个来源：src/services/auth/session.ts。
 *
 * 背景：'admin_auth_token' 这个字面量曾经散在 10 个 src 文件里——每个文件各拼一次
 * Authorization、各写一份过期判断、401 处理也各写各的。这里把它钉成不变量：再有人
 * 往业务文件里抄一份存储键或手拼 Bearer，用例直接失败。
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';

const SRC_DIR = path.join(process.cwd(), 'src');
const SESSION_MODULE = 'src/services/auth/session.ts';
/** 鉴权模块自身（session 存凭据、client 发请求）就是「唯一实现的地方」。 */
const AUTH_MODULE_DIR = 'src/services/auth/';

/** 登录链路本身要能指定令牌（bearerToken 参数），允许这两处自己拼头。 */
const EXPLICIT_BEARER_ALLOWED = ['src/services/emailAuth.ts', 'src/services/adminUsers.ts'];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

const relative = (file: string) => path.relative(process.cwd(), file).split(path.sep).join('/');
const files = sourceFiles(SRC_DIR);
const offenders = (predicate: (source: string, file: string) => boolean) =>
  files
    .filter((file) => relative(file) !== SESSION_MODULE && predicate(readFileSync(file, 'utf8'), file))
    .map(relative);

test('只有 auth/session.ts 认识会话存储键', () => {
  assert.deepEqual(
    offenders((source) => source.includes('admin_auth_token')),
    [],
    '会话存储键必须只在 src/services/auth/session.ts 里出现（其它地方请用 getAuthToken/authHeaders）',
  );
});

test('存储键与已上线客户端保持兼容', () => {
  const source = readFileSync(path.join(process.cwd(), SESSION_MODULE), 'utf8');
  assert.match(source, /export const AUTH_TOKEN_KEY = 'admin_auth_token';/);
  assert.match(source, /const AUTH_TOKEN_EXPIRES_KEY = 'admin_auth_token_expires';/);
});

test('服务层不再手拼 Bearer，除显式传入令牌的登录链路', () => {
  assert.deepEqual(
    offenders(
      (source, file) =>
        /Bearer \$\{/.test(source) &&
        !relative(file).startsWith(AUTH_MODULE_DIR) &&
        !EXPLICIT_BEARER_ALLOWED.includes(relative(file)),
    ),
    [],
    '带鉴权的请求请走 authHeaders()/apiFetch()，不要自己拼 Authorization',
  );
});

test('原先各自读令牌的服务都改从 session 模块取凭据', () => {
  for (const file of [
    'src/services/diagnosticLogs.ts',
    'src/services/classBinding.ts',
    'src/services/examRecords.ts',
    'src/services/examAnnouncements.ts',
    'src/services/adminUsers.ts',
    'src/services/emailAuth.ts',
    'src/services/update.ts',
    'src/services/systemStatus.ts',
    'src/components/DashboardPanel.tsx',
  ]) {
    const source = readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.match(
      source,
      /from '\.\.?\/(\.\.\/)?services\/auth\/session'|from '\.\/auth\/session'/,
      `${file} 应当从 auth/session 取凭据`,
    );
  }
});
