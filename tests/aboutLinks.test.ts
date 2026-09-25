import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 「关于」卡片的链接回归。
 *
 * 出过的事：链接文字写着 `PikaNova/Novora`，href 却指向文档站
 * （`https://docs.pikachu2026.space/guide/12-maintenance`）——点开是维护文档，不是仓库。
 * 另外公开仓库是 `Novora`，不是内部开发仓库 `Novora-future`，两者别写混。
 */

const candidates = [
  new URL('../../src/components/settings/AboutSection.tsx', import.meta.url), // 编译后
  new URL('../src/components/settings/AboutSection.tsx', import.meta.url), // 直接跑源码
];

test('关于卡片：GitHub 链接指向公开仓库 Novora', () => {
  const path = candidates.find((url) => existsSync(url));
  assert.ok(path, '找不到 AboutSection.tsx');
  const source = readFileSync(path, 'utf8');

  assert.match(source, /REPOSITORY_URL\s*=\s*'https:\/\/github\.com\/PikaNova\/Novora'/, '仓库地址要是公开仓库');
  // 只看赋值本身：注释里为了说明「别这么写」会提到错误地址，不能误判。
  assert.doesNotMatch(source, /REPOSITORY_URL\s*=\s*'[^']*docs\./, 'GitHub 链接不能指向文档站');
  assert.doesNotMatch(source, /REPOSITORY_URL\s*=\s*'[^']*Novora-future/, '公开链接不要写成内部开发仓库');
});
