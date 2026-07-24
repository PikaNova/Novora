export type ApiErrorDetail = {
  status: number;
  code: string;
  message: string;
  requestId?: string;
  retryable: boolean;
  field?: string;
};

export class ApiError extends Error {
  status: number;
  code: string;
  requestId?: string;
  retryable: boolean;
  field?: string;

  constructor(detail: ApiErrorDetail) {
    super(detail.message);
    this.name = 'ApiError';
    this.status = detail.status;
    this.code = detail.code;
    this.requestId = detail.requestId;
    this.retryable = detail.retryable;
    this.field = detail.field;
  }
}

const DEFAULT_MESSAGES: Record<string, string> = {
  DATABASE_NOT_CONFIGURED: '服务器尚未配置数据库连接，请在 Vercel 中检查 DATABASE_URL。',
  DATABASE_UNAVAILABLE: '暂时无法连接数据库，本机数据已保留，恢复后会自动重试。',
  DATABASE_TIMEOUT: '数据库响应超时，本机数据已保留，请稍后重试。',
  DATABASE_AUTH_FAILED: '数据库连接配置无效，请检查服务器环境变量。',
  DATABASE_SCHEMA_MISMATCH: '数据库结构与当前版本不兼容，请完成数据库升级。',
  DATABASE_READ_FAILED: '读取数据库失败，当前可能显示最近一次缓存数据。',
  DATABASE_WRITE_FAILED: '写入数据库失败，本机修改已保留。',
  DATABASE_TRANSACTION_FAILED: '数据库操作未完成，服务器端变更已回滚。',
  ALREADY_INITIALIZED: '云端已经完成初始化，请在年级与班级页面调整学校结构。',
  PERMISSION_DENIED: '当前账号没有执行此操作的权限。',
  AUTH_EXPIRED: '登录状态已失效，请重新登录。',
};

export async function apiErrorFromResponse(response: Response, fallback: string): Promise<ApiError> {
  const data = await response.json().catch(() => null);
  const code = typeof data?.code === 'string'
    ? data.code
    : response.status === 401 ? 'AUTH_EXPIRED'
      : response.status === 403 ? 'PERMISSION_DENIED'
        : `HTTP_${response.status}`;
  const base = DEFAULT_MESSAGES[code] || (typeof data?.error === 'string' ? data.error : fallback);
  const requestId = typeof data?.requestId === 'string'
    ? data.requestId
    : response.headers.get('X-Request-Id') || undefined;
  return new ApiError({
    status: response.status,
    code,
    message: base,
    requestId,
    retryable: data?.retryable === true || response.status >= 500,
    field: typeof data?.field === 'string' ? data.field : undefined,
  });
}

export function networkApiError(fallback = '无法连接服务器，请检查网络后重试。'): ApiError {
  return new ApiError({ status: 0, code: 'NETWORK_UNAVAILABLE', message: fallback, retryable: true });
}

export function formatApiError(error: unknown, context?: string): string {
  const message = error instanceof Error ? error.message : '发生未知错误';
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return `${context ? `${context}：` : ''}${message}${requestId ? `（请求 ID：${requestId}）` : ''}`;
}
