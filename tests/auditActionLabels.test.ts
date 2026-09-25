import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  AUDIT_ACTION_LABEL,
  auditActionLabel,
  auditResourceLabel,
  auditResourceText,
  UNKNOWN_AUDIT_ACTION_LABEL,
} from '../src/constants/auditActions.js';

/**
 * 学校管理员会直接在界面上读操作日志，所以服务端写进去的每个 action 都必须在
 * src/constants/auditActions.ts 里有中文名。这里扫 api/** 的 writeAudit 字面量兜底。
 */

function walkTypeScriptFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walkTypeScriptFiles(entryPath, found);
    else if (entry.isFile() && entry.name.endsWith('.ts')) found.push(entryPath);
  }
  return found;
}

/** 从 openParenIndex 指向的 '(' 开始，按顶层逗号切开实参；括号/引号都当成普通字符处理。 */
function readCallArguments(source: string, openParenIndex: number): string[] | null {
  const args: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;
  for (let index = openParenIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      current += char;
      if (char === '\\') {
        current += source[index + 1] ?? '';
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ')') {
      if (depth === 0) {
        args.push(current.trim());
        return args;
      }
      depth -= 1;
      current += char;
      continue;
    }
    if (char === ']' || char === '}') {
      depth -= 1;
      current += char;
      continue;
    }
    if (char === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  return null;
}

/** 取第二个实参的字符串字面量内容；不是字面量（变量拼接）时返回 null。 */
function readActionLiteral(source: string, openParenIndex: number): string | null {
  const args = readCallArguments(source, openParenIndex);
  const raw = args?.[1];
  if (!raw) return null;
  const match = /^(['"`])([\s\S]*)\1$/.exec(raw);
  return match ? match[2] : null;
}

function collectAuditActionLiterals(): string[] {
  const literals: string[] = [];
  for (const file of walkTypeScriptFiles(path.join(process.cwd(), 'api'))) {
    const source = readFileSync(file, 'utf8');
    const needle = 'writeAudit(';
    let index = source.indexOf(needle);
    while (index >= 0) {
      // 跳过 `export async function writeAudit(` 这个定义本身。
      const prefix = source.slice(Math.max(0, index - 24), index);
      if (!/function\s+$/.test(prefix)) {
        const literal = readActionLiteral(source, index + needle.length - 1);
        if (literal) literals.push(literal);
      }
      index = source.indexOf(needle, index + needle.length);
    }
  }
  return literals;
}

/**
 * 模板串动作（服务端用后缀拼出来的）在这里展开成具体动作码。
 * 新增后缀时同步这张表，否则下面的「模板必须被覆盖」断言会失败。
 */
const TEMPLATE_EXPANSIONS: Record<string, string[]> = {
  'device.command.${commandAction}': ['pause', 'resume', 'extend', 'end'].map((action) => `device.command.${action}`),
  'exam.record.${action}': [
    'publish',
    'pause',
    'resume',
    'extend',
    'end',
    'request_stop',
    'force_end',
    'archive',
    'unarchive',
    'copy',
  ].map((action) => `exam.record.${action}`),
};

const allLiterals = collectAuditActionLiterals();
const staticActions = allLiterals.filter((literal) => !literal.includes('${'));
const templateLiterals = allLiterals.filter((literal) => literal.includes('${'));

test('扫描确实覆盖到了服务端的审计动作', () => {
  assert.ok(staticActions.length >= 25, `只扫到 ${staticActions.length} 个固定动作，扫描逻辑可能失效`);
  assert.ok(templateLiterals.length >= 2, `只扫到 ${templateLiterals.length} 个模板动作，扫描逻辑可能失效`);
});

test('每个固定审计动作都有中文名', () => {
  const missing = [...new Set(staticActions)].filter((action) => {
    const label = auditActionLabel(action);
    return label === UNKNOWN_AUDIT_ACTION_LABEL || !/[\u4e00-\u9fff]/.test(label);
  });
  assert.deepEqual(missing, []);
});

test('模板动作都被展开表覆盖，且展开后的动作码有中文名', () => {
  const uncovered = [...new Set(templateLiterals)].filter((literal) => !(literal in TEMPLATE_EXPANSIONS));
  assert.deepEqual(uncovered, []);
  const missing = Object.values(TEMPLATE_EXPANSIONS)
    .flat()
    .filter((action) => {
      const label = auditActionLabel(action);
      return label === UNKNOWN_AUDIT_ACTION_LABEL || !/[\u4e00-\u9fff]/.test(label);
    });
  assert.deepEqual(missing, []);
});

test('中文名永远不会退回原始英文码', () => {
  for (const action of [...new Set(allLiterals)]) {
    if (action.includes('${')) continue;
    assert.notEqual(auditActionLabel(action), action, `${action} 直接显示了原始码`);
  }
  assert.equal(auditActionLabel('some.unknown.action'), UNKNOWN_AUDIT_ACTION_LABEL);
  assert.equal(auditActionLabel(''), UNKNOWN_AUDIT_ACTION_LABEL);
  assert.equal(auditActionLabel(undefined), UNKNOWN_AUDIT_ACTION_LABEL);
});

test('动作中文名没有重复到同一个词条上', () => {
  const seen = new Map<string, string>();
  for (const [action, label] of Object.entries(AUDIT_ACTION_LABEL)) {
    assert.ok(label.trim().length > 0, `${action} 的中文名为空`);
    const previous = seen.get(label);
    assert.equal(previous, undefined, `${action} 与 ${previous} 的中文名重复：${label}`);
    seen.set(label, action);
  }
});

test('资源类型与短 ID 也走中文口径', () => {
  assert.equal(auditResourceLabel('exam_record'), '考试记录');
  assert.equal(auditResourceLabel('unknown_type'), '');
  assert.equal(auditResourceText('user', '12'), '管理员账号 12');
  assert.equal(auditResourceText('exam_record', '0f3d1c9a-2b7e-4c11-9f00-abcdef123456'), '考试记录 0f3d1c9a-2…');
  assert.equal(auditResourceText('', ''), '—');
});

const componentSource = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('三个展示日志的界面都走统一的中文名入口', () => {
  const auditSection = componentSource('src/components/user-management/AuditSection.tsx');
  assert.match(auditSection, /auditActionLabel\(log\.action\)/);
  assert.match(auditSection, /auditResourceText\(log\.resourceType, log\.resourceId\)/);
  assert.doesNotMatch(auditSection, /\|\|\s*log\.action\b/);

  const systemStatus = componentSource('src/components/settings/SystemStatusSection.tsx');
  assert.match(systemStatus, /auditActionLabel\(event\.action\)/);
  // `title={event.action}` 是允许的，这里禁的是把原始码当成可见文本渲染出来。
  assert.doesNotMatch(systemStatus, />\s*\{event\.action\}\s*</);

  const overview = componentSource('src/components/OverviewPanel.tsx');
  assert.match(overview, /return labels\[log\.action\] \|\| auditActionLabel\(log\.action\)/);
  assert.match(overview, /return auditActionLabel\(log\.action\)/);
  assert.doesNotMatch(overview, /\|\|\s*log\.action\b/);
  assert.doesNotMatch(overview, /return log\.action\b/);
});

test('动作中文名只有一个数据源', () => {
  const permissions = componentSource('src/constants/permissions.ts');
  assert.doesNotMatch(permissions, /export const ACTION_LABEL/);
});
