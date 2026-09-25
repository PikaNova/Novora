import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 回归背景（2026-09-26）：教室大屏公告的自动弹出被"考试进行中先压后弹"挡住，
 * 于是管理端回执长期停在「已送达未看」——设备拉到了公告（送达记账），却因为
 * 考试状态没有弹出窗口，自然也没有"看满 3 秒"的回执。
 *
 * 用户口径：**公告随时随地都要确保弹出**。考试进行中、夜间都不再是借口；
 * 唯一允许不弹的是发布时显式选的「只进列表（静默发布）」，那是管理员的选择。
 *
 * 这些行为分散在组件、契约与样式里，没有一个能单独跑出来的纯函数，所以像
 * zIndexLayers 那样把关键约束钉在源码上，避免"改一处忘一处"复发。
 */

const read = (relative: string): string => {
  const candidates = [
    new URL(`../../${relative}`, import.meta.url), // 编译后：.test-check/tests/ → 仓库根
    new URL(`../${relative}`, import.meta.url), // 直接跑源码时
  ];
  for (const url of candidates) {
    if (existsSync(url)) return readFileSync(url, 'utf8');
  }
  throw new Error(`找不到文件：${relative}`);
};

const examPage = read('src/pages/ExamPage.tsx');

test('教室端公告自动弹出：不再按考试状态压后弹', () => {
  assert.ok(
    !/deferredSchoolAnnouncementsRef|exam_board_deferred_announcement/.test(examPage),
    '考试期间"先记下来、考完再弹"的机制必须彻底移除：它正是「已送达未看」的来源',
  );
  assert.ok(!/examLiveRef/.test(examPage), '考试是否进行中不该参与公告的展示决策（紧急公告更应该立刻弹）');
  const branchStart = examPage.indexOf('const candidates = pickAutoOpenSchoolAnnouncements(list);');
  const branch = examPage.slice(branchStart, examPage.indexOf('setSchoolAnnouncementsOpen(true);', branchStart));
  assert.ok(branch.length > 0, '找不到学校公告轮询里决定弹窗的那段分支');
  assert.ok(!/raw\.phase|phase === 'live'/.test(branch), '弹窗前不能再看考试阶段，否则公告又会被压到考试结束');
  assert.match(branch, /markAnnouncementsShown/, '弹之前仍要记"已弹过"，避免每 60 秒重复弹');
});

test('学校公告窗口的层级要高于考试提醒浮层与结束提醒', () => {
  const layers = (relative: string, selector: string): number => {
    const css = read(relative).replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(rule, `${relative} 里找不到 ${selector}`);
    const value = /z-index:\s*(\d+)/.exec(rule[2])?.[1];
    assert.ok(value, `${selector} 的 z-index 必须是写死的数字`);
    return Number(value);
  };
  const school = layers('src/styles/school-announcement-overlay.css', '.sann-screen-overlay');
  const alertOverlay = layers('src/styles/exam-alert-overlay.css', '.eao');
  assert.ok(school > alertOverlay, `学校公告窗口(${school}) 必须高于考试提醒浮层(${alertOverlay})，否则"弹了看不见"`);
  assert.ok(school > 4300, `学校公告窗口(${school}) 要高于考试结束弹窗/提醒条(4300/4200)`);
});
