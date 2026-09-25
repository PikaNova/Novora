import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeviceBinding, DeviceCommand, DeviceHeartbeatInput } from '../src/shared/deviceContracts.js';
import type { HeartbeatOutcome } from '../src/sync/transport.js';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  get length(): number {
    return this.values.size;
  }
}

const testGlobals = globalThis as typeof globalThis & {
  localStorage?: MemoryStorage;
  __APP_VERSION__?: string;
  __COMMIT_SHA__?: string;
};
testGlobals.localStorage = new MemoryStorage();
testGlobals.__APP_VERSION__ = 'test';
testGlobals.__COMMIT_SHA__ = 'test';

const { createHttpPollTransport } = await import('../src/sync/transport.js');

type Timer = { id: number; at: number; callback: () => void };

function harness(outcomes: Array<HeartbeatOutcome | Error>) {
  const timers: Timer[] = [];
  const sent: DeviceHeartbeatInput[] = [];
  const events: string[] = [];
  let now = 1_000;
  let nextTimerId = 1;
  let timerAt = 0;
  const transport = createHttpPollTransport({
    sendHeartbeat: async (input: DeviceHeartbeatInput) => {
      sent.push(input);
      const next = outcomes.length > 1 ? outcomes.shift()! : outcomes[0];
      if (next instanceof Error) throw next;
      return { ...next, version: next.version };
    },
    buildInput: (state) => ({
      page: state.page,
      acknowledgedCommandId: state.acknowledgedCommandId,
      ...(state.failedCommandId
        ? { failedCommandId: state.failedCommandId, commandFailureReason: state.commandFailureReason }
        : {}),
    }),
    intervalMsFor: () => 60_000,
    now: () => now,
    setTimer: (callback, delayMs) => {
      timerAt = now + delayMs;
      const id = nextTimerId++;
      timers.push({ id, at: timerAt, callback });
      return id;
    },
    clearTimer: (id) => {
      const index = timers.findIndex((entry) => entry.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    random: () => 0,
    onVersionAdvertised: () => events.push('capability'),
    currentPage: () => '/exam',
  });
  const flush = async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  };
  const runDueTimers = async () => {
    const due = timers.splice(0, timers.length);
    now = Math.max(...due.map((entry) => entry.at), now);
    for (const entry of due) entry.callback();
    await flush();
  };
  const handlers = {
    onTick: () => events.push('tick'),
    onVersion: (version: number) => events.push(`version:${version}`),
    onCommand: (command: DeviceCommand) => events.push(`command:${command.id}`),
    onBinding: (binding: DeviceBinding) => events.push(`binding:${binding.classId}`),
    onRevoked: () => events.push('revoked'),
  };
  return { transport, handlers, timers, sent, events, flush, runDueTimers };
}

const idle: HeartbeatOutcome = { revoked: false, binding: null, command: null };

test('the first subscriber runs a cycle immediately and schedules the next one', async () => {
  const h = harness([idle]);
  h.transport.start(h.handlers);
  await h.flush();
  assert.deepEqual(h.events, ['tick']);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].page, '/exam');
  assert.equal(h.timers.length, 1, 'exactly one follow-up timer is pending');
  h.transport.stop(h.handlers);
  assert.equal(h.timers.length, 0, 'stopping the last subscriber clears the timer');
});

test('a version from the server is forwarded and marks the edge capability', async () => {
  const h = harness([{ ...idle, version: 1789223000000 }]);
  h.transport.start(h.handlers);
  await h.flush();
  assert.ok(h.events.includes('capability'));
  assert.ok(h.events.includes('version:1789223000000'));
  h.transport.stop(h.handlers);
});

test('a delivered command is dispatched once and acknowledged on the follow-up cycle', async () => {
  const command: DeviceCommand = { id: 'cmd_1', action: 'pause', createdAt: 1_000 };
  const h = harness([{ ...idle, command }, idle]);
  h.transport.start(h.handlers);
  await h.flush();
  assert.ok(h.events.includes('command:cmd_1'));
  // 组件在处理命令时会登记回执，这里模拟同样的时序。
  h.transport.noteCommandAcknowledged(command.id);
  await h.runDueTimers();
  assert.equal(h.sent[h.sent.length - 1].acknowledgedCommandId, 'cmd_1');
  // 回执过后同样的命令再次下发时必须被丢弃，不能重复执行。
  assert.equal(h.events.filter((entry) => entry === 'command:cmd_1').length, 1);
  h.transport.stop(h.handlers);
});

test('revoked heartbeats reach the handler and stop further dispatch', async () => {
  const h = harness([{ ...idle, revoked: true, binding: { gradeId: 'g', classId: 'c', revoked: true } }]);
  h.transport.start(h.handlers);
  await h.flush();
  assert.ok(h.events.includes('revoked'));
  assert.ok(!h.events.some((entry) => entry.startsWith('binding:')));
  h.transport.stop(h.handlers);
});

test('binding changes are forwarded to the handler', async () => {
  const h = harness([{ ...idle, binding: { gradeId: 'g1', classId: 'c1', revoked: false } }]);
  h.transport.start(h.handlers);
  await h.flush();
  assert.ok(h.events.includes('binding:c1'));
  h.transport.stop(h.handlers);
});

test('a failing heartbeat keeps the loop alive', async () => {
  const h = harness([new Error('offline'), new Error('offline')]);
  h.transport.start(h.handlers);
  await h.flush();
  assert.equal(h.timers.length, 1, 'the transport reschedules after a failure');
  h.transport.stop(h.handlers);
});

test('执行失败的命令带原因回执（后台不再把 no-op 当成功）', async () => {
  const command: DeviceCommand = { id: 'cmd_fail', action: 'pause', createdAt: 1_000 };
  const h = harness([{ ...idle, command }, idle, idle]);
  h.transport.start(h.handlers);
  await h.flush();
  assert.ok(h.events.includes('command:cmd_fail'));
  // 组件执行命令失败时的时序：登记失败原因，下一次心跳带上。
  h.transport.noteCommandFailed(command.id, '本机没有临时考试');
  await h.runDueTimers();
  const last = h.sent[h.sent.length - 1];
  assert.equal(last.failedCommandId, 'cmd_fail');
  assert.equal(last.commandFailureReason, '本机没有临时考试');
  assert.equal(last.acknowledgedCommandId, '', '失败的命令不能同时被当成已执行');
  h.transport.stop(h.handlers);
});

test('multiple subscribers share one loop and stop independently', async () => {
  const h = harness([idle]);
  const other = {
    onVersion: (version: number) => h.events.push(`other-version:${version}`),
  };
  h.transport.start(h.handlers);
  h.transport.start(other);
  await h.flush();
  assert.equal(h.sent.length, 1, 'the second subscriber must not trigger its own request');
  h.transport.stop(h.handlers);
  assert.equal(h.timers.length, 1, 'the loop keeps running while a subscriber remains');
  h.transport.stop(other);
  assert.equal(h.timers.length, 0);
});
