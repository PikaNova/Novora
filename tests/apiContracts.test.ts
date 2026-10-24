import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage } from 'node:http';
import {
  parseDeviceBinding,
  parseDeviceCommand,
  parseDeviceSetupConflict,
  parsePluginBindingInfo,
} from '../src/shared/deviceContracts.js';
import { parseExamPayload } from '../src/shared/examContracts.js';
import { createVercelRequest, parseQuery, readBody } from '../server/adapter.js';

type StatusedError = Error & { statusCode?: number };

/** serve.ts turns a thrown `statusCode` into the HTTP response, so the contract under test is the error shape. */
function thrownError(build: () => unknown): StatusedError {
  let caught: unknown;
  try {
    build();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error, 'expected the adapter call to throw');
  return caught as StatusedError;
}

async function rejectedError(promise: Promise<unknown>): Promise<StatusedError> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error, 'expected the adapter call to reject');
  return caught as StatusedError;
}

function fakeRequest(
  url: string,
  { headers = {}, chunks = [] }: { headers?: Record<string, string>; chunks?: string[] } = {},
): IncomingMessage {
  return {
    url,
    method: 'GET',
    headers,
    socket: undefined,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield Buffer.from(chunk, 'utf8');
    },
  } as unknown as IncomingMessage;
}

function jsonRequest(body: string): Promise<unknown> {
  return readBody(fakeRequest('/api/x', { headers: { 'content-type': 'application/json' }, chunks: [body] }));
}

test('device command contract: accepts a valid command and rejects malformed payloads', () => {
  const command = parseDeviceCommand({
    id: 'cmd-1',
    action: 'extend',
    minutes: 5,
    createdAt: 1000,
  });
  assert.deepEqual(command, { id: 'cmd-1', action: 'extend', minutes: 5, createdAt: 1000 });
  assert.equal(parseDeviceCommand(null), null);
  assert.equal(parseDeviceCommand({ id: '', action: 'pause', createdAt: 1000 }), null);
  assert.equal(parseDeviceCommand({ id: 'cmd-1', action: 'shutdown', createdAt: 1000 }), null);
  assert.equal(parseDeviceCommand({ id: 'cmd-1', action: 'pause', createdAt: 'not-a-number' }), null);
});

test('device binding contract: validates binding, conflict, and plugin rows', () => {
  assert.deepEqual(parseDeviceBinding({ gradeId: 'g1', classId: 'c1', revoked: false, isManagement: true }), {
    gradeId: 'g1',
    classId: 'c1',
    revoked: false,
    isManagement: true,
  });
  assert.equal(parseDeviceBinding({ gradeId: 1, classId: 'c1', revoked: false }), null);
  assert.deepEqual(parseDeviceSetupConflict({ instanceId: 'device-1', status: 'idle', lastSeenAt: 10, online: true }), {
    instanceId: 'device-1',
    status: 'idle',
    lastSeenAt: 10,
    online: true,
  });
  assert.equal(parseDeviceSetupConflict({ instanceId: 'device-1' }), null);
  assert.deepEqual(
    parsePluginBindingInfo({
      pluginInstanceId: 'plugin-1',
      viewerInstanceId: 'device-1',
      gradeId: 'g1',
      classId: 'c1',
      paired: true,
      viewerLastSeenAt: 20,
      pluginLastSeenAt: 30,
      updatedAt: 99,
    }),
    {
      pluginInstanceId: 'plugin-1',
      viewerInstanceId: 'device-1',
      gradeId: 'g1',
      classId: 'c1',
      paired: true,
      pluginLastSeenAt: 30,
      viewerLastSeenAt: 20,
    },
  );
  assert.equal(parsePluginBindingInfo({ viewerInstanceId: 'device-1' }), null);
});

