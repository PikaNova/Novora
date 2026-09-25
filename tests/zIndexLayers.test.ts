import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 叠层阶梯回归。
 *
 * 背景：这一周连着踩了两次同一类坑——东西挂在页面树里、或 z-index 低于弹窗，就会被弹窗盖住：
 * 草稿提示条（60 vs 遮罩 15000）点不到；编辑器里的「预览与导出 PDF」（5000 vs 15000）整块盖在底下。
 * 层级是全局约定，改一处忘一处就会复发，所以钉在测试里。
 *
 * 约定（transitions.css 是这条阶梯的唯一权威）：
 *   提醒层 20000 ＞ 帮助提示 19510 ＞ 确认框 19000 ＞ 下拉菜单 18000 ＞
 *   时间选择器 17000 ＞ 二级整屏面板（含打印预览）16000 ＞ 基础弹窗遮罩 15000
 */

const STYLE_DIRS = [
  new URL('../../src/styles/', import.meta.url), // 编译后：.test-check/tests/ → 仓库根
  new URL('../src/styles/', import.meta.url), // 直接跑源码时
];

function readFile(...candidates: URL[]): string {
  for (const url of candidates) {
    if (existsSync(url)) return readFileSync(url, 'utf8');
  }
  throw new Error(`找不到文件：${candidates.map(String).join(' / ')}`);
}

const styleUrl = (file: string): URL[] => STYLE_DIRS.map((dir) => new URL(file, dir));
const srcUrl = (file: string): URL[] => [
  new URL(`../../src/${file}`, import.meta.url),
  new URL(`../src/${file}`, import.meta.url),
];

type Rule = { selectors: string[]; body: string };

/** 顶层规则解析：样式里没有嵌套 @media 包住这些选择器，正则够用。 */
function parseRules(css: string): Rule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(withoutComments);
  while (match) {
    rules.push({
      selectors: match[1]
        .split(',')
        .map((selector) => selector.trim())
        .filter(Boolean),
      body: match[2],
    });
    match = pattern.exec(withoutComments);
  }
  return rules;
}

/** 取某个选择器规则的 z-index 数值（必须是写死的数字）。 */
function zIndexOf(css: string, selector: string): number {
  const rule = parseRules(css).find((item) => item.selectors.includes(selector) && /z-index:/.test(item.body));
  assert.ok(rule, `样式里找不到带 z-index 的 ${selector}`);
  const value = /z-index:\s*(\d+)/.exec(rule.body)?.[1];
  assert.ok(value, `${selector} 的 z-index 不是写死的数字`);
  return Number(value);
}

const transitions = readFile(...styleUrl('transitions.css'));

test('叠层阶梯：每一层都不低于它下面那层，且打印预览在基础弹窗之上', () => {
  const ladder: Array<[string, number]> = [
    ['基础弹窗遮罩', zIndexOf(transitions, '.admin-modal-overlay')],
    ['二级整屏面板（打印预览）', zIndexOf(transitions, '.schedule-preview')],
    ['时间选择器', zIndexOf(transitions, '.time-range-overlay')],
    ['下拉菜单', zIndexOf(transitions, '.inline-select__menu')],
    ['确认框', zIndexOf(transitions, '.app-dialog-overlay')],
    ['帮助提示', zIndexOf(transitions, '.help-tip__panel')],
  ];
  for (const [label, value] of ladder) {
    assert.ok(value > 0, `${label} 必须有 z-index`);
  }
  for (let index = 1; index < ladder.length; index += 1) {
    assert.ok(
      ladder[index][1] > ladder[index - 1][1],
      `${ladder[index][0]}(${ladder[index][1]}) 必须高于 ${ladder[index - 1][0]}(${ladder[index - 1][1]})`,
    );
  }
  // 这一条是本轮 bug 的回归：打印预览是「从编辑器弹窗里再打开」的整屏面板。
  assert.ok(
    zIndexOf(transitions, '.schedule-preview') > zIndexOf(transitions, '.admin-modal-overlay'),
    '打印预览必须高于弹窗遮罩，否则会整块盖在编辑器底下、点不到也关不掉',
  );
});

test('提醒层：toast / 草稿提示 / 更新提示 / 未完成提示用同一档，且高于整条阶梯', () => {
  const reminder = Number(/--z-reminder:\s*(\d+)/.exec(readFile(...styleUrl('admin-design.css')))?.[1]);
  assert.ok(reminder > 0, 'admin-design.css 必须定义 --z-reminder');
  assert.ok(reminder > zIndexOf(transitions, '.help-tip__panel'), '提醒层必须高于帮助提示，也就是高于整条弹窗阶梯');

  const users: Array<[string, string]> = [
    ['notice.css', '.notice-host'],
    ['exam-records.css', '.admin-draft-hint'],
    ['pwa-update.css', '.pwa-update-notice'],
    ['admin.css', '.admin-incomplete-prompt'],
  ];
  for (const [file, selector] of users) {
    const rule = parseRules(readFile(...styleUrl(file))).find((item) => item.selectors.includes(selector));
    assert.ok(rule, `${file} 里找不到 ${selector}`);
    assert.match(rule.body, /z-index:\s*var\(--z-reminder,\s*\d+\)/, `${selector} 要用提醒层令牌，别再写死数值`);
  }
});

test('提醒层：必须走 portal 挂到 body（挂在页面树里会被弹窗的层叠上下文压住）', () => {
  const portal = readFile(...srcUrl('components/NoticePortal.tsx'));
  assert.match(portal, /createPortal\(children, document\.body\)/, 'NoticePortal 必须 portal 到 document.body');

  const adminPage = readFile(...srcUrl('pages/AdminPage.tsx'));
  assert.match(adminPage, /<NoticePortal>[\s\S]{0,400}admin-draft-hint/, '草稿提示条要包在 NoticePortal 里');
  assert.match(adminPage, /<NoticePortal>[\s\S]{0,300}AdminIncompletePrompt/, '未完成提示要包在 NoticePortal 里');
});
