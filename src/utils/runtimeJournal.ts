import {
  RUNTIME_MAX_ENTRIES,
  RUNTIME_MAX_BYTES,
  RUNTIME_RETENTION_MS,
  runtimeId,
  sanitizeRuntimeEvent,
  type RuntimeEvent,
  type RuntimeCategory,
} from '../shared/runtimeLog.js';

const sessionId = runtimeId('session');
let sequence = 0;
const memory: RuntimeEvent[] = [];
const memorySizes: number[] = [];
let memoryBytes = 0;
let pendingBytes = 0;
let databasePromise: Promise<IDBDatabase | null> | null = null;
let tail: Promise<unknown> = Promise.resolve();
const pending: RuntimeEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let storageState = 'initializing';
export function getRuntimeStorageState(): string {
  return storageState;
}
const RECOVERY_KEY = 'novora_runtime_recovery_v2';
const WINDOW_KEY = 'novora_runtime_windows_v2';
const listeners = new Set<(row: RuntimeEvent) => void>();
export type RuntimeWindow = {
  id: string;
  errorEventId: string;
  from: number;
  to: number;
  sessionId: string;
  fromSequence: number;
  throughSequence: number;
  complete: boolean;
  fromMono?: number;
  toMono?: number;
};
function recovery(): RuntimeEvent[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECOVERY_KEY) || '[]');
    return Array.isArray(raw) ? raw.map(sanitizeRuntimeEvent).filter((row): row is RuntimeEvent => !!row) : [];
  } catch {
    return [];
  }
}
function db(): Promise<IDBDatabase | null> {
  if (!databasePromise)
    databasePromise = new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        storageState = 'recovery_only';
        return resolve(null);
      }
      let settled = false;
      const finish = (value: IDBDatabase | null) => {
        if (settled) {
          value?.close();
          return;
        }
        settled = true;
        clearTimeout(timeout);
        storageState = value ? 'indexeddb' : 'recovery_only';
        resolve(value);
      };
      const timeout = setTimeout(() => finish(null), 2000);
      try {
        const request = indexedDB.open('novora-runtime-v2', 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('events')) {
            const store = request.result.createObjectStore('events', { keyPath: 'eventId' });
            store.createIndex('at', 'at');
          }
        };
        request.onsuccess = () => {
          request.result.onversionchange = () => {
            request.result.close();
            databasePromise = null;
            storageState = 'initializing';
          };
          finish(request.result);
        };
        request.onerror = request.onblocked = () => finish(null);
      } catch {
        finish(null);
      }
    });
  return databasePromise;
}
function prune(rows: RuntimeEvent[]): RuntimeEvent[] {
  let kept = rows
    .filter((row) => row.at >= Date.now() - RUNTIME_RETENTION_MS)
    .sort((a, b) => a.at - b.at || a.eventId.localeCompare(b.eventId))
    .slice(-RUNTIME_MAX_ENTRIES);
  let bytes = 0;
  kept = kept
    .reverse()
    .filter((row) => {
      bytes += eventBytes(row);
      return bytes <= RUNTIME_MAX_BYTES;
    })
    .reverse();
  const sessions = new Map<string, number>();
  for (const row of kept) sessions.set(row.sessionId, Math.min(sessions.get(row.sessionId) ?? Infinity, row.at));
  return kept.sort(
    (a, b) =>
      sessions.get(a.sessionId)! - sessions.get(b.sessionId)! ||
      a.sessionId.localeCompare(b.sessionId) ||
      a.sequence - b.sequence,
  );
}
function eventBytes(row: RuntimeEvent): number {
  return new TextEncoder().encode(JSON.stringify(row)).length;
}
export async function readRuntimeEvents(from = 0, to = 1e15): Promise<RuntimeEvent[]> {
  await flushRuntimeEvents();
  const database = await db();
  const stored = database
    ? await new Promise<RuntimeEvent[]>((resolve) => {
        try {
          const tx = database.transaction('events');
          const timeout = setTimeout(() => {
            try {
              tx.abort();
            } catch {
              /* ended */
            }
            resolve([]);
          }, 2000);
          const request = tx.objectStore('events').getAll();
          request.onsuccess = () => {
            clearTimeout(timeout);
            resolve(request.result);
          };
          request.onerror = tx.onabort = () => {
            clearTimeout(timeout);
            resolve([]);
          };
        } catch {
          resolve([]);
        }
      })
    : [];
  const unique = new Map<string, RuntimeEvent>();
  for (const raw of [...stored, ...recovery(), ...memory]) {
    const row = sanitizeRuntimeEvent(raw);
    if (row) unique.set(row.eventId, row);
  }
  return prune([...unique.values()]).filter((row) => row.at >= from && row.at <= to);
}
export function saveRuntimeRecovery(): void {
  try {
    const unique = new Map([...recovery(), ...memory].map((row) => [row.eventId, row]));
    let bytes = 0;
    const rows = prune([...unique.values()])
      .sort((a, b) => b.at - a.at)
      .slice(0, 500)
      .filter((row) => {
        bytes += eventBytes(row);
        return bytes <= 512 * 1024;
      })
      .reverse();
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(rows));
  } catch {
    storageState = 'memory_only';
  }
}
export async function flushRuntimeEvents(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const batch = pending.splice(0);
  pendingBytes = 0;
  tail = tail
    .catch(() => undefined)
    .then(async () => {
      if (!batch.length) return;
      const database = await db();
      if (!database) {
        saveRuntimeRecovery();
        return;
      }
      await new Promise<void>((resolve) => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const tx = database.transaction('events', 'readwrite');
          const store = tx.objectStore('events');
          timeout = setTimeout(() => {
            try {
              tx.abort();
            } catch {
              /* ended */
            }
            storageState = 'recovery_only';
            saveRuntimeRecovery();
            resolve();
          }, 2000);
          for (const row of [...recovery(), ...batch]) store.put({ ...row, storedBytes: eventBytes(row) });
          const request = store.index('at').openCursor();
          const overflow: Array<{ key: IDBValidKey; bytes: number }> = [];
          let storedBytes = 0;
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
              let index = 0;
              while (
                index < overflow.length &&
                (overflow.length - index > RUNTIME_MAX_ENTRIES || storedBytes > RUNTIME_MAX_BYTES)
              ) {
                store.delete(overflow[index].key);
                storedBytes -= overflow[index].bytes;
                index += 1;
              }
              return;
            }
            if (Number(cursor.value.at) < Date.now() - RUNTIME_RETENTION_MS) cursor.delete();
            else {
              const bytes = Number(cursor.value.storedBytes) || eventBytes(cursor.value);
              storedBytes += bytes;
              overflow.push({ key: cursor.primaryKey, bytes });
            }
            cursor.continue();
          };
          tx.oncomplete = () => {
            clearTimeout(timeout);
            storageState = 'indexeddb';
            resolve();
          };
          tx.onerror = tx.onabort = () => {
            clearTimeout(timeout);
            storageState = 'recovery_only';
            saveRuntimeRecovery();
            resolve();
          };
        } catch {
          clearTimeout(timeout);
          storageState = 'recovery_only';
          saveRuntimeRecovery();
          resolve();
        }
      });
    });
  await tail;
}
export function journal(
  code: string,
  context: Record<string, unknown> = {},
  level: RuntimeEvent['level'] = 'info',
  category: RuntimeCategory = 'page',
  message = code,
  operationId = '',
): RuntimeEvent | null {
  try {
    const row = sanitizeRuntimeEvent({
      eventId: `${sessionId}:${++sequence}`,
      sessionId,
      sequence,
      at: Date.now(),
      monoMs: typeof performance !== 'undefined' ? performance.now() : 0,
      code,
      category,
      level,
      message,
      context,
      operationId,
      route: typeof location !== 'undefined' ? location.pathname : '/',
      version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown',
      build: typeof __COMMIT_SHA__ !== 'undefined' ? __COMMIT_SHA__ : '',
    });
    if (!row) return null;
    const bytes = eventBytes(row);
    memory.push(row);
    memorySizes.push(bytes);
    memoryBytes += bytes;
    while (memory.length > RUNTIME_MAX_ENTRIES || memoryBytes > RUNTIME_MAX_BYTES) {
      memory.shift();
      memoryBytes -= memorySizes.shift()!;
    }
    pending.push(row);
    pendingBytes += bytes;
    while (pending.length > RUNTIME_MAX_ENTRIES || pendingBytes > RUNTIME_MAX_BYTES) {
      pendingBytes -= eventBytes(pending.shift()!);
    }
    if (!timer) timer = setTimeout(() => void flushRuntimeEvents().catch(saveRuntimeRecovery), 1000);
    if (level === 'error') saveRuntimeRecovery();
    for (const listener of listeners) {
      try {
        listener(row);
      } catch {
        /* observer must not interrupt business */
      }
    }
    return row;
  } catch {
    return null;
  }
}
export function subscribeRuntimeEvents(listener: (row: RuntimeEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getRuntimeWindows(): RuntimeWindow[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(WINDOW_KEY) || '[]');
    return Array.isArray(raw)
      ? raw
          .filter(
            (row): row is RuntimeWindow =>
              !!row &&
              typeof row.id === 'string' &&
              typeof row.errorEventId === 'string' &&
              typeof row.sessionId === 'string' &&
              Number.isFinite(row.from) &&
              Number.isFinite(row.to) &&
              Number.isSafeInteger(row.fromSequence) &&
              Number.isSafeInteger(row.throughSequence) &&
              typeof row.complete === 'boolean' &&
              row.to >= Date.now() - RUNTIME_RETENTION_MS,
          )
          .slice(-20)
      : [];
  } catch {
    return [];
  }
}
function saveWindows(rows: RuntimeWindow[]): void {
  try {
    localStorage.setItem(WINDOW_KEY, JSON.stringify(rows.slice(-20)));
  } catch {
    /* best effort */
  }
}
export function captureRuntimeWindow(errorEventId: string, beforeSeconds = 300, afterSeconds = 60): RuntimeWindow {
  const now = Date.now();
  const mono = typeof performance !== 'undefined' ? performance.now() : 0;
  const window: RuntimeWindow = {
    id: runtimeId('window'),
    errorEventId,
    from: now - beforeSeconds * 1000,
    to: now + afterSeconds * 1000,
    sessionId,
    fromSequence: memory.find((row) => row.monoMs >= mono - beforeSeconds * 1000)?.sequence || sequence,
    throughSequence: sequence,
    complete: false,
    fromMono: mono - beforeSeconds * 1000,
    toMono: mono + afterSeconds * 1000,
  };
  saveRuntimeRecovery();
  saveWindows([...getRuntimeWindows(), window]);
  const finishTimer = setTimeout(
    () => {
      saveRuntimeRecovery();
      saveWindows(
        getRuntimeWindows().map((row) =>
          row.id === window.id ? { ...row, throughSequence: sequence, complete: true } : row,
        ),
      );
    },
    Math.max(0, afterSeconds) * 1000,
  );
  (finishTimer as unknown as { unref?: () => void }).unref?.();
  return window;
}
export async function readRuntimeWindow(window: RuntimeWindow): Promise<RuntimeEvent[]> {
  const rows = await readRuntimeEvents();
  return rows.filter((row) =>
    row.sessionId === window.sessionId
      ? !window.complete && window.fromMono !== undefined && window.toMono !== undefined
        ? row.monoMs >= window.fromMono && row.monoMs <= window.toMono
        : row.sequence >= window.fromSequence && row.sequence <= window.throughSequence
      : row.at >= window.from && row.at <= window.to,
  );
}
export function finishRuntimeWindows(): void {
  saveRuntimeRecovery();
  saveWindows(
    getRuntimeWindows().map((row) =>
      !row.complete && row.sessionId === sessionId ? { ...row, throughSequence: sequence, complete: true } : row,
    ),
  );
}
