#!/usr/bin/env node
/**
 * 会话内的快路径：只验证这次改动碰到的东西。
 *
 * 背景：全量 `npm test` 会为 108 个测试文件各起一个进程（本机实测 36–50s），
 * 而一次改动通常只影响其中一两个。这里按 git 改动挑出「引用了被改模块」的测试文件；
 * 只要出现「改了但没有任何测试引用」的源文件、或改了配置/样式/脚本，就退回全量
 * ——宁慢勿漏，快路径不会给出比全量更弱的结论。
 *
 * 用法：
 *   node scripts/verify-changed.cjs               # 改动文件的 lint/format + 受影响的测试
 *   node scripts/verify-changed.cjs --tests-only  # 只跑受影响的测试
 *   node scripts/verify-changed.cjs --all         # 强制全量测试
 *   node scripts/verify-changed.cjs --list        # 只打印会跑哪些，不执行
 *   node scripts/verify-changed.cjs --list src/utils/logger.ts
 *                                                 # 按给定文件试算（不读 git），用于确认选择逻辑
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(ROOT, 'tests');
const OUT_DIR = path.join(ROOT, '.test-check');
const TESTS_ONLY = process.argv.includes('--tests-only');
const FORCE_ALL = process.argv.includes('--all');
const LIST_ONLY = process.argv.includes('--list');
const EXPLICIT_FILES = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

const LINTABLE = /\.(ts|tsx|js|cjs|mjs)$/;
const FORMATTABLE = /\.(ts|tsx|js|cjs|mjs|json|css|md|yml|yaml)$/;
/** 文档类改动不影响测试选择，但仍参与格式化检查。 */
const DOC_LIKE = /(^|\/)[^/]*\.md$|^docs\/|^workspace\/|^deliverables\//;
/** 改了这些就退回全量：它们改变测试怎么跑，而不是被测代码本身。 */
const INFRA = [
  /^package(-lock)?\.json$/,
  /^tsconfig[^/]*\.json$/,
  /^scripts\//,
  /^\.github\//,
  /^vite\.config\.ts$/,
  /^eslint\.config\.js$/,
  /^\.prettier/,
  /^index\.html$/,
  /^public\//,
  /^migrations\//,
  /\.css$/,
  /^Dockerfile$/,
  /^vercel\.json$/,
];
/** 测试选择的范围：测试跑的是 src 与 api，其余（集成测试、本地脚本）不参与。 */
const SOURCE = /^(src|api)\//;
const isTestSource = (file) => /^tests\/[^/]+\.test\.ts$/.test(file);

function run(command, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', ...options });
  return { status: result.status ?? 1, ms: Date.now() - started };
}

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function changedFiles() {
  const files = new Set([
    ...git(['diff', '--name-only', 'HEAD']),
    ...git(['diff', '--name-only', '--cached']),
    ...git(['ls-files', '--others', '--exclude-standard']),
  ]);
  return [...files].map((file) => file.split(path.sep).join('/')).sort();
}

function walk(directory, match) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(entryPath, match));
    else if (entry.isFile() && match(entryPath)) found.push(entryPath);
  }
  return found;
}

/** `src/utils/logger.ts` → `src/utils/logger`；`src/utils/settings/index.ts` → 额外的 `src/utils/settings`。 */
function moduleKeys(relativePath) {
  const withoutExtension = relativePath.replace(/\.(ts|tsx|js|jsx)$/, '');
  const keys = [withoutExtension];
  if (withoutExtension.endsWith('/index')) keys.push(withoutExtension.slice(0, -'/index'.length));
  return keys;
}

function importKeys(sourceFile, specifier) {
  if (!specifier.startsWith('.')) return [];
  const absolute = path.resolve(path.dirname(sourceFile), specifier);
  const relative = path.relative(ROOT, absolute).split(path.sep).join('/');
  return moduleKeys(relative);
}

/**
 * 扫描 src/api/tests 里 import/import() 的相对路径，建一张反向依赖表：
 * 「被引用的模块 → 引用它的文件」。改了某个模块后，从它出发向上走一遍就知道
 * 哪些测试（直接或经过其它源码模块间接）会碰到它。
 */
function buildReverseImports() {
  const reverse = new Map();
  const specifierPattern = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;
  const scan = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        scan(entryPath);
        continue;
      }
      if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
      const relative = path.relative(ROOT, entryPath).split(path.sep).join('/');
      if (!SOURCE.test(relative) && !isTestSource(relative)) continue;
      for (const match of fs.readFileSync(entryPath, 'utf8').matchAll(specifierPattern)) {
        for (const key of importKeys(entryPath, match[1])) {
          if (!reverse.has(key)) reverse.set(key, new Set());
          reverse.get(key).add(relative);
        }
      }
    }
  };
  scan(path.join(ROOT, 'src'));
  scan(path.join(ROOT, 'api'));
  scan(TESTS_DIR);
  return reverse;
}

function compiledTestPath(testSource) {
  const relative = path.relative(TESTS_DIR, testSource).replace(/\.ts$/, '.js');
  return path.join(OUT_DIR, 'tests', relative);
}

