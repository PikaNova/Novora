import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * 日期 / 时间控件统一性（P2）。
 *
 * 背景：项目里已经有一套统一控件（`src/components/touch-datetime-picker` 的 `DateTimeField`），
 * AGENTS.md 也写明了用法。但「考试安排 → 日程轴 → 临时调整这次周测」曾经用的是原生
 * `<input type="date">` / `<input type="time">`，`TimeRangePickerModal` 的日期字段则漏了
 * className、落回 44px 的触屏默认档 —— 同一页里三套外观。这里把口径钉住：
 *
 *   1. src 下不允许出现原生日期/时间输入；
 *   2. 每个 `<DateTimeField` 必须显式挂一个"认可"的上下文类；
 *   3. 被认可的类必须在样式里有 `.tdp-field` 规则（否则会静默回落到默认档）。
 */

const here = dirname(fileURLToPath(import.meta.url));
/**
 * 测试有两种运行位置：源码目录（tests/x.ts → 上一级是仓库根）与编译产物
 * （.test-check/tests/x.test.js → 上两级才是仓库根）。按 "src/styles 是否存在" 判定，
 * 否则会去扫 .test-check/src（只有编译产物、没有 css/tsx），断言全部空过。
 */
function resolveRepoRoot(): string {
  for (const candidate of [resolve(here, '..'), resolve(here, '..', '..')]) {
    if (existsSync(join(candidate, 'src', 'styles', 'controls.css'))) return candidate;
  }
  throw new Error('找不到仓库根（src/styles/controls.css）');
}

const repoRoot = resolveRepoRoot();

/** 认可的上下文类：后台/设置/初始化向导各一套，都必须真的被样式覆盖。 */
const SANCTIONED_CLASSES = ['admin-date-time-field', 'set-date-time-field', 'init-date-time-field'];

function collectFiles(directory: string, extension: string, output: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      // 控件自己的实现里会出现 "type=\"datetime-local\"" 这类契约注释，不算违规。
      if (full.endsWith(join('touch-datetime-picker'))) continue;
      collectFiles(full, extension, output);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(extension)) output.push(full);
  }
  return output;
}

const srcFiles = collectFiles(join(repoRoot, 'src'), '.tsx').concat(collectFiles(join(repoRoot, 'src'), '.ts'));

test('日期/时间控件：src 下不允许原生日期或时间输入', () => {
  const offenders: string[] = [];
  for (const file of srcFiles) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of [/type="date"/, /type="time"/, /type="datetime-local"/, /type='date'/, /type='time'/]) {
      if (pattern.test(source)) offenders.push(`${relative(repoRoot, file)} 命中 ${pattern}`);
    }
  }
  assert.deepEqual(offenders, [], '统一使用 DateTimeField，不要用浏览器原生日期/时间控件');
});

test('日期/时间控件：每个 DateTimeField 都要挂认可的上下文类', () => {
  const offenders: string[] = [];
  for (const file of srcFiles) {
    const source = readFileSync(file, 'utf8');
    const usages = source.match(/<DateTimeField[\s\S]*?\/>/g) ?? [];
    for (const usage of usages) {
      const match = /className="([^"]+)"/.exec(usage);
      if (!match) {
        offenders.push(`${relative(repoRoot, file)} 的 DateTimeField 缺 className`);
        continue;
      }
      if (!SANCTIONED_CLASSES.includes(match[1])) {
        offenders.push(`${relative(repoRoot, file)} 用了未认可的 className="${match[1]}"`);
      }
    }
  }
  assert.deepEqual(offenders, [], `认可的类只有 ${SANCTIONED_CLASSES.join(' / ')}`);
});

test('日期/时间控件：认可的上下文类必须真的定义了 .tdp-field 规则', () => {
  const stylesDir = join(repoRoot, 'src', 'styles');
  const css = readdirSync(stylesDir)
    .filter((name) => name.endsWith('.css'))
    .map((name) => readFileSync(join(stylesDir, name), 'utf8'))
    .join('\n');
  const missing = SANCTIONED_CLASSES.filter((className) => !new RegExp(`\\.${className}[^{}]*\\.tdp-field`).test(css));
  assert.deepEqual(missing, [], '这些类没有 .tdp-field 规则，会静默落回默认档（44px 触屏档）');
});
