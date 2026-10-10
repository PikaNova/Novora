import { getInstanceId } from './telemetry';
import { readRuntimeEvents, journal, flushRuntimeEvents, getRuntimeStorageState } from '../utils/runtimeJournal.js';
import { RUNTIME_BATCH_SIZE, RUNTIME_MAX_ENTRIES, RUNTIME_MAX_BYTES, type RuntimeEvent } from '../shared/runtimeLog.js';

const SECRET_KEY = 'novora_runtime_device_secret_v1';
export type CollectionTask = { id: string; fromTs: number; toTs: number; expiresAt: number; status: string };
let started = false;
let busy = false;
let approved = false;
let nextAttempt = 0;
let failures = 0;
export function runtimeSecret(): string | null {
  try {
    const stored = localStorage.getItem(SECRET_KEY);
    if (stored && /^[a-f0-9]{64}$/.test(stored)) return stored;
    if (typeof crypto === 'undefined' || !crypto.getRandomValues) return null;
    const secret = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    localStorage.setItem(SECRET_KEY, secret);
    return secret;
  } catch {
    return null;
  }
}
export function runtimeBatches(rows: readonly RuntimeEvent[]): RuntimeEvent[][] {
  const batches: RuntimeEvent[][] = [];
  let current: RuntimeEvent[] = [];
  let bytes = 2;
  for (const row of rows) {
    const size = new TextEncoder().encode(JSON.stringify(row)).length + 1;
    if (current.length && (current.length >= RUNTIME_BATCH_SIZE || bytes + size > 450 * 1024)) {
      batches.push(current);
      current = [];
      bytes = 2;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}
async function request(
  resource: string,
  secret: string,
  body?: Record<string, unknown>,
  enrollment = false,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const query = new URLSearchParams({ resource });
    if (!body) query.set('instanceId', getInstanceId());
    // Deliberately use raw fetch: a failed diagnostic upload must never recursively log another API failure.
    const response = await fetch(`/api/diagnostic-logs?${query}`, {
      method: body ? 'POST' : 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(!enrollment ? { Authorization: ['Bearer', secret].join(' ') } : {}),
      },
      body: body ? JSON.stringify({ instanceId: getInstanceId(), ...body }) : undefined,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      if (response.status === 401 || response.status === 403) approved = false;
      throw new Error(`日志通道请求失败 (${response.status})`);
    }
    return data as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}
export async function collectRuntimeTask(
  task: CollectionTask,
  send: (resource: string, body: Record<string, unknown>) => Promise<unknown>,
): Promise<void> {
  if (
    !task.id ||
    !Number.isFinite(task.fromTs) ||
    !Number.isFinite(task.toTs) ||
    !Number.isFinite(task.expiresAt) ||
    task.toTs < task.fromTs ||
    task.toTs > Date.now() ||
    task.expiresAt <= Date.now()
  )
    return;
  const operationId = task.id;
  journal(
    'device.logs_collect_start',
    { fromTs: task.fromTs, toTs: task.toTs },
    'info',
    'device',
    '开始收集本机日志',
    operationId,
  );
  await flushRuntimeEvents();
  const entries = await readRuntimeEvents(task.fromTs, task.toTs);
  for (const batch of runtimeBatches(entries)) await send('runtime-ingest', { taskId: task.id, entries: batch });
  // The local journal has a bounded ring; explicitly disclose that older entries may already be unavailable.
  const retained = await readRuntimeEvents();
  const storageState = getRuntimeStorageState();
  const retainedBytes = new TextEncoder().encode(JSON.stringify(retained)).length;
  const limited =
    retained.length >= RUNTIME_MAX_ENTRIES || retainedBytes >= RUNTIME_MAX_BYTES * 0.95 || storageState !== 'indexeddb';
  await send('runtime-complete', {
    taskId: task.id,
    status: 'completed',
    truncatedCount: 0,
    detail: entries.length
      ? `已发送 ${entries.length} 条现存日志${limited ? '；本地容量或存储能力受限，历史缺失数量未知' : ''}`
      : '所选时间范围无现存日志；设备未运行、保留期或存储限制均可能导致缺失',
  });
  journal(
    'device.logs_collect_done',
    { count: entries.length, capacityLimited: limited },
    'info',
    'device',
    '本机日志收集完成',
    operationId,
  );
}
export async function tickRuntimeLogClient(): Promise<void> {
  if (busy || performance.now() < nextAttempt || !navigator.onLine) return;
  const secret = runtimeSecret();
  if (!secret) return;
  busy = true;
  try {
    if (!approved) {
      const result = await request('runtime-enroll', secret, { secret }, true);
      approved = result.status === 'approved';
      if (!approved) {
        nextAttempt = performance.now() + 60000;
        return;
      }
    }
    const data = await request('runtime-poll', secret);
    const tasks = Array.isArray(data.tasks) ? (data.tasks as CollectionTask[]) : [];
    for (const task of tasks.filter((task) => task.toTs <= Date.now() && task.expiresAt > Date.now()).slice(0, 1))
      await collectRuntimeTask(task, (resource, body) => request(resource, secret, body));
    failures = 0;
    nextAttempt = performance.now() + 30000;
  } catch {
    // Keep tasks on the server as claimed. A reload or network recovery replays batches idempotently.
    failures = Math.min(failures + 1, 6);
    nextAttempt = performance.now() + Math.min(300000, 5000 * 2 ** failures);
  } finally {
    busy = false;
  }
}
export function startRuntimeLogClient(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void tickRuntimeLogClient();
  setInterval(() => void tickRuntimeLogClient(), 30000);
  window.addEventListener('online', () => {
    nextAttempt = 0;
    void tickRuntimeLogClient();
  });
}
