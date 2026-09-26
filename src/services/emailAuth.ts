// 邮箱验证码登录 / 绑定 / SMTP 配置前端服务。
// 统一走 /api/login 的 action 分发，错误抛 AdminApiError（含 code/retryAfterMs 可解析）。
import { fetchWithTimeout } from './fetchWithTimeout';
import { AdminApiError } from './adminUsers';
import { getAuthToken } from './auth/session';

const LOGIN_URL = '/api/login';
const BIND_POLICIES = ['optional', 'force', 'skip'] as const;
export type EmailBindPolicy = (typeof BIND_POLICIES)[number];

export type EmailConfigInfo = {
  enabled: boolean;
  initBindPolicy: EmailBindPolicy;
  email: string | null;
};

export type EmailConfigFull = EmailConfigInfo & {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpRequireTls: boolean;
  smtpUser: string;
  smtpFrom: string;
  smtpFromName: string;
  adminEmails: string;
  hasPass: boolean;
};

export type EmailConfigInput = {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpRequireTls: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  smtpFromName: string;
  adminEmails: string;
  initBindPolicy: EmailBindPolicy;
};

function normalizePolicy(value: unknown): EmailBindPolicy {
  return BIND_POLICIES.includes(value as EmailBindPolicy) ? (value as EmailBindPolicy) : 'optional';
}

async function request<T = Record<string, unknown>>(
  path: string,
  init: RequestInit = {},
  bearerToken?: string,
): Promise<T> {
  const authToken = bearerToken ?? getAuthToken();
  const response = await fetchWithTimeout(
    path,
    {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(init.headers || {}),
      },
    },
    20_000,
  );
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new AdminApiError(
      data?.error || `HTTP ${response.status}`,
      data?.field,
      data?.code,
      data?.requestId || response.headers.get('X-Request-Id') || undefined,
      data?.retryAfterMs,
    );
  }
  return data as T;
}

export async function fetchEmailConfig(bearerToken?: string): Promise<EmailConfigInfo> {
  const data = await request<Record<string, unknown>>(`${LOGIN_URL}?action=email-config`, {}, bearerToken);
  return {
    enabled: data.enabled === true,
    initBindPolicy: normalizePolicy(data.initBindPolicy),
    email: typeof data.email === 'string' ? data.email : null,
  };
}

export async function fetchEmailConfigFull(bearerToken?: string): Promise<EmailConfigFull> {
  const data = await request<Record<string, unknown>>(`${LOGIN_URL}?action=email-config-full`, {}, bearerToken);
  return {
    enabled: !!data.enabled,
    initBindPolicy: normalizePolicy(data.initBindPolicy),
    email: typeof data.email === 'string' ? data.email : null,
    smtpHost: String(data.smtpHost ?? ''),
    smtpPort: Number(data.smtpPort ?? 465),
    smtpSecure: data.smtpSecure !== false,
    smtpRequireTls: data.smtpRequireTls === true,
    smtpUser: String(data.smtpUser ?? ''),
    smtpFrom: String(data.smtpFrom ?? ''),
    smtpFromName: String(data.smtpFromName ?? ''),
    adminEmails: String(data.adminEmails ?? ''),
    hasPass: data.hasPass === true,
  };
}

export async function sendEmailCode(
  email: string,
  purpose: 'login' | 'bind',
): Promise<{ queued?: boolean; message?: string }> {
  return request<{ queued?: boolean; message?: string }>(`${LOGIN_URL}`, {
    method: 'POST',
    body: JSON.stringify({ action: 'email-send-code', email, purpose }),
  });
}

export type EmailSendStatus = { status: 'none' | 'pending' | 'sent' | 'failed'; lastError?: string | null };

export async function fetchEmailSendStatus(email: string): Promise<EmailSendStatus> {
  return request<EmailSendStatus>(`${LOGIN_URL}`, {
    method: 'POST',
    body: JSON.stringify({ action: 'email-send-status', email }),
  });
}

export async function loginWithEmail(
  email: string,
  code: string,
): Promise<{
  token: string;
  expiresAt: number;
  user: { mustChangePassword?: boolean; username?: string } | null;
  firstLogin: boolean;
}> {
  return request(`${LOGIN_URL}`, { method: 'POST', body: JSON.stringify({ action: 'email-login', email, code }) });
}

export async function bindEmailRequest(email: string, bearerToken?: string): Promise<void> {
  await request(
    `${LOGIN_URL}`,
    { method: 'POST', body: JSON.stringify({ action: 'email-bind-request', email }) },
    bearerToken,
  );
}

export async function bindEmailConfirm(email: string, code: string, bearerToken?: string): Promise<void> {
  await request(
    `${LOGIN_URL}`,
    { method: 'POST', body: JSON.stringify({ action: 'email-bind-confirm', email, code }) },
    bearerToken,
  );
}

export async function unbindEmail(bearerToken?: string): Promise<void> {
  await request(`${LOGIN_URL}`, { method: 'POST', body: JSON.stringify({ action: 'email-unbind' }) }, bearerToken);
}

export async function saveEmailConfig(input: EmailConfigInput, bearerToken?: string): Promise<void> {
  await request(
    `${LOGIN_URL}`,
    { method: 'POST', body: JSON.stringify({ action: 'email-save-config', ...input }) },
    bearerToken,
  );
}

export async function clearEmailConfig(bearerToken?: string): Promise<void> {
  await request(
    `${LOGIN_URL}`,
    { method: 'POST', body: JSON.stringify({ action: 'email-clear-config' }) },
    bearerToken,
  );
}

export async function testEmailConfig(
  input: Partial<EmailConfigInput> & { testEmail: string },
  bearerToken?: string,
): Promise<void> {
  await request(
    `${LOGIN_URL}`,
    { method: 'POST', body: JSON.stringify({ action: 'email-test-config', ...input }) },
    bearerToken,
  );
}
