// src/services/auth/session.ts
// 前端会话凭据的唯一来源：存储键、读写、过期判定、请求头拼装、401 处理。
//
// 以前 'admin_auth_token' 这个字面量散在 10 个 src 文件里——每个文件各拼一次
// Authorization、各写一份过期判断、401 处理也各写各的；换存储位置或加一种凭据
// （设备密钥、refresh token）都得满地找。现在只有本模块认识存储键，调用方一律走
// getAuthToken() / authHeaders() / apiFetch() / storeAuthSession() / clearAuthSession()。
//
// 依赖方向：本模块**只碰 localStorage**，不导入任何其它应用模块（连带 fetchWithTimeout 也不导入，
// 否则会顺着 diagnostics → telemetry 把浏览器构建期常量拉进纯 node 的单测里）。
// 带鉴权的网络入口在 ./client.ts，它反过来依赖本模块；examService 也依赖本模块，不形成环。

/**
 * 会话令牌在 localStorage 的键。
 *
 * 它是与**已上线客户端**的兼容契约：老版本前端按这个键读写。改名会让所有用户掉线，
 * 因此由 tests/authSessionSingleSource.test.ts 把字面量锁死。
 */
export const AUTH_TOKEN_KEY = 'admin_auth_token';
/** 「年级管理员首次登录需要改用户名/密码」的提示位；logoutAdmin 历史上不动它。 */
export const GRADE_ADMIN_FIRST_LOGIN_KEY = 'novora_grade_admin_first_login';

const AUTH_TOKEN_EXPIRES_KEY = 'admin_auth_token_expires';
const AUTH_USER_KEY = 'admin_user_context';

/** 会话里与鉴权有关的用户字段（完整上下文与校验仍由 examService 负责）。 */
export type SessionUser = { id: number; roleId: string };

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 当前令牌；没有会话时返回空串（调用方普遍按 falsy 判断）。 */
export function getAuthToken(): string {
  const store = storage();
  if (!store) return '';
  try {
    return store.getItem(AUTH_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * 带鉴权的请求头。
 *
 * `extra` **始终**并入（例如幂等键、Cache-Control），只有会话存在时才附加 Authorization——
 * 否则「没登录」会顺带把调用方自己带的头也吞掉。
 */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** 写入会话令牌与过期时间，并（可选）写入用户上下文与首次登录提示位。 */
export function storeAuthSession(
  token: string | null,
  expiresAt: number,
  user: SessionUser | null,
  firstLogin = false,
): void {
  const store = storage();
  if (!store) return;
  try {
    if (token) {
      store.setItem(AUTH_TOKEN_KEY, token);
      store.setItem(AUTH_TOKEN_EXPIRES_KEY, String(expiresAt ?? 0));
    }
    if (user) {
      writeSessionUser(user);
      if (firstLogin === true && user.roleId === 'grade_admin')
        store.setItem(GRADE_ADMIN_FIRST_LOGIN_KEY, String(user.id));
    }
  } catch {
    /* 存储不可用（隐私模式/配额）时不影响调用方流程 */
  }
}

/** 只更新用户上下文，不动令牌。 */
export function writeSessionUser(user: SessionUser): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(AUTH_USER_KEY, JSON.stringify(user));
  } catch {
    /* 同上 */
  }
}

/** 读取用户上下文原文；形状校验交给调用方（examService.parseAdminUserContext）。 */
export function readSessionUserRaw(): unknown {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(AUTH_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getAuthExpiresAt(): number {
  const store = storage();
  if (!store) return 0;
  try {
    return Number(store.getItem(AUTH_TOKEN_EXPIRES_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** 本地会话是否仍在有效期内；过期时顺手清掉（与旧 hasValidLocalToken 一致：过期即登出）。 */
export function hasValidLocalSession(): boolean {
  if (!getAuthToken()) return false;
  const expires = getAuthExpiresAt();
  if (expires && Date.now() > expires) {
    clearAuthSession();
    return false;
  }
  return true;
}

/**
 * 清掉令牌、过期时间与用户上下文。
 *
 * 不动「年级管理员首次登录」提示位（与旧 logoutAdmin 行为一致）。
 * 在途请求合并表由调用方（examService.logoutAdmin）负责清，避免本模块依赖 fetchWithTimeout。
 */
export function clearAuthSession(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(AUTH_TOKEN_KEY);
    store.removeItem(AUTH_TOKEN_EXPIRES_KEY);
    store.removeItem(AUTH_USER_KEY);
  } catch {
    /* 同上 */
  }
}
