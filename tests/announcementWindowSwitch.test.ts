import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
// 先装浏览器常量/存储，再引组件（ESM 按 import 顺序求值）。
import './helpers/browserGlobals.js';
import type { SchoolExamAnnouncement } from '../src/services/examAnnouncements.js';
import type { Announcement } from '../src/services/announcements.js';

/**
 * 回归背景：教室端只有一个公告入口，学校公告有内容时它会打开学校公告窗口，
 * 于是作者端「系统公告」就只能靠自动弹出才看得到。现在两扇窗口互相提供切换按钮，
 * 这里锁住"能切过去 / 紧急公告期间不能切走"这两条行为。
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

// 组件链路里有 CSS 导入，必须在装好解析钩子之后再动态引入。
const { default: SchoolAnnouncementOverlay } = await import('../src/components/SchoolAnnouncementOverlay.js');
const { default: ExamAnnouncementOverlay } = await import('../src/components/ExamAnnouncementOverlay.js');

const SCHOOL_ANNOUNCEMENT: SchoolExamAnnouncement = {
  id: 'ann_school_1',
  title: '明天停课',
  body: '## 注意\n\n- 按课表离校',
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
};

const AUTHOR_ANNOUNCEMENT: Announcement = {
  id: 7,
  title: '版本更新说明',
  content: '本次更新内容',
  pinned: false,
  type: 'announcement',
  url: '',
  buttonLabel: '',
  summary: '',
  created_at: 1_790_000_000_000,
  updated_at: 1_790_000_000_000,
};

function flattenText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(flattenText).join('');
  if (value && typeof value === 'object' && 'props' in (value as { props?: unknown })) {
    return flattenText((value as { props: { children?: unknown } }).props?.children);
  }
  return '';
}

function findButton(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('button').find((node) => flattenText(node.props.children).includes(label));
}

test('学校公告窗口：头部提供「系统公告」按钮，点了能切过去', async () => {
  const switched: number[] = [];
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(SchoolAnnouncementOverlay, {
        open: true,
        announcements: [SCHOOL_ANNOUNCEMENT],
        schoolName: '测试中学',
        onSwitchToSystem: () => switched.push(1),
        onClose: () => undefined,
      }),
    );
  });
  const button = findButton(renderer, '系统公告');
  assert.ok(button, '学校公告窗口必须有切到系统公告的入口');
  assert.equal(button.props.disabled, false);
  await act(async () => {
    button.props.onClick();
  });
  assert.equal(switched.length, 1);
  await act(async () => {
    renderer.unmount();
  });
});

test('学校公告窗口：紧急公告展示期间禁止切走（避免绕开"不可关闭"）', async () => {
  const switched: number[] = [];
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(SchoolAnnouncementOverlay, {
        open: true,
        announcements: [{ ...SCHOOL_ANNOUNCEMENT, level: 'urgent' }],
        onSwitchToSystem: () => switched.push(1),
        switchLocked: true,
        onClose: () => undefined,
      }),
    );
  });
  const button = findButton(renderer, '系统公告');
  assert.ok(button);
  assert.equal(button.props.disabled, true);
  assert.match(String(button.props.title), /紧急公告/);
  await act(async () => {
    renderer.unmount();
  });
});

test('学校公告窗口：切到「历史」分页会请求历史公告并渲染状态', async () => {
  let requested = 0;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(SchoolAnnouncementOverlay, {
        open: true,
        announcements: [SCHOOL_ANNOUNCEMENT],
        history: [
          {
            ...SCHOOL_ANNOUNCEMENT,
            id: 'ann_school_old',
            title: '上周的通知',
            status: 'expired',
            seenAt: 1_790_100_000_000,
          },
        ],
        onRequestHistory: () => {
          requested += 1;
        },
        onClose: () => undefined,
      }),
    );
  });
  const historyTab = findButton(renderer, '历史');
  assert.ok(historyTab, '窗口里要有「历史」分页');
  await act(async () => {
    historyTab.props.onClick();
  });
  assert.equal(requested, 1, '切到历史分页要按需拉取');
  assert.ok(findButton(renderer, '当前'), '还能切回当前分页');
  const text = JSON.stringify(renderer.toJSON());
  assert.match(text, /上周的通知/);
  assert.match(text, /已过期/);
  assert.match(text, /已读/);
  await act(async () => {
    renderer.unmount();
  });
});

test('作者端窗口：本机有学校公告时才给「学校公告」切换入口', async () => {
  const switched: number[] = [];
  let withSwitch!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    withSwitch = TestRenderer.create(
      React.createElement(ExamAnnouncementOverlay, {
        open: true,
        announcements: [AUTHOR_ANNOUNCEMENT],
        loading: false,
        onSwitchToSchool: () => switched.push(1),
        onClose: () => undefined,
      }),
    );
  });
  const button = findButton(withSwitch, '学校公告');
  assert.ok(button, '系统公告窗口要能切回学校公告');
  await act(async () => {
    button.props.onClick();
  });
  assert.equal(switched.length, 1);
  await act(async () => {
    withSwitch.unmount();
  });

  let withoutSwitch!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    withoutSwitch = TestRenderer.create(
      React.createElement(ExamAnnouncementOverlay, {
        open: true,
        announcements: [AUTHOR_ANNOUNCEMENT],
        loading: false,
        onClose: () => undefined,
      }),
    );
  });
  assert.equal(findButton(withoutSwitch, '学校公告'), undefined, '没有学校公告时不显示切换');
  await act(async () => {
    withoutSwitch.unmount();
  });
});
