import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React from 'react';
import TestRenderer from 'react-test-renderer';
// 先装浏览器常量/存储，再引组件（ESM 按 import 顺序求值）。
import './helpers/browserGlobals.js';

/**
 * 回归背景：左栏「考试中心」下面挂的三个子项（当前考试 / 考试安排 / 历史考试）。
 * 上层传下来的 examView 在非考试板块会回落到默认视图「当前考试」，导航直接用它渲染选中态，
 * 于是**在任何板块下第一个子项都亮着**（dev 站实测：/admin/overview、/admin/devices、
 * /admin/classes 上「当前考试」都带 is-active 与蓝色底）。
 */

const CSS_HOOK_INSTALLED = Symbol.for('novora.test.cssHook');
function installCssHook(): void {
  const globals = globalThis as unknown as Record<symbol, boolean>;
  if (globals[CSS_HOOK_INSTALLED]) return;
  globals[CSS_HOOK_INSTALLED] = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.endsWith('.css')) {
        return { url: 'data:text/javascript,export default {}', shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
}

type TabBarProps = {
  adminTab: 'overview' | 'exam' | 'devices';
  examView?: 'current' | 'schedule' | 'history';
};

async function renderTabBar(props: TabBarProps): Promise<{
  subLabels: string[];
  activeSubLabels: string[];
  activeSubAria: (string | undefined)[];
  activeTopLabels: string[];
}> {
  installCssHook();
  const { AdminTabBar } = await import('../src/components/admin/AdminTabBar.js');
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      React.createElement(AdminTabBar, {
        adminTab: props.adminTab,
        // 全权限：导航项的可见性不参与这次断言，只关心选中态。
        can: () => true,
        selectAdminTab: () => {},
        examView: props.examView,
        onSelectExamView: () => {},
      }),
    );
  });
  const root = renderer!.root;
  const subItems = root.findAll(
    (node) => typeof node.type === 'string' && String(node.props.className ?? '').includes('admin-subnav__item'),
  );
  const topItems = root.findAll(
    (node) => typeof node.type === 'string' && /\badmin-tab\b/.test(String(node.props.className ?? '')),
  );
  const labelOf = (node: TestRenderer.ReactTestInstance) =>
    node.children.filter((child) => typeof child === 'string').join('');
  const isActive = (node: TestRenderer.ReactTestInstance) => String(node.props.className ?? '').includes('is-active');
  // 先把要断言的数据取出来再 unmount：卸载之后 fiber 实例读不到 props 了。
  const result = {
    subLabels: subItems.map(labelOf),
    activeSubLabels: subItems.filter(isActive).map(labelOf),
    activeSubAria: subItems.filter(isActive).map((node) => node.props['aria-current']),
    activeTopLabels: topItems.filter(isActive).map(labelOf),
  };
  TestRenderer.act(() => renderer!.unmount());
  return result;
}

test('考试中心子项：非考试板块下没有任何子项高亮', async () => {
  // 上层在非考试板块会传回落视图（当前考试），导航必须忽略它。
  const devices = await renderTabBar({ adminTab: 'devices', examView: 'current' });
  assert.deepEqual(devices.subLabels, ['当前考试', '考试安排', '历史考试'], '子项仍然展示，方便直接跳转');
  assert.deepEqual(devices.activeSubLabels, [], '别的板块下一个子项都不该亮');
  assert.deepEqual(devices.activeTopLabels, ['设备管理']);

  const overview = await renderTabBar({ adminTab: 'overview', examView: 'current' });
  assert.deepEqual(overview.activeSubLabels, []);
});

test('考试中心子项：在考试板块内只有对应的那一个高亮', async () => {
  const current = await renderTabBar({ adminTab: 'exam', examView: 'current' });
  assert.deepEqual(current.activeSubLabels, ['当前考试']);
  assert.deepEqual(current.activeSubAria, ['page']);
  assert.deepEqual(current.activeTopLabels, ['考试中心']);

  const history = await renderTabBar({ adminTab: 'exam', examView: 'history' });
  assert.deepEqual(history.activeSubLabels, ['历史考试']);
});

test('考试中心子项：板块内没给视图时（weekly / editor）不高亮任何一个', async () => {
  const weekly = await renderTabBar({ adminTab: 'exam' });
  assert.deepEqual(weekly.activeSubLabels, []);
  assert.deepEqual(weekly.activeTopLabels, ['考试中心']);
});
