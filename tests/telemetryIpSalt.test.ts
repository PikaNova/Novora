import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';

// 鉴权实现自 v1.32 起按职责拆在 api/_auth/*（见 api/_auth.ts 的 barrel 说明），
// 因此这里拼接模块文件来断言「建表语句里确实有遥测配置表」。
const authModuleDir = path.join(process.cwd(), 'api/_auth');
const authSource = [
  readFileSync(path.join(process.cwd(), 'api/_auth.ts'), 'utf8'),
  ...readdirSync(authModuleDir)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => readFileSync(path.join(authModuleDir, name), 'utf8')),
].join('\n');
// 遥测 IP 盐已移出鉴权模块，独立成 api/_telemetry/ipSalt.ts。
const ipSaltSource = readFileSync(path.join(process.cwd(), 'api/_telemetry/ipSalt.ts'), 'utf8');
const configSource = readFileSync(path.join(process.cwd(), 'api/_telemetryConfig.ts'), 'utf8');
const telemetrySource = readFileSync(path.join(process.cwd(), 'api/telemetry.ts'), 'utf8');

function functionSource(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `expected exported function ${name}`);
  const end = source.indexOf('\nexport ', start + 1);
  return source.slice(start, end === -1 ? source.length : end);
}

test('no repository-default telemetry IP salt remains', () => {
  for (const source of [authSource, configSource, telemetrySource]) {
    assert.doesNotMatch(source, /REPO_IP_SALT|exam-board-telemetry-salt-2026/);
  }
});

test('the authentication migration creates a server-only telemetry configuration table', () => {
  assert.match(authSource, /CREATE TABLE IF NOT EXISTS app_telemetry_config/);
  assert.match(authSource, /ip_salt TEXT NOT NULL/);
});

test('ensureTelemetryIpSalt generates, persists, and rereads one database salt', () => {
  const source = functionSource(ipSaltSource, 'ensureTelemetryIpSalt');
  assert.match(source, /randomBytes\(24\)/);
  assert.match(source, /INSERT INTO app_telemetry_config/);
  assert.match(source, /ON CONFLICT \(id\) DO NOTHING/);
  assert.match(source, /SELECT ip_salt FROM app_telemetry_config/);
  assert.doesNotMatch(source, /console\.(log|info|warn|error|debug)/);
});

test('resolveIpSalt uses an optional environment override before the persistent server value', () => {
  const source = functionSource(configSource, 'resolveIpSalt');
  assert.match(configSource, /import \{ ensureTelemetryIpSalt \} from '.\/_telemetry\/ipSalt\.js';/);
  assert.match(source, /process\.env\.TELEMETRY_IP_SALT/);
  assert.match(source, /ensureTelemetryIpSalt\(\)/);
});

test('telemetry resolves the salt only after telemetry is eligible to relay', () => {
  assert.doesNotMatch(telemetrySource, /telemetryConfig\.ipSalt|const IP_SALT/);
  const tokenIndex = telemetrySource.indexOf('if (!token)');
  const saltIndex = telemetrySource.indexOf('await resolveIpSalt()');
  assert.ok(tokenIndex >= 0 && saltIndex > tokenIndex, 'salt must not be resolved before the relay credential check');
  assert.match(telemetrySource, /reason: 'privacy_config_unavailable'/);
});
