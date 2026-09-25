import type { LoginFailureAlert } from '../shared/authContracts.js';
import type { AdminScope } from './examService';
import { getAuthToken } from './auth/session';

export type ManagedUser = {
  id: number;
  username: string;
  displayName: string;
  roleId: string;
  roleName: string;
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
  lastLoginAt: number | null;
  createdAt: number;
  scopes: AdminScope[];
};

export type ManagedRole = {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  builtIn: boolean;
  createdAt: number;
  updatedAt: number;
};

export type AuditLog = {
  id: number;
  userId: number | null;
  username: string;
  action: string;
  resourceType: string;
  resourceId: string;
  gradeId: string;
  classId: string;
  detail: unknown;
  createdAt: number;
};

function parseScopes(data: unknown): AdminScope[] | null {
  if (!Array.isArray(data)) return null;
  const scopes: AdminScope[] = [];
  for (const scope of data) {
    const s = scope && typeof scope === 'object' ? (scope as Record<string, unknown>) : null;
    if (!s || (s.type !== 'all' && s.type !== 'grade' && s.type !== 'class')) return null;
    if (typeof s.gradeId !== 'string' || typeof s.classId !== 'string') return null;
    scopes.push({ type: s.type, gradeId: s.gradeId, classId: s.classId });
  }
  return scopes;
}

function parseManagedUser(data: unknown): ManagedUser | null {
  if (!data || typeof data !== 'object') return null;
  const u = data as Record<string, unknown>;
  if (typeof u.id !== 'number' || !Number.isFinite(u.id)) return null;
  if (typeof u.username !== 'string' || typeof u.displayName !== 'string') return null;
  if (typeof u.roleId !== 'string' || typeof u.roleName !== 'string') return null;
  if (u.status !== 'active' && u.status !== 'disabled') return null;
  const scopes = parseScopes(u.scopes);
  if (!scopes) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    roleId: u.roleId,
    roleName: u.roleName,
    status: u.status,
    mustChangePassword: u.mustChangePassword === true,
    lastLoginAt: typeof u.lastLoginAt === 'number' && Number.isFinite(u.lastLoginAt) ? u.lastLoginAt : null,
    createdAt: typeof u.createdAt === 'number' && Number.isFinite(u.createdAt) ? u.createdAt : 0,
    scopes,
  };
}

function parseManagedRole(data: unknown): ManagedRole | null {
  if (!data || typeof data !== 'object') return null;
  const r = data as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || typeof r.name !== 'string' || typeof r.description !== 'string') return null;
  if (!Array.isArray(r.permissions) || !r.permissions.every((p) => typeof p === 'string')) return null;
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    permissions: r.permissions,
    builtIn: r.builtIn === true,
    createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : 0,
    updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0,
  };
}

function parseAuditLog(data: unknown): AuditLog | null {
  if (!data || typeof data !== 'object') return null;
  const a = data as Record<string, unknown>;
  if (typeof a.id !== 'number' || !Number.isFinite(a.id)) return null;
  if (typeof a.username !== 'string' || typeof a.action !== 'string') return null;
  if (typeof a.resourceType !== 'string' || typeof a.resourceId !== 'string') return null;
  if (typeof a.gradeId !== 'string' || typeof a.classId !== 'string') return null;
  return {
    id: a.id,
    userId: typeof a.userId === 'number' && Number.isFinite(a.userId) ? a.userId : null,
    username: a.username,
    action: a.action,
    resourceType: a.resourceType,
    resourceId: a.resourceId,
    gradeId: a.gradeId,
    classId: a.classId,
    detail: a.detail,
    createdAt: typeof a.createdAt === 'number' && Number.isFinite(a.createdAt) ? a.createdAt : 0,
  };
}

function parseList<T>(data: unknown, parse: (item: unknown) => T | null): T[] {
  if (!Array.isArray(data)) return [];
  return data.map(parse).filter((item): item is T => item !== null);
}

function parseStringList(data: unknown): string[] {
  return Array.isArray(data) ? data.filter((p): p is string => typeof p === 'string') : [];
}

