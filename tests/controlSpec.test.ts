import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 控件规格锁（P2）。
 *
 * 背景：统一控件的尺寸档与配色靠「几何量 + 人工看一眼」验证，改动 CSS 时没有任何东西拦着，
 * 而这类改动（行高被压、危险色被换成普通色、弹窗输入框丢边框）只有用户在真实页面上才会发现。
 * 这里把规格钉在测试里：改规格必须同时改这条测试，等于强制过一次显式确认。
 *
 * 只断言「声明了什么」，不计算 computed style——Node 里没有 CSS 引擎，真正生效与否仍以
 * 真机/无头浏览器验收为准。
 */

type Rule = { selectors: string[]; body: string };

function readControlsCss(): string {
  const candidates = [
    // 编译后：.test-check/tests/x.test.js → 仓库根/src/styles
    new URL('../../src/styles/controls.css', import.meta.url),
    // 直接跑源码时：tests/x.test.ts → 仓库根/src/styles
    new URL('../src/styles/controls.css', import.meta.url),
  ];
  for (const url of candidates) {
    if (existsSync(url)) return readFileSync(url, 'utf8');
  }
  throw new Error('找不到 src/styles/controls.css');
}

/** 顶层规则解析：本文件不含 @media 嵌套，正则足够。 */
function parseRules(css: string): Rule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(withoutComments);
  while (match) {
    const selectors = match[1]
      .split(',')
      .map((selector) => selector.trim())
      .filter(Boolean);
    rules.push({ selectors, body: match[2] });
    match = pattern.exec(withoutComments);
  }
  return rules;
}

const rules = parseRules(readControlsCss());

/** 断言「存在一条含该选择器的规则，且它的声明满足全部模式」。 */
function assertDeclared(selector: string, patterns: RegExp[], why: string): void {
  const matched = rules
    .filter((rule) => rule.selectors.includes(selector))
    .some((rule) => patterns.every((pattern) => pattern.test(rule.body)));
  assert.ok(matched, `${why}（${selector} 应满足 ${patterns.map(String).join(' / ')}）`);
}

test('控件规格：四个尺寸档的间距与字号被钉住', () => {
  assertDeclared('.admin-item-btn', [/padding:\s*4px 10px;/, /font-size:\s*0\.75rem;/], '列表行内（小）档');
  assertDeclared('.admin-btn', [/padding:\s*5px 12px;/, /font-size:\s*0\.8rem;/], '页面动作（中）档');
  assertDeclared(
    '.set-btn',
    [/padding:\s*8px 14px;/, /border-radius:\s*8px;/, /font-size:\s*0\.8125rem;/],
    '系统设置（大）档',
  );
  assertDeclared('.admin-btn--sm', [/padding:\s*3px 9px;/, /font-size:\s*0\.72rem;/], '更小一档（贴列表行）');
});

test('控件规格：主要 / 幽灵 / 危险三种配色被钉住', () => {
  assertDeclared(
    '.admin-btn--primary',
    [/border-color:\s*#3498db;/, /background:\s*#3498db;/, /color:\s*#fff;/],
    '主要动作',
  );
  assertDeclared('.admin-btn--primary:hover', [/background:\s*#2980b9;/], '主要动作悬停');
  assertDeclared(
    '.admin-btn--ghost',
    [/background:\s*transparent;/, /border-color:\s*rgba\(255, 255, 255, 0\.2\);/],
    '次要（幽灵）动作',
  );
  assertDeclared(
    '.admin-btn--danger',
    [/color:\s*#ff8a7d;/, /border-color:\s*rgba\(231, 76, 60, 0\.32\);/],
    '危险动作',
  );
});

test('控件规格：表单控件令牌挂在 :root 上（弹窗 portal 到 body 也要能解析）', () => {
  // 曾经把令牌挂在 .admin-page 上，弹窗里的输入框 border 整条作废、看起来没边框。
  assertDeclared(':root', [/--adm-ctl-h:\s*36px;/, /--adm-ctl-radius:\s*6px;/], '表单控件尺寸令牌');
  assertDeclared(
    ':root',
    [/--adm-ctl-line:\s*rgba\(255, 255, 255, 0\.14\);/, /--adm-ctl-text:\s*#edf3f7;/],
    '表单控件配色令牌',
  );
});

test('控件规格：sr-only 有真实实现（搜索框的读屏文本不能再被显示出来）', () => {
  assertDeclared(
    '.sr-only',
    [/position:\s*absolute;/, /width:\s*1px;/, /height:\s*1px;/, /clip-path:\s*inset\(50%\);/],
    '只给读屏看的文本',
  );
});
