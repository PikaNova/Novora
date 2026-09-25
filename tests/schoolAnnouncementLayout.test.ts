import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
// 先装浏览器常量/存储，再引组件（ESM 按 import 顺序求值）。
import './helpers/browserGlobals.js';
import type { SchoolExamAnnouncement } from '../src/services/examAnnouncements.js';

/**
 * 回归背景（2026-09-25 重写）：
 * - 卡片以前是单列纵向堆叠，历史一多就要滚很久 → 现在走自适应网格（2–3 列），
 *   海报/紧急公告占满整行，历史用紧凑卡；
 * - 头部那句「N 条公告 · 由学校管理端发布」在长列表下会被挤压/裁掉 → 条数移到分页上，
 *   来源说明移到窗口固定条（不随卡片滚动、不参与收缩）。
 *
 * 这里锁住的是**结构**（固定条 vs 滚动区、网格容器、紧凑类、整行规则依赖的类名），
 * 具体像素布局仍由 CSS 负责。
 */

let cssHookInstalled = false;
function installCssHook(): void {
  if (cssHookInstalled) return;
  cssHookInstalled = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.endsWith('.css')) return { url: 'data:text/javascript,export default {}', shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
}
installCssHook();

const { default: SchoolAnnouncementOverlay } = await import('../src/components/SchoolAnnouncementOverlay.js');

function announcement(overrides: Partial<SchoolExamAnnouncement> = {}): SchoolExamAnnouncement {
  return {
    id: 'ann_1',
    title: '明天停课',
    body: '按课表离校',
    level: 'normal',
    style: 'card',
    silent: false,
    remindAt: null,
    remindScope: 'unseen',
    seenAt: null,
    examId: null,
    scopeType: 'class',
    scopeIds: ['c1'],
    createdBy: 1,
    createdAt: 1_790_000_000_000,
    expiresAt: null,
    status: 'active',
    ...overrides,
  };
}

async function render(element: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

/** 把一棵子树里的文字抠出来（ReactTestInstance 没有 toJSON，逐节点拼 children 即可）。 */
function textOf(node: TestRenderer.ReactTestInstance): string {
  return node
    .findAll(() => true)
    .map((child) => child.props.children)
    .flatMap((children) => (Array.isArray(children) ? children : [children]))
    .filter((child): child is string | number => typeof child === 'string' || typeof child === 'number')
    .join('');
}

/** 某个节点是否带指定 class（卡片类名是拼出来的，例如 `sann-view is-card is-urgent`）。 */
function hasClass(node: TestRenderer.ReactTestInstance, className: string): boolean {
  return String(node.props.className ?? '')
    .split(/\s+/)
    .includes(className);
}

test('分页与来源说明在窗口固定条上，不在滚动区里；条数写在分页上', async () => {
  const renderer = await render(
    React.createElement(SchoolAnnouncementOverlay, {
      open: true,
      announcements: [announcement({ id: 'ann_now' })],
      history: [announcement({ id: 'ann_old', status: 'expired', title: '上周的通知' })],
      onClose: () => undefined,
    }),
  );

  const toolbar = renderer.root.findByProps({ className: 'sann-screen-window__toolbar' });
  const body = renderer.root.findByProps({ className: 'sann-screen-window__body' });
  assert.equal(toolbar.findAllByProps({ className: 'sann-screen-tabs' }).length, 1, '分页要在固定条里');
  assert.equal(body.findAllByProps({ className: 'sann-screen-tabs' }).length, 0, '分页不该在滚动区里');
  assert.match(textOf(toolbar), /由学校管理端发布/, '来源说明要在固定条里，长列表下不会被挤掉');

  // 条数不再写进头部说明，而是挂在分页上。
  assert.ok(toolbar.findAll((node) => typeof node.type === 'string' && node.type === 'button').length >= 2);
  assert.match(textOf(toolbar), /当前（1）/);
  assert.match(textOf(toolbar), /历史（1）/);
});

test('当前公告走网格，海报/紧急公告带整行规则依赖的类名', async () => {
  const renderer = await render(
    React.createElement(SchoolAnnouncementOverlay, {
      open: true,
      announcements: [
        announcement({ id: 'ann_card' }),
        announcement({ id: 'ann_poster', style: 'poster' }),
        announcement({ id: 'ann_urgent', level: 'urgent' }),
      ],
      onClose: () => undefined,
    }),
  );

  const grid = renderer.root.findByProps({ className: 'sann-screen-grid' });
  assert.equal(grid.findAllByProps({ className: 'sann-screen-window__item' }).length, 3);
  assert.equal(
    grid.findAll((node) => hasClass(node, 'sann-view') && hasClass(node, 'is-poster')).length,
    1,
    '海报卡要在网格里，CSS 用 :has(> .sann-view.is-poster) 让它占满整行',
  );
  assert.equal(grid.findAll((node) => hasClass(node, 'sann-view') && hasClass(node, 'is-urgent')).length, 1);
});

test('历史公告用紧凑卡（同网格里一屏放更多条）', async () => {
  const renderer = await render(
    React.createElement(SchoolAnnouncementOverlay, {
      open: true,
      announcements: [],
      history: [announcement({ id: 'ann_h1', status: 'expired' }), announcement({ id: 'ann_h2', status: 'revoked' })],
      onRequestHistory: () => undefined,
      onClose: () => undefined,
    }),
  );

  const historyTab = renderer.root
    .findAllByType('button')
    .find((node) => JSON.stringify(node.props.children ?? '').includes('历史'));
  assert.ok(historyTab);
  await act(async () => {
    historyTab.props.onClick();
  });

  const compact = renderer.root.findAll(
    (node) => hasClass(node, 'sann-screen-window__item') && hasClass(node, 'is-compact'),
  );
  assert.equal(compact.length, 2, '历史卡片都要带紧凑类');
});

test('空态不占网格：没有公告时只有一条提示', async () => {
  const renderer = await render(
    React.createElement(SchoolAnnouncementOverlay, { open: true, announcements: [], onClose: () => undefined }),
  );
  assert.equal(renderer.root.findAllByProps({ className: 'sann-screen-grid' }).length, 0);
  assert.equal(renderer.root.findAllByProps({ className: 'sann-screen-empty' }).length, 1);
});