function selectTests(changed) {
  const testSources = walk(
    TESTS_DIR,
    (file) => path.basename(file).endsWith('.test.ts') && !file.endsWith('.integration.test.ts'),
  );
  const reverse = buildReverseImports();
  const selected = new Set();
  const widening = [];
  const uncovered = [];

  /** 从被改的模块向上找所有会加载它的测试文件。 */
  const testsCovering = (file) => {
    const found = new Set();
    const queue = moduleKeys(file);
    const seen = new Set(queue);
    while (queue.length) {
      const key = queue.shift();
      for (const importer of reverse.get(key) ?? []) {
        if (isTestSource(importer)) found.add(importer);
        else if (!seen.has(importer)) {
          seen.add(importer);
          queue.push(importer);
        }
      }
    }
    return [...found];
  };

  for (const file of changed) {
    if (DOC_LIKE.test(file)) continue;
    if (INFRA.some((pattern) => pattern.test(file))) {
      widening.push(file);
      continue;
    }
    if (isTestSource(file)) {
      selected.add(compiledTestPath(path.join(ROOT, file)));
      continue;
    }
    if (SOURCE.test(file) && /\.(ts|tsx)$/.test(file)) {
      const covering = testsCovering(file);
      if (covering.length) covering.forEach((test) => selected.add(compiledTestPath(path.join(ROOT, test))));
      else uncovered.push(file);
      continue;
    }
    widening.push(file);
  }

  return { testSources, selected: [...selected].sort(), widening, uncovered };
}

/**
 * 增量编译的已知坑：`.tsbuildinfo` 说「已是最新」时 tsc 不会补发产物，
 * 如果 .test-check 里的 .js 被单独删掉（换分支、手工清理、脚本事故），
 * 编译就会跳过输出、测试文件随之全部消失。这里发现产物缺失就重编一次。
 */
function ensureCompiled(testSources) {
  const missing = testSources.some((source) => !fs.existsSync(compiledTestPath(source)));
  if (!missing) return null;
  console.log('[verify] 编译产物缺失，重建 .test-check …');
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  return run(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.test.json']);
}

function runFullSuite(testSources) {
  const compiled = testSources.map(compiledTestPath);
  return run(process.execPath, ['--test', ...compiled]);
}

function main() {
  const changed = EXPLICIT_FILES.length ? EXPLICIT_FILES : changedFiles();
  if (!changed.length) {
    console.log('[verify] 工作树没有改动，跳过。');
    return 0;
  }

  const { testSources, selected, widening, uncovered } = selectTests(changed);
  const full = FORCE_ALL || widening.length > 0;
  console.log(
    `[verify] 改动 ${changed.length} 个文件；选中 ${selected.length}/${testSources.length} 个测试文件` +
      (full
        ? `（全量：${FORCE_ALL ? '--all' : widening.slice(0, 3).join('、')}${widening.length > 3 ? ' 等' : ''}）`
        : ''),
  );
  uncovered
    .slice(0, 3)
    .forEach((file) => console.log(`[verify] 注意：${file} 没有任何测试（含间接）引用它，全量也覆盖不到。`));
  if (uncovered.length > 3) console.log(`[verify] 另有 ${uncovered.length - 3} 个改动文件没有测试引用。`);
  if (LIST_ONLY) {
    for (const file of selected) console.log('  ' + path.relative(ROOT, file).split(path.sep).join('/'));
    if (full) console.log('  （全量：.test-check/tests/*.test.js）');
    return 0;
  }

  const compile = run(process.execPath, [
    path.join(ROOT, 'node_modules/typescript/bin/tsc'),
    '-p',
    'tsconfig.test.json',
  ]);
  if (compile.status !== 0) {
    console.error(`[verify] 测试工程编译失败（${(compile.ms / 1000).toFixed(1)}s）。`);
    return compile.status;
  }
  const prepare = run(process.execPath, [path.join(ROOT, 'scripts/prepare-test-output.cjs')]);
  if (prepare.status !== 0) return prepare.status;

  const rebuild = ensureCompiled(testSources);
  if (rebuild && rebuild.status !== 0) {
    console.error('[verify] 重建编译产物失败。');
    return rebuild.status;
  }
  if (rebuild) run(process.execPath, [path.join(ROOT, 'scripts/prepare-test-output.cjs')]);

  let exitCode = 0;
  const testsStarted = Date.now();
  if (!testSources.length) {
    console.error('[verify] 没找到任何测试文件，请先检查 tests/ 目录。');
    return 1;
  }
  if (full) exitCode = runFullSuite(testSources).status;
  else if (selected.length) exitCode = run(process.execPath, ['--test', ...selected]).status;
  const testsMs = Date.now() - testsStarted;

  let lintMs = 0;
  let styleIssues = 0;
  if (!TESTS_ONLY) {
    const lintable = changed.filter((file) => LINTABLE.test(file) && fs.existsSync(path.join(ROOT, file)));
    if (lintable.length) {
      const lint = run(process.execPath, [
        path.join(ROOT, 'node_modules/eslint/bin/eslint.js'),
        '--no-warn-ignored',
        ...lintable,
      ]);
      lintMs += lint.ms;
      if (lint.status !== 0) styleIssues += 1;
    }
    const formattable = changed.filter((file) => FORMATTABLE.test(file) && fs.existsSync(path.join(ROOT, file)));
    if (formattable.length) {
      const format = run(process.execPath, [
        path.join(ROOT, 'node_modules/prettier/bin/prettier.cjs'),
        '--check',
        ...formattable,
      ]);
      lintMs += format.ms;
      if (format.status !== 0) styleIssues += 1;
    }
  }

  console.log(
    `[verify] 编译 ${(compile.ms / 1000).toFixed(1)}s · 测试 ${(testsMs / 1000).toFixed(1)}s` +
      (TESTS_ONLY ? '' : ` · lint/format ${(lintMs / 1000).toFixed(1)}s`) +
      ` · ${exitCode === 0 ? '通过' : '未通过'}`,
  );
  if (styleIssues) {
    // 共享工作树里 lint/format 会连带看到并行会话在改的文件，所以只报告、不阻断；
    // 只对本次会话自己改的文件跑 `prettier --write` / `eslint --fix`。
    console.log(`[verify] lint/format：有 ${styleIssues} 项需要处理（不影响退出码；先确认是不是你自己的文件）。`);
  }
  return exitCode;
}

process.exit(main());
