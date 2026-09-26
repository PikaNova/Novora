import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
// 先装浏览器常量/存储，再引组件（ESM 按 import 顺序求值）。
import './helpers/browserGlobals.js';

const { default: MajorEditorModal } = await import('../src/components/major/MajorEditorModal.js');
const { setAppDialogOpenCount } = await import('../src/services/appDialog.js');

/**
 * 编辑器弹窗壳的回归：
 * - 关掉它要能回到原处（onClose 只调一次，不重复触发）；
 * - Esc 与点遮罩都能关；
 * - 但它内部还开着子弹窗、或页面上有确认框时，Esc **不能**把这一层也关掉（只关最上面那层）。
 *
 * Node 里没有 document，这里只补一个够用的假 document 来收 keydown 监听；
 * AdminModalPortal 在没有 document 时退化成普通 div，所以渲染本身不需要 DOM。
 */
type KeydownHandler = (event: { key: string }) => void;
const keydownHandlers = new Set<KeydownHandler>();

// react-dom 的 createPortal 只校验容器「像不像元素」（nodeType/nodeName），不看它是不是真 DOM。
const fakeBody = {
  nodeType: 1,
  nodeName: 'BODY',
  namespaceURI: 'http://www.w3.org/1999/xhtml',
  // react-test-renderer 把 portal 容器当成自己的 host 容器用：它要一个 children 数组来挂子节点。
  children: [] as unknown[],
  childNodes: [] as unknown[],
};

(globalThis as Record<string, unknown>).document = {
  body: fakeBody,
  documentElement: fakeBody,
  addEventListener: (type: string, handler: KeydownHandler) => {
    if (type === 'keydown') keydownHandlers.add(handler);
  },
  removeEventListener: (type: string, handler: KeydownHandler) => {
    if (type === 'keydown') keydownHandlers.delete(handler);
  },
};

function pressEscape(): void {
  for (const handler of [...keydownHandlers]) handler({ key: 'Escape' });
}

function mountModal(options: { nestedModalOpen?: boolean } = {}) {
  const closeCalls: number[] = [];
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(MajorEditorModal, {
        title: '编辑考试 · 444',
        hint: '改完直接关闭即可',
        nestedModalOpen: options.nestedModalOpen === true,
        onClose: () => closeCalls.push(Date.now()),
        children: React.createElement('span', { className: 'panel-stub' }, '分考试面板'),
      }),
    );
  });
  return {
    renderer: renderer as TestRenderer.ReactTestRenderer,
    closeCount: () => closeCalls.length,
  };
}

function unmount(renderer: TestRenderer.ReactTestRenderer): void {
  act(() => {
    renderer.unmount();
  });
}

/** portal 的子树不在 toJSON 里（容器是假的），所以按 fiber 树把所有文本节点收集起来断言。 */
function collectText(renderer: TestRenderer.ReactTestRenderer): string {
  const parts: string[] = [];
  for (const node of renderer.root.findAll((instance) => typeof instance.type === 'string')) {
    for (const child of node.children) {
      if (typeof child === 'string') parts.push(child);
    }
  }
  return parts.join('|');
}

test('编辑器弹窗：渲染标题与面板，点关闭按钮回调一次', () => {
  const { renderer, closeCount } = mountModal();
  try {
    const text = collectText(renderer);
    assert.ok(text.includes('编辑考试 · 444'), '标题要显示当前考试名');
    assert.ok(text.includes('分考试面板'), '面板本体要渲染进弹窗');
    assert.ok(text.includes('改完直接关闭即可'), '说明文案要显示');

    const closeButton = renderer.root.findAllByType('button')[0];
    assert.equal(closeButton.props['aria-label'], '关闭编辑器');
    act(() => {
      closeButton.props.onClick();
    });
    assert.equal(closeCount(), 1);
  } finally {
    unmount(renderer);
  }
});

test('编辑器弹窗：Esc 关闭，卸载后不再监听', () => {
  const { renderer, closeCount } = mountModal();
  try {
    pressEscape();
    assert.equal(closeCount(), 1);
  } finally {
    unmount(renderer);
  }
  pressEscape();
  assert.equal(closeCount(), 1, '卸载后不该再响应 Esc');
});

test('编辑器弹窗：内部子弹窗开着时 Esc 只关最上面那层', () => {
  const { renderer, closeCount } = mountModal({ nestedModalOpen: true });
  try {
    pressEscape();
    assert.equal(closeCount(), 0, '子弹窗开着时不能顺手关掉编辑器');
  } finally {
    unmount(renderer);
  }
});

test('编辑器弹窗：确认框开着时 Esc 只关确认框', () => {
  const { renderer, closeCount } = mountModal();
  try {
    setAppDialogOpenCount(1);
    pressEscape();
    assert.equal(closeCount(), 0, '确认框开着时不能同时关掉编辑器');

    setAppDialogOpenCount(0);
    pressEscape();
    assert.equal(closeCount(), 1, '确认框关掉后 Esc 恢复关闭编辑器');
  } finally {
    setAppDialogOpenCount(0);
    unmount(renderer);
  }
});

test('编辑器弹窗：点遮罩关闭，点弹窗内部不关闭', () => {
  const { renderer, closeCount } = mountModal();
  try {
    const overlay = renderer.root.findAll((instance) =>
      String(instance.props.className ?? '').includes('admin-modal-overlay'),
    )[0];
    assert.ok(overlay, '要找到遮罩层');
    const inside = { target: 'inside', currentTarget: 'overlay' };
    const backdrop = { target: 'overlay', currentTarget: 'overlay' };

    act(() => {
      overlay.props.onPointerDown(inside);
      overlay.props.onClick(inside);
    });
    assert.equal(closeCount(), 0, '点在弹窗内部不应该关');

    act(() => {
      overlay.props.onPointerDown(backdrop);
      overlay.props.onClick(backdrop);
    });
    assert.equal(closeCount(), 1, '点遮罩应该关');
  } finally {
    unmount(renderer);
  }
});
