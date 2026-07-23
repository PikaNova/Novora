/* IndexedDB durable mirror for local-first exam data. localStorage remains the synchronous
   compatibility cache; this database survives larger payloads and records migration/conflicts. */
const DB = 'exam-board-offline';
const VERSION = 1;
type RecordValue = { key: string; value: unknown; updatedAt: number };
function open(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const req = indexedDB.open(DB, VERSION); req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'key' }); }; req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
async function put(key: string, value: unknown): Promise<void> { if (typeof indexedDB === 'undefined') return; const db = await open(); await new Promise<void>((resolve, reject) => { const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').put({ key, value, updatedAt: Date.now() } satisfies RecordValue); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close(); }
export async function mirrorAppSettings(value: unknown): Promise<void> { try { await put('app-settings-v1', value); } catch { /* localStorage remains fallback */ } }
export async function recordSyncConflict(conflictCount: number, local: unknown, remote: unknown): Promise<void> { try { await put(`conflict-${Date.now()}`, { conflictCount, local, remote }); } catch { /* conflict remains in pending outbox */ } }
