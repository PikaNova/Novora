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

rmSync(outputDir, { recursive: true, force: true });
try {
  run(process.execPath, [path.resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.integration.json']);
  run(process.execPath, ['--test', '.integration-check/tests/integration/*.test.js']);
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}
