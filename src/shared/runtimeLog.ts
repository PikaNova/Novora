import { sanitizeErrorReportRecord, sanitizeErrorReportText, sanitizeErrorReportPath } from './errorReportContracts.js';

export const RUNTIME_RETENTION_MS = 7 * 86400000;
export const RUNTIME_MAX_ENTRIES = 5000;
export const RUNTIME_MAX_BYTES = 8 * 1024 * 1024;
export const RUNTIME_BATCH_SIZE = 250;
export const RUNTIME_CATEGORIES = [
  'display',
  'time',
  'sync',
  'device',
  'notice',
  'network',
  'page',
  'storage',
  'pwa',
  'server',
] as const;
export type RuntimeCategory = (typeof RUNTIME_CATEGORIES)[number];
export type RuntimeEvent = {
  eventId: string;
  sessionId: string;
  sequence: number;
  at: number;
  monoMs: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  category: RuntimeCategory;
  code: string;
  message: string;
  route: string;
  operationId: string;
  version: string;
  build: string;
  context: Record<string, string | number | boolean>;
};
export function sanitizeRuntimeEvent(value: unknown): RuntimeEvent | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = (v: unknown) => (typeof v === 'string' && /^[a-zA-Z0-9_.:-]{1,96}$/.test(v) ? v : '');
  if (
    !id(row.eventId) ||
    !id(row.sessionId) ||
    !id(row.code) ||
    !Number.isSafeInteger(row.sequence) ||
    Number(row.sequence) < 1 ||
    !Number.isFinite(row.at) ||
    Number(row.at) <= 0 ||
    Number(row.at) > 1e15
  )
    return null;
  if (!(RUNTIME_CATEGORIES as readonly unknown[]).includes(row.category)) return null;
  return {
    eventId: id(row.eventId),
    sessionId: id(row.sessionId),
    sequence: Number(row.sequence),
    at: Number(row.at),
    monoMs: Number.isFinite(row.monoMs) ? Math.max(0, Math.min(1e15, Number(row.monoMs))) : 0,
    level: ['debug', 'info', 'warn', 'error'].includes(String(row.level))
      ? (row.level as RuntimeEvent['level'])
      : 'info',
    category: row.category as RuntimeCategory,
    code: id(row.code),
    message: sanitizeErrorReportText(row.message, 2000) || id(row.code),
    route: sanitizeErrorReportPath(row.route) || '/',
    operationId: id(row.operationId),
    version: sanitizeErrorReportText(row.version, 32) || 'unknown',
    build: sanitizeErrorReportText(row.build, 64) || '',
    context: sanitizeErrorReportRecord(row.context, 32) || {},
  };
}
export function runtimeId(prefix = 'op'): string {
  return `${prefix}_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '_' + Math.random().toString(36).slice(2)}`;
}
export function runtimeCategory(code: string): RuntimeCategory {
  const prefix = code.split('.')[0];
  return (RUNTIME_CATEGORIES as readonly string[]).includes(prefix)
    ? (prefix as RuntimeCategory)
    : prefix === 'api' || prefix === 'net'
      ? 'network'
      : 'page';
}
