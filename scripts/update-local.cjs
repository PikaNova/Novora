#!/usr/bin/env node
/**
 * 本地部署一键更新（npm run update:local）
 * - Docker 模式：git pull --ff-only + docker compose up -d --build + 健康检查
 * - 裸机模式：git pull --ff-only + 前端构建 + server 编译，提示手动重启服务
 * 数据库迁移由应用冷启动自动执行；数据卷不受影响。
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { runBackup } = require('./database-backup.cjs');

const repo = process.cwd();
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.status !== 0) {
    console.error(`\n命令失败（退出码 ${result.status ?? 'unknown'}）：${cmd} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

function loadPort() {
  const envPort = Number(process.env.PORT);
  if (Number.isFinite(envPort) && envPort > 0) return envPort;
  try {
    const envFile = fs.readFileSync(path.join(repo, '.env'), 'utf8');
    const match = envFile.match(/^PORT\s*=\s*(\d+)/m);
    if (match) return Number(match[1]);
  } catch {
    /* no .env */
  }
  return 3000;
}

async function waitForHealth(port, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) return { ok: true, body: data };
    } catch {
      /* not ready yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return { ok: false, body: null };
}

async function main() {
  console.log('=== Novora 本地部署更新 ===');

  // 1) 升级前备份：必须在 git pull 之前，失败即终止，绝不在没备份的情况下继续升级。
  console.log('\n[1/5] 升级前数据库备份');
  try {
    const backup = runBackup();
    console.log(
      `备份完成：${backup.file}（${(backup.size / 1024 / 1024).toFixed(2)} MB，${backup.durationMs} ms，sha256 ${backup.sha256.slice(0, 12)}…）`,
    );
    if (backup.removed.length) console.log(`已按保留策略清理：${backup.removed.join('、')}`);
  } catch (error) {
    console.error(`\n升级已终止：数据库备份失败，未拉取代码也未重启服务。\n原因：${error.message}`);
    process.exit(1);
  }

  // 2) 拉取最新代码
  console.log('\n[2/5] 拉取最新代码（git pull --ff-only）');
  const pull = spawnSync('git', ['pull', '--ff-only'], { stdio: 'inherit' });
  if (pull.status !== 0) {
    console.error('\ngit pull 失败：请先处理本地未提交改动或解决分叉后再重试。');
    process.exit(pull.status ?? 1);
  }

  // 2) 判断部署模式
  const hasDocker =
    fs.existsSync(path.join(repo, 'docker-compose.yml')) &&
    spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;

  const port = loadPort();

  if (hasDocker) {
    console.log('\n[3/5] Docker 模式：重建并启动（docker compose up -d --build）');
    run('docker', ['compose', 'up', '-d', '--build']);
  } else {
    console.log('\n[3/5] 裸机模式：构建前端与 server');
    run(npmCmd, ['run', 'build']);
    run(npmCmd, ['run', 'serve:build']);
  }

  // 3) 健康检查
  console.log(`\n[4/5] 健康检查（http://127.0.0.1:${port}/api/health，最多等待 90 秒）`);
  const health = await waitForHealth(port, 90 * 1000);
  if (!health.ok) {
    console.error('\n健康检查未通过：服务未能在 90 秒内返回 ok。请查看日志：docker compose logs -f app');
    process.exit(1);
  }
  console.log('健康检查通过：db ok，版本 ' + (health.body.version || 'unknown'));

  // 4) 收尾提示
  const rev = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  console.log('\n[5/5] 更新完成：当前代码 ' + rev);
  console.log('如需回滚数据：npm run db:restore -- --file data/backups/<备份>.dump');
  if (!hasDocker) {
    console.log('裸机模式不会自动重启服务：如已在运行，请执行 npm start（或 pm2 restart novora）。');
  }
  console.log('若浏览器仍显示旧版本，请刷新页面或等待 Service Worker 更新缓存。');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
