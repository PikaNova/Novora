import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
// 先装浏览器常量/存储，再引组件（ESM 按 import 顺序求值）。
import './helpers/browserGlobals.js';
import { installMinimalWindow, installTestModuleHooks } from './helpers/moduleHooks.js';

/**
 * 回归背景（线上表现）：在「角色权限」里保存失败时，错误只写进面板横幅，
 * 而横幅被弹窗遮罩（z-index 9999）盖着 —— 用户看到"点了保存没反应、库里没变、没有任何提示"。
 * 现在：错误进弹窗自己的错误位，并补一条 toast。
 */

installTestModuleHooks();
// notify() 走 window.dispatchEvent；Node 里给它一个最小事件目标，测试才能观察 toast。
installMinimalWindow();

const ORIGINAL_FETCH = globalThis.fetch;

const ROLE = {
  id: 'role_custom',
  name: '自建角色',
  description: '',
  permissions: ['overview.read'],
  builtIn: false,
  createdAt: 0,
  updatedAt: 0,
};

const ADMIN_USER = {
  id: 1,
  username: 'admin',
  displayName: '超级管理员',
  roleId: 'super_admin',
  roleName: '超级管理员',
  permissions: ['*'],
  scopes: [{ type: 'all' as const, gradeId: '', classId: '' }],
  mustChangePassword: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const textOf = (node: TestRenderer.ReactTestInstance) =>
  node.children
    .filter((child): child is string => typeof child === 'string')
    .join('')
    .trim();

type Rendered = {
  renderer: TestRenderer.ReactTestRenderer;
  root: TestRenderer.ReactTestInstance;
  clickButton: (label: string) => void;
};

async function renderPanel(): Promise<Rendered> {
  const { default: UserManagementPanel } = await import('../src/components/UserManagementPanel.js');
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(UserManagementPanel, { grades: [], classes: [], currentUser: ADMIN_USER }),
      ),
    );
  });
  // 首次加载（GET /api/users）落地
  await act(async () => {});
  const root = renderer!.root;
  return {
    renderer: renderer!,
    root,
    clickButton: (label: string) => {
      const target = root.findAll((node) => node.type === 'button' && textOf(node) === label)[0];
      assert.ok(target, `找不到按钮：${label}`);
      act(() => target.props.onClick());
    },
  };
}

test('角色向导保存失败：错误显示在弹窗里，并补一条 toast', async () => {
  let postCalled = 0;
  const notices: Array<{ tone: string; message: string }> = [];
  const onNotice = (event: Event) => {
    const detail = (event as CustomEvent).detail as { tone: string; message: string };
    notices.push({ tone: detail.tone, message: detail.message });
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'POST') {
      postCalled += 1;
      return jsonResponse({ ok: false, field: '_form', error: '不能创建权限高于当前账号的角色' }, 403);
    }
    return jsonResponse({ ok: true, users: [], roles: [ROLE], permissions: ['overview.read', 'major.read'] });
  }) as typeof fetch;
  window.addEventListener('exam-board:notice', onNotice);

  try {
    const { renderer, root, clickButton } = await renderPanel();
    const { RoleWizardModal } = await import('../src/components/user-management/RoleWizardModal.js');

    clickButton('角色权限');
    clickButton('新建角色');
    const wizard = root.findByType(RoleWizardModal);
    act(() => {
      wizard.props.setRoleDraft((value: { name: string; description: string; permissions: string[] }) => ({
        ...value,
        name: '临时角色',
        permissions: ['overview.read'],
      }));
    });
    await act(async () => {
      await wizard.props.submitRole();
    });

    assert.equal(postCalled, 1, '应当真的发过一次保存请求');
    const after = root.findByType(RoleWizardModal);
    assert.equal(after.props.roleError, '不能创建权限高于当前账号的角色');
    const rendered = JSON.stringify(renderer.toJSON());
    assert.match(rendered, /不能创建权限高于当前账号的角色/, '弹窗里必须能看到失败原因');
    assert.doesNotMatch(rendered, /角色权限已保存/, '失败时不能出现"已保存"');
    assert.ok(
      notices.some((item) => item.tone === 'error' && item.message.includes('不能创建权限高于当前账号的角色')),
      '失败时应当同时发一条错误 toast（弹窗遮挡时的兜底）',
    );
  } finally {
    window.removeEventListener('exam-board:notice', onNotice);
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('角色保存成功且权限有变：提示该角色的账号需要重新登录', async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'POST') {
      return jsonResponse({
        ok: true,
        roles: [{ ...ROLE, permissions: ['overview.read', 'major.read'] }],
        sessionsInvalidated: 2,
      });
    }
    return jsonResponse({ ok: true, users: [], roles: [ROLE], permissions: ['overview.read', 'major.read'] });
  }) as typeof fetch;

  try {
    const { renderer, root, clickButton } = await renderPanel();
    const { RoleWizardModal } = await import('../src/components/user-management/RoleWizardModal.js');

    clickButton('角色权限');
    clickButton('新建角色');
    const wizard = root.findByType(RoleWizardModal);
    act(() => {
      wizard.props.setRoleDraft((value: { name: string; description: string; permissions: string[] }) => ({
        ...value,
        name: '第二角色',
        permissions: ['overview.read', 'major.read'],
      }));
    });
    await act(async () => {
      await wizard.props.submitRole();
    });

    const rendered = JSON.stringify(renderer.toJSON());
    assert.match(rendered, /2 个账号需要重新登录/, '权限变了要说明会话已失效');
    assert.equal(root.findAllByType(RoleWizardModal).length, 0, '保存成功后弹窗应当关闭');
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});