test('exam payload contract: drops malformed records and normalizes valid domains', () => {
  const payload = parseExamPayload({
    ok: true,
    items: [
      { id: 'invalid', name: 'No time' },
      { id: 'item-2', name: '数学', startTime: '2026-08-30T09:00', endTime: '2026-08-30T10:00' },
    ],
    majors: [
      { name: 'Missing id' },
      {
        id: 'major-1',
        name: '期中',
        items: [{ id: 'item-2', name: '数学', startTime: '2026-08-30T09:00', endTime: '2026-08-30T10:00' }],
      },
    ],
    activeMajorId: 'major-1',
    title: '期中',
    alerts: { enabled: false },
    scheduleMode: 'weekly-only',
    grades: [{ id: 'g1', name: '高一' }],
    classes: [
      { id: 'bad-class', gradeId: 'missing-grade', name: '坏班级' },
      { id: 'c1', gradeId: 'g1', name: '1班' },
    ],
    updatedAt: '200',
  });

  assert.deepEqual(
    payload.items.map((item) => item.id),
    ['item-2'],
  );
  assert.deepEqual(
    payload.majors.map((major) => major.id),
    ['major-1'],
  );
  assert.equal(payload.alerts?.enabled, false);
  assert.equal(payload.scheduleMode, 'weekly-only');
  assert.deepEqual(
    (payload.grades ?? []).map((grade) => grade.name),
    ['高一'],
  );
  assert.deepEqual(
    (payload.classes ?? []).map((schoolClass) => schoolClass.id),
    ['c1'],
  );
  assert.equal(payload.updatedAt, 200);
});

test('exam payload contract: 修订号只跟随服务端字段出现，"没有该字段"与"全为 0"必须可区分', () => {
  // 老服务端不返回 revisions：解析结果不能凭空造出 {}，否则客户端会以为「各域都是 0」，
  // 从而不再退回整行版本比较（那是跨版本部署时的唯一保护）。
  assert.equal('revisions' in parseExamPayload({ items: [], updatedAt: 0 }), false);
  assert.deepEqual(parseExamPayload({ revisions: { major: 2, weekly: '3' }, updatedAt: 0 }).revisions, {
    major: 2,
    weekly: 3,
  });
  assert.deepEqual(parseExamPayload({ revisions: {}, updatedAt: 0 }).revisions, {});
  assert.deepEqual(parseExamPayload({ revisions: 'nope', updatedAt: 0 }).revisions, {});
});

test('node request adapter: 畸形百分号编码的 query 变成 400，而不是冒泡成 URIError', () => {
  assert.deepEqual(parseQuery(''), {});
  assert.deepEqual(parseQuery('q=%E4%BD%A0%E5%A5%BD&n=1+2&flag'), { q: '你好', n: '1 2', flag: '' });
  assert.deepEqual(parseQuery('a=1&a=2&a=3'), { a: ['1', '2', '3'] });

  for (const search of ['q=%zz', 'q=%', 'q=%E4%BD', 'q%zz=1']) {
    const error = thrownError(() => parseQuery(search));
    assert.equal(error.message, 'invalid_query');
    assert.equal(error.statusCode, 400);
  }
  // routes.ts 在 handleApiRequest 内构造请求，异常正好落在 serve.ts 读取 statusCode 的位置。
  assert.equal(thrownError(() => createVercelRequest(fakeRequest('/api/health?q=%zz'), undefined)).statusCode, 400);
});

test('node request adapter: application/json 非法请求体返回 400，其它 content-type 行为不变', async () => {
  assert.deepEqual(await jsonRequest('{"a":[1,2]}'), { a: [1, 2] });

  for (const body of ['{', 'not json', '"unclosed']) {
    const error = await rejectedError(jsonRequest(body));
    assert.equal(error.message, 'invalid_json_body');
    assert.equal(error.statusCode, 400);
  }

  assert.equal(await readBody(fakeRequest('/api/x', { chunks: ['plain text'] })), 'plain text');
  assert.equal(await jsonRequest(''), undefined);
  assert.deepEqual(
    await readBody(
      fakeRequest('/api/x', {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        chunks: ['a=1&b=%202'],
      }),
    ),
    { a: '1', b: ' 2' },
  );
});
