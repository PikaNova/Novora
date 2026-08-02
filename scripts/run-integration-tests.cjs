const { randomBytes } = require('node:crypto');
const { rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const integrationUrl = process.env.INTEGRATION_DATABASE_URL;
if (!integrationUrl) {
  throw new Error('INTEGRATION_DATABASE_URL is required. Refusing to use DATABASE_URL for integration tests.');
}
if (process.env.INTEGRATION_TEST_CONFIRM !== 'novora-disposable') {
  throw new Error('Set INTEGRATION_TEST_CONFIRM=novora-disposable to confirm this database may be cleared.');
}

const outputDir = path.resolve('.integration-check');
const testEnvironment = {
  ...process.env,
  DATABASE_URL: integrationUrl,
  ADMIN_PASSWORD: randomBytes(24).toString('base64url'),
};

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: testEnvironment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 1}`);
}

function runTestsWithTransientRetry() {
  const args = ['--test', '.integration-check/tests/integration/*.test.js'];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      env: testEnvironment,
      encoding: 'utf8',
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    process.stdout.write(output);
    if (result.error) throw result.error;
    if (result.status === 0) return;
    const transientDisconnect = /Error connecting to database: fetch failed|SocketError: other side closed|ECONNRESET|ETIMEDOUT/.test(output);
    if (attempt === 1 && transientDisconnect) {
      console.warn('Transient Neon transport disconnect detected; retrying the full isolated integration suite once.');
      continue;
    }
    throw new Error(`${process.execPath} exited with status ${result.status ?? 1}`);
  }
}

rmSync(outputDir, { recursive: true, force: true });
try {
  run(process.execPath, [path.resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.integration.json']);
  runTestsWithTransientRetry();
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}
