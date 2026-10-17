import { randomUUID } from 'node:crypto';
import { mkdir, stat, rename, appendFile, readFile, unlink } from 'node:fs/promises';
import { mkdirSync, statSync, renameSync, appendFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { sanitizeRuntimeEvent, type RuntimeEvent } from '../../src/shared/runtimeLog.js';
import { insertRuntimeEvents, insertRuntimeRecords } from './store.js';

const session = `server_${randomUUID()}`;
let sequence = 0;
let tail: Promise<void> = Promise.resolve();
let queued = 0;
let dropped = 0;
let fileFailed = false;
let replayAt = 0;
let databaseRetryAt = 0;
const MAX_BYTES = 4 * 1024 * 1024;
const dir = () =>
  resolve(
    process.env.NOVORA_RUNTIME_LOG_DIR ||
      join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'state'), 'Novora', 'runtime-logs'),
  );
export function runtimeStorageStatus() {
  return { fileFallback: !process.env.VERCEL, fileFailed, queued, dropped, maxFileBytes: MAX_BYTES, files: 3 };
}
async function appendFallback(row: { instanceId: string; receivedAt: number; event: RuntimeEvent }): Promise<void> {
  if (process.env.VERCEL) return;
  try {
    await mkdir(dir(), { recursive: true });
    const path = join(dir(), 'runtime.jsonl');
    const line = JSON.stringify(row) + '\n';
    const bytes = await stat(path)
      .then((s) => s.size)
      .catch(() => 0);
    if (bytes + Buffer.byteLength(line) > MAX_BYTES) {
      await unlink(join(dir(), 'runtime.2.jsonl')).catch(() => undefined);
      await rename(join(dir(), 'runtime.1.jsonl'), join(dir(), 'runtime.2.jsonl')).catch(() => undefined);
      await rename(path, join(dir(), 'runtime.1.jsonl')).catch(() => undefined);
      if (
        await stat(path)
          .then((s) => s.size + Buffer.byteLength(line) > MAX_BYTES)
          .catch(() => false)
      )
        throw new Error('rotation failed');
    }
    await appendFile(path, line, { mode: 0o600 });
    fileFailed = false;
  } catch {
    fileFailed = true;
  }
}
export async function replayRuntimeFallback(): Promise<void> {
  if (process.env.VERCEL || Date.now() - replayAt < 60000) return;
  replayAt = Date.now();
  // Runs on the same serial queue as append/rotation, so successful replay cannot delete newer lines.
  for (const file of ['runtime.2.jsonl', 'runtime.1.jsonl', 'runtime.jsonl']) {
    const path = join(dir(), file);
    const size = await stat(path)
      .then((s) => s.size)
      .catch(() => 0);
    if (!size || size > MAX_BYTES) continue;
    const content = await readFile(path, 'utf8');
    let batch: { instanceId: string; receivedAt: number; event: RuntimeEvent }[] = [];
    for (const line of content.split('\n').filter(Boolean)) {
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(line);
      } catch {
        dropped++;
        continue;
      }
      const event = sanitizeRuntimeEvent(raw.event);
      if (event && raw.instanceId === 'server' && Number.isSafeInteger(raw.receivedAt) && Number(raw.receivedAt) > 0)
        batch.push({ instanceId: 'server', event, receivedAt: Number(raw.receivedAt) });
      else dropped++;
      if (batch.length >= 250) {
        try {
          await insertRuntimeRecords(batch);
        } catch (error) {
          replayAt = 0;
          throw error;
        }
        batch = [];
      }
    }
    if (batch.length) {
      try {
        await insertRuntimeRecords(batch);
      } catch (error) {
        replayAt = 0;
        throw error;
      }
    }
    await unlink(path);
  }
}
export function logServer(
  code: string,
  context: Record<string, unknown> = {},
  level: RuntimeEvent['level'] = 'info',
  message = code,
  operationId = '',
): void {
  const receivedAt = Date.now();
  const event = sanitizeRuntimeEvent({
    eventId: `${session}:${++sequence}`,
    sessionId: session,
    sequence,
    at: receivedAt,
    monoMs: performance.now(),
    category: 'server',
    code,
    context,
    level,
    message,
    operationId,
    route: '/',
    version: process.env.npm_package_version || 'unknown',
    build: process.env.VERCEL_GIT_COMMIT_SHA || '',
  });
  if (!event) return;
  if (queued >= 500) {
    dropped++;
    return;
  }
  queued++;
  tail = tail
    .catch(() => undefined)
    .then(async () => {
      try {
        if (Date.now() < databaseRetryAt) {
          await appendFallback({ instanceId: 'server', receivedAt, event });
          return;
        }
        await insertRuntimeEvents('server', [event], receivedAt);
        databaseRetryAt = 0;
        await replayRuntimeFallback();
      } catch {
        databaseRetryAt = Date.now() + 5000;
        await appendFallback({ instanceId: 'server', receivedAt, event });
      }
    })
    .finally(() => {
      queued--;
    });
}
export async function flushServerJournal(): Promise<void> {
  await tail;
}

// Fatal exceptions terminate before an async database/file write can finish.
export function logServerFatal(error: Error): void {
  const receivedAt = Date.now();
  const event = sanitizeRuntimeEvent({
    eventId: `${session}:${++sequence}`,
    sessionId: session,
    sequence,
    at: receivedAt,
    monoMs: performance.now(),
    category: 'server',
    code: 'server.uncaught',
    context: {},
    level: 'error',
    message: error.stack || error.message,
    operationId: '',
    route: '/',
    version: process.env.npm_package_version || 'unknown',
    build: '',
  });
  if (!event) return;
  const line = JSON.stringify({ instanceId: 'server', receivedAt, event }) + '\n';
  if (process.env.VERCEL) {
    console.error(line);
    return;
  }
  try {
    mkdirSync(dir(), { recursive: true });
    const path = join(dir(), 'runtime.jsonl');
    if (existsSync(path) && statSync(path).size + Buffer.byteLength(line) > MAX_BYTES) {
      const oldest = join(dir(), 'runtime.2.jsonl'),
        previous = join(dir(), 'runtime.1.jsonl');
      if (existsSync(oldest)) unlinkSync(oldest);
      if (existsSync(previous)) renameSync(previous, oldest);
      renameSync(path, previous);
    }
    appendFileSync(path, line, { mode: 0o600 });
  } catch {
    console.error(line);
  }
}
