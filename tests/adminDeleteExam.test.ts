import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 「删除大型考试」这条链路的回归。
 *
 * 线上现象（年级管理员）：点了删除，界面看着没反应、也没有任何提示；服务端那边考试一直在
 * （HAR 里连续 9 次保存都带着被删的那一场，只有第 10 次才变成 7 场）。
 * 排查结论：
 *   1. 不是权限问题——账号带 `major.delete`、范围匹配，整份 HAR 里没有任何 403；
 *   2. 客户端推送时优先用了「待同步队列里的旧 payload」，把删除动作吞掉了（本轮修复）；
 *   3. 删除成功与否界面都没有提示（本轮补上，与「删除草稿」同一口径：等服务端确认再报）。
 */

const SRC_DIRS = [
  new URL('../../src/', import.meta.url), // 编译后：.test-check/tests/ → 仓库根
  new URL('../src/', import.meta.url), // 直接跑源码时
];

function readSource(relative: string): string {
  for (const dir of SRC_DIRS) {
    const url = new URL(relative, dir);
    if (existsSync(url)) return readFileSync(url, 'utf8');
  }
  throw new Error(`找不到 src/${relative}`);
}

/** 取一个箭头函数体的原文（从 `const name = ... ) => {` 到同缩进的 `};`）。 */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `找不到 ${name}`);
  const open = source.indexOf('{', start);
  const end = source.indexOf('\n  };', open);
  assert.ok(open >= 0 && end > open, `${name} 的函数体不完整`);
  return source.slice(open, end);
}

/** 去掉注释再断言：修复说明里会引用「以前的写法」，不能拿注释里的字符串当代码证据。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('推送快照必须用现场构造的 payload，不能被待同步队列里的旧快照盖掉', () => {
  for (const file of ['hooks/admin/useMajorScheduleActions.ts', 'hooks/admin/useWeeklyScheduleSync.ts']) {
    const source = stripComments(readSource(file));
    assert.ok(
      !source.includes('queued?.payload ??'),
      `${file} 又出现 queued?.payload ??：队列里的旧快照会吞掉之后的删除/改动`,
    );
  }
  assert.match(
    stripComments(readSource('hooks/admin/useMajorScheduleActions.ts')),
    /const payload = buildPayload\(ms, activeId\);/,
    '考试快照推送要用调用方现场构造的 payload',
  );
});

test('删除大型考试：等服务端确认后再给成功提示，不确认不报成功', () => {
  const source = readSource('hooks/admin/useMajorScheduleActions.ts');
  const body = functionBody(source, 'removeMajor');
  assert.match(body, /if \(pushed\) await pushed;/, '要等这次推送真的回来');
  assert.match(body, /getAppSettings\(\)\.exam\.majors\.some/, '被服务端冻结回灌时不能再报成功');
  assert.match(body, /notify\(\s*stillPending \? 'warning' : 'success'/, '成功/待同步都要有提示');
});

test('删除临时统一考试：同样等服务端确认并提示', () => {
  const body = functionBody(readSource('hooks/admin/useMajorScheduleActions.ts'), 'removeQuickMajor');
  assert.match(body, /if \(pushed\) await pushed;/);
  assert.match(body, /notify\(/);
});
