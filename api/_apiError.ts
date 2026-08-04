import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export type DatabaseOperation = 'connect' | 'read' | 'write' | 'transaction' | 'schema';

type ClassifiedError = {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
};

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error ?? 'Unknown database error');
}

export function classifyDatabaseError(error: unknown, operation: DatabaseOperation): ClassifiedError {
  const raw = errorText(error);
  const text = raw.toLowerCase();
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';

  // ── 配置类（不可重试）────────────────────────────────────────────
  if (/database_url is not set|missing.*database_url/.test(text)) {
    return { status: 503, code: 'DATABASE_NOT_CONFIGURED', message: '服务器尚未配置数据库连接，请在 Vercel 检查 DATABASE_URL 环境变量', retryable: false };
  }
  if (/password authentication failed|authentication failed|invalid.*credential|28p01/.test(`${text} ${code}`)) {
    return { status: 503, code: 'DATABASE_AUTH_FAILED', message: '数据库连接配置无效，请检查服务器环境变量', retryable: false };
  }
  if (/does not exist|undefined_table|undefined_column|42p01|42703/.test(`${text} ${code}`)) {
    return { status: 503, code: 'DATABASE_SCHEMA_MISMATCH', message: '数据库结构与当前版本不兼容，请重新部署最新版本完成数据库升级', retryable: false };
  }

  // ── 超时（可重试）───────────────────────────────────────────────
  if (/timeout|timed out|statement_timeout|57014|504/.test(`${text} ${code}`)) {
    return { status: 504, code: 'DATABASE_TIMEOUT', message: '数据库响应超时，请稍后重试', retryable: true };
  }

  // ── 连接池耗尽 / 资源不足（Neon Serverless 高并发时常见，可重试）──
  if (/53300|53000/.test(code)) {
    return { status: 503, code: 'DATABASE_POOL_EXHAUSTED', message: '数据库连接池已满，请稍后重试', retryable: true };
  }

  // ── 并发事务冲突 / 死锁（可安全重试）────────────────────────────
  if (/40001|40p01/.test(code)) {
    return { status: 409, code: 'DATABASE_CONFLICT', message: '操作遇到并发冲突，已自动回滚，请重试', retryable: true };
  }

  // ── 数据库正在关闭 / 连接中断（可重试）──────────────────────────
  if (/57p04|08006|08001/.test(code)) {
    return { status: 503, code: 'DATABASE_UNAVAILABLE', message: '数据库连接已中断，请稍后重试', retryable: true };
  }

  // ── 通用网络 / 连接失败（可重试）────────────────────────────────
  if (/fetch failed|econnreset|econnrefused|enotfound|getaddrinfo|connection|socket|network|terminated|57p0[13]/.test(`${text} ${code}`)) {
    return { status: 503, code: 'DATABASE_UNAVAILABLE', message: '暂时无法连接数据库，本机数据不会因此被清除', retryable: true };
  }

  // ── 按操作类型的兜底（operation-aware fallback）────────────────
  const byOperation: Record<DatabaseOperation, ClassifiedError> = {
    connect:     { status: 503, code: 'DATABASE_UNAVAILABLE',         message: '暂时无法连接数据库，请稍后重试',           retryable: true  },
    read:        { status: 500, code: 'DATABASE_READ_FAILED',         message: '数据库读取失败，请稍后重试',               retryable: true  },
    write:       { status: 500, code: 'DATABASE_WRITE_FAILED',        message: '数据库写入失败，服务端变更未完成',          retryable: true  },
    transaction: { status: 500, code: 'DATABASE_TRANSACTION_FAILED', message: '数据库操作未完成，变更已回滚',             retryable: true  },
    schema:      { status: 503, code: 'DATABASE_SCHEMA_MISMATCH',    message: '数据库结构升级失败，请重新部署最新版本',    retryable: false },
  };
  return byOperation[operation];
}

export function requestId(req: VercelRequest, res: VercelResponse): string {
  const existing = res.getHeader('X-Request-Id');
  if (typeof existing === 'string' && existing) return existing;
  const incoming = req.headers['x-request-id'] ?? req.headers['x-vercel-id'];
  const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

export function sendDatabaseError(
  req: VercelRequest,
  res: VercelResponse,
  error: unknown,
  operation: DatabaseOperation,
): void {
  const id = requestId(req, res);
  const classified = classifyDatabaseError(error, operation);
  console.error(`[${id}] ${classified.code} (${operation})`, error);
  res.status(classified.status).json({
    ok: false,
    code: classified.code,
    error: classified.message,
    operation,
    retryable: classified.retryable,
    requestId: id,
  });
}

export function sendRateLimited(
  req: VercelRequest,
  res: VercelResponse,
  retryAfterSeconds = 1,
): void {
  const id = requestId(req, res);
  res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterSeconds))));
  res.status(429).json({
    ok: false,
    code: "RATE_LIMITED",
    error: "其他设备正在保存数据，系统将很快自动重试。",
    retryable: true,
    requestId: id,
  });
}
