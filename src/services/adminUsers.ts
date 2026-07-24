import type { AdminScope } from './examService';

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

const token = () => localStorage.getItem('admin_auth_token') || '';

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(init.headers || {}) },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export async function fetchUserManagement(): Promise<{ users: ManagedUser[]; roles: ManagedRole[]; permissions: string[] }> {
  return request('/api/users');
}

export async function saveManagedUser(input: Record<string, unknown>): Promise<ManagedUser[]> {
  const data = await request('/api/users', { method: 'POST', body: JSON.stringify({ resource: 'users', ...input }) });
  return data.users || [];
}

export async function resetManagedUserPassword(id: number, password: string): Promise<void> {
  await request('/api/users', { method: 'POST', body: JSON.stringify({ resource: 'users', action: 'reset-password', id, password }) });
}

export async function saveManagedRole(input: { id?: string; name: string; description: string; permissions: string[] }): Promise<ManagedRole[]> {
  const data = await request('/api/users', { method: 'POST', body: JSON.stringify({ resource: 'roles', action: 'save', ...input }) });
  return data.roles || [];
}

export async function deleteManagedRole(id: string): Promise<ManagedRole[]> {
  const data = await request('/api/users', { method: 'POST', body: JSON.stringify({ resource: 'roles', action: 'delete', id }) });
  return data.roles || [];
}

export async function fetchAuditLogs(): Promise<AuditLog[]> {
  const data = await request('/api/users?resource=audit');
  return data.logs || [];
}
