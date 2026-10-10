import { journal } from './runtimeJournal.js';

let dataAnchor = { version: 0, operationId: '' };
let displaySnapshot: Record<string, string | number | boolean> = {};
let committedAt = 0;
let renderCommittedAt = 0;
export function noteRuntimeRenderCommit(): void {
  renderCommittedAt = performance.now();
}
export function clearRuntimeDisplay(): void {
  displaySnapshot = {};
  committedAt = 0;
  renderCommittedAt = 0;
}
export function setRuntimeDataAnchor(version: number, operationId: string): void {
  dataAnchor = { version, operationId };
}
export function getRuntimeDataAnchor(): Readonly<typeof dataAnchor> {
  return dataAnchor;
}
export function updateRuntimeDisplay(snapshot: typeof displaySnapshot): void {
  displaySnapshot = { ...snapshot };
  committedAt = typeof performance !== 'undefined' ? performance.now() : 0;
  journal(
    'display.state_committed',
    snapshot,
    'info',
    'display',
    '界面显示状态已提交',
    snapshot.dataVersion === dataAnchor.version ? dataAnchor.operationId : '',
  );
}
export function getRuntimeDisplaySnapshot(): typeof displaySnapshot {
  return {
    ...displaySnapshot,
    displayActive: !!committedAt,
    sinceStateChangeMs: committedAt ? Math.round(performance.now() - committedAt) : 0,
    sinceRenderCommitMs: renderCommittedAt ? Math.round(performance.now() - renderCommittedAt) : 0,
  };
}
/** Portable opaque reference; never include titles or the original business identifier. */
export function runtimeReference(value: unknown): string {
  if (value == null || value === '') return '';
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `ref_${(hash >>> 0).toString(36)}`;
}
