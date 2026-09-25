import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * 弹窗版式规格锁（P2）。
 *
 * 背景：弹窗内容一多就"一路往纵向拉长"，顶到屏幕上下边缘，观感很差。已有两处范式：
 * - 向导类（`.admin-modal--workflow`）固定高度 + 内部分栏，各自滚动；
 * - 考试详情抽屉、公告回执/发布确认窗：宽屏两栏（左右各自滚动），窄屏回落单列。
 * 这里把口径钉住，避免以后又写回"窄柱一路往下排"。
 */

const here = dirname(fileURLToPath(import.meta.url));

function resolveRepoRoot(): string {
  for (const candidate of [resolve(here, '..'), resolve(here, '..', '..')]) {
    if (existsSync(join(candidate, 'src', 'styles', 'admin.css'))) return candidate;
  }
  throw new Error('找不到仓库根（src/styles/admin.css）');
}

const repoRoot = resolveRepoRoot();

function readStyle(name: string): string {
  return readFileSync(join(repoRoot, 'src', 'styles', name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 取某条选择器自己的声明块（第一条匹配）。 */
function declarations(css: string, selector: string): string {
  const index = css.indexOf(selector);
  if (index < 0) return '';
  const open = css.indexOf('{', index);
  const close = css.indexOf('}', open);
  if (open < 0 || close < 0) return '';
  return css.slice(open + 1, close);
}

/** 取所有匹配该 query 的 @media 块文本（同一个断点可能分散在多处，按括号配平截取）。 */
function mediaBlock(css: string, query: string): string {
  const collected: string[] = [];
  let cursor = 0;
  while (true) {
    const start = css.indexOf(`@media ${query}`, cursor);
    if (start < 0) break;
    const open = css.indexOf('{', start);
    if (open < 0) break;
    let depth = 0;
    let end = -1;
    for (let index = open; index < css.length; index += 1) {
      if (css[index] === '{') depth += 1;
      else if (css[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    if (end < 0) break;
    collected.push(css.slice(open + 1, end));
    cursor = end + 1;
  }
  return collected.join('\n');
}

const adminCss = readStyle('admin.css');
const sannCss = readStyle('school-announcements.css');

test('弹窗版式：普通弹窗统一封顶，不再顶到屏幕上下边缘', () => {
  const base = declarations(adminCss, '.admin-modal {');
  assert.match(base, /max-height:\s*min\(/, '普通弹窗要有高度上限');
  assert.doesNotMatch(base, /100dvh/, '不要用 100dvh 贴满屏幕');

  const workflow = declarations(adminCss, '.admin-modal--workflow {');
  assert.match(workflow, /height:\s*min\(/, '向导类弹窗固定高度 + 内部滚动');
  assert.match(workflow, /overflow:\s*hidden/);
});

test('弹窗版式：公告回执宽屏两栏、窄屏单列、整窗封顶', () => {
  const shell = declarations(sannCss, '.sann-receipts {');
  assert.match(shell, /grid-template-rows:/, '整窗按 头/主体 两行排');
  assert.match(shell, /max-height:\s*min\(/);
  assert.match(shell, /max-width:\s*min\(10\d\d px|max-width:\s*min\(10\d\dpx/, '要覆盖 .admin-modal--wide 的 620px');

  const body = declarations(sannCss, '.sann-receipts__body {');
  assert.match(body, /grid-template-columns:\s*minmax\(0,\s*1fr\)/, '窄屏默认单列');

  const wide = mediaBlock(sannCss, '(min-width: 980px)');
  assert.match(wide, /\.sann-receipts__body[\s\S]*grid-template-columns:\s*minmax\([^)]*\)\s*minmax\(/, '宽屏两栏');
  assert.match(wide, /\.sann-receipts__stats[\s\S]*grid-template-columns:\s*repeat\(2,/, '侧栏统计改 2×2');
});

test('弹窗版式：公告发布确认窗同样两栏 + 整窗封顶', () => {
  const shell = declarations(sannCss, '.sann-publish {');
  assert.match(shell, /max-height:\s*min\(/);
  assert.match(shell, /max-width:\s*min\(10\d\dpx/, '要覆盖 .admin-modal--wide 的 620px');
  assert.match(shell, /grid-template-rows:/);

  const body = declarations(sannCss, '.sann-publish__body {');
  assert.match(body, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);

  const wide = mediaBlock(sannCss, '(min-width: 980px)');
  assert.match(wide, /\.sann-publish__body[\s\S]*grid-template-columns:\s*minmax\([^)]*\)\s*minmax\(/);
});
