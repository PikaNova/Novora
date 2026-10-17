import { getInstanceId } from './telemetry';
import { readRuntimeEvents, flushRuntimeEvents, subscribeRuntimeEvents } from '../utils/runtimeJournal.js';
import { RUNTIME_BATCH_SIZE, type RuntimeEvent } from '../shared/runtimeLog.js';

const CURSOR_KEY = 'novora_runtime_upload_cursors_v1';
const SECRET_KEY = 'novora_runtime_device_secret_v1';
let started = false;
let busy = false;
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

function cursors(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CURSOR_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, number>) : {};
  } catch {
    return {};
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

async function request(resource: string, secret: string, body: Record<string, unknown>): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const query = new URLSearchParams({ resource });
    const response = await fetch(`/api/diagnostic-logs?${query}`, {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ instanceId: getInstanceId(), ...body }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(`日志通道请求失败 (${response.status})`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function tickRuntimeLogClient(): Promise<void> {
  if (busy || performance.now() < nextAttempt || !navigator.onLine) return;
  const secret = runtimeSecret();
  if (!secret) return;
  busy = true;
  try {
    await request('runtime-enroll', secret, { secret });
    await flushRuntimeEvents();
    const saved = cursors();
    const rows = await readRuntimeEvents();
    const pending = rows.filter((row) => row.sequence > (Number(saved[row.sessionId]) || 0));
    for (const batch of runtimeBatches(pending)) await request('runtime-ingest', secret, { entries: batch });
    if (pending.length) {
      const next = { ...saved };
      for (const row of pending) next[row.sessionId] = Math.max(Number(next[row.sessionId]) || 0, row.sequence);
      const recent = Object.entries(next).slice(-200);
      localStorage.setItem(CURSOR_KEY, JSON.stringify(Object.fromEntries(recent)));
    }
    failures = 0;
    nextAttempt = performance.now() + 30000;
  } catch {
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
  subscribeRuntimeEvents((row) => {
    if (row.level === 'error' || row.level === 'warn') {
      nextAttempt = 0;
      void tickRuntimeLogClient();
    }
  });
  window.addEventListener('online', () => {
    nextAttempt = 0;
    void tickRuntimeLogClient();
  });
}