export class AdminApiError extends Error {
  field?: string;
  code?: string;
  requestId?: string;
  retryAfterMs?: number;
  constructor(message: string, field?: string, code?: string, requestId?: string, retryAfterMs?: number) {
    super(`${message}${requestId ? `（请求 ID：${requestId}）` : ''}`);
    this.name = 'AdminApiError';
    this.field = field;
    this.code = code;
    this.requestId = requestId;
    this.retryAfterMs = retryAfterMs;
  }
}

async function request(path: string, init: RequestInit = {}, bearerToken?: string) {
  const authToken = bearerToken ?? getAuthToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok)
    throw new AdminApiError(
      data?.error || `HTTP ${response.status}`,
      data?.field,
      data?.code,
      data?.requestId || response.headers.get('X-Request-Id') || undefined,
      data?.retryAfterMs,
    );
  return data;
}

export async function fetchUserManagement(): Promise<{
  users: ManagedUser[];
  roles: ManagedRole[];
  permissions: string[];
}> {
  const data = await request('/api/users');
  return {
    users: parseList(data.users, parseManagedUser),
    roles: parseList(data.roles, parseManagedRole),
    permissions: parseStringList(data.permissions),
  };
}

export async function saveManagedUser(input: Record<string, unknown>): Promise<ManagedUser[]> {
  const data = await request('/api/users', { method: 'POST', body: JSON.stringify({ resource: 'users', ...input }) });
  return parseList(data.users, parseManagedUser);
}

export async function resetManagedUserPassword(id: number, password: string): Promise<void> {
  await request('/api/users', {
    method: 'POST',
    body: JSON.stringify({ resource: 'users', action: 'reset-password', id, password }),
  });
}

export async function deleteManagedUser(id: number): Promise<ManagedUser[]> {
  const data = await request('/api/users', {
    method: 'POST',
    body: JSON.stringify({ resource: 'users', action: 'delete', id }),
  });
  return parseList(data.users, parseManagedUser);
}

export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
  await request('/api/users', {
    method: 'POST',
    body: JSON.stringify({ resource: 'users', action: 'change-own-password', currentPassword, newPassword }),
  });
}

export async function changeOwnUsername(currentPassword: string, username: string): Promise<void> {
  await request('/api/users', {
    method: 'POST',
    body: JSON.stringify({ resource: 'users', action: 'change-own-username', currentPassword, username }),
  });
}

export async function changeOwnCredentials(
  currentPassword: string,
  username: string,
  newPassword: string,
  bearerToken?: string,
): Promise<string> {
  const data = await request(
    '/api/users',
    {
      method: 'POST',
      body: JSON.stringify({
        resource: 'users',
        action: 'change-own-credentials',
        currentPassword,
        username,
        newPassword,
      }),
    },
    bearerToken,
  );
  return String(data.username || username);
}

export async function saveManagedRole(input: {
  id?: string;
  name: string;
  description: string;
  permissions: string[];
}): Promise<ManagedRole[]> {
  const data = await request('/api/users', {
    method: 'POST',
    body: JSON.stringify({ resource: 'roles', action: 'save', ...input }),
  });
  return parseList(data.roles, parseManagedRole);
}

export async function deleteManagedRole(id: string): Promise<ManagedRole[]> {
  const data = await request('/api/users', {
    method: 'POST',
    body: JSON.stringify({ resource: 'roles', action: 'delete', id }),
  });
  return parseList(data.roles, parseManagedRole);
}

export async function fetchAuditLogs(): Promise<AuditLog[]> {
  const data = await request('/api/users?resource=audit');
  return parseList(data.logs, parseAuditLog);
}

export async function fetchAuditOverview(): Promise<{ logs: AuditLog[]; loginFailureAlerts: LoginFailureAlert[] }> {
  const data = await request('/api/users?resource=audit');
  return {
    logs: parseList(data.logs, parseAuditLog),
    loginFailureAlerts: parseList(data.loginFailureAlerts, (item) => {
      if (!item || typeof item !== 'object') return null;
      const l = item as Record<string, unknown>;
      if (typeof l.username !== 'string') return null;
      if (typeof l.failureCount !== 'number' || !Number.isFinite(l.failureCount)) return null;
      if (typeof l.windowStart !== 'number' || typeof l.latestFailureAt !== 'number') return null;
      return {
        username: l.username,
        failureCount: l.failureCount,
        windowStart: l.windowStart,
        latestFailureAt: l.latestFailureAt,
      };
    }),
  };
}
