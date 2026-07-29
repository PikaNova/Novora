export type ApiErrorDetail = {
  status: number;
  code: string;
  message: string;
  requestId?: string;
  retryable: boolean;
  field?: string;
  // 后端可能返回缺失的 permission 字段，前端用以展示更友好的提示
  permission?: string;
};

export class ApiError extends Error {
  status: number;
  code: string;
  requestId?: string;
  retryable: boolean;
  field?: string;
  permission?: string;

  constructor(detail: ApiErrorDetail) {
    super(detail.message);
    this.name = 'ApiError';
    this.status = detail.status;
    this.code = detail.code;
    this.requestId = detail.requestId;
    this.retryable = detail.retryable;
    this.field = detail.field;
    this.permission = detail.permission;
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
  PERMISSION_DENIED: '当前账号没有执行此操作的权限。请确认是否使用了具有相应管理权限的账号或联系系统管理员。',
  AUTH_EXPIRED: '登录状态已失效，请重新登录。',
};

export async function apiErrorFromResponse(response: Response, fallback: string): Promise<ApiError> {
  const data = await response.json().catch(() => null);
  const code = typeof data?.code === 'string'
    ? data.code
    : response.status === 401 ? 'AUTH_EXPIRED'
      : response.status === 403 ? 'PERMISSION_DENIED'
        : `HTTP_${response.status}`;

  let base = DEFAULT_MESSAGES[code] || (typeof data?.error === 'string' ? data.error : fallback);

  // 如果后端返回了更具体的 permission 字段，附加到用户提示中，便于前端展示可操作信息
  const permission = typeof data?.permission === 'string' ? data.permission : undefined;
  if (code === 'PERMISSION_DENIED' && permission) {
    base = `${base}（需要权限：${permission}）`;
  }

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
    permission,
  });
}

export function networkApiError(fallback = '无法连接服务器，请检查网络后重试。'): ApiError {
  return new ApiError({ status: 0, code: 'NETWORK_UNAVAILABLE', message: fallback, retryable: true });
}

export function formatApiError(error: unknown, context?: string): string {
  const message = error instanceof Error ? error.message : '发生未知错误';
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  const permission = error instanceof ApiError ? error.permission : undefined;
  // 如果是权限错误，给出明确的下一步建议
  const extra = permission ? ` 请确认你的账号是否拥有“${permission}”权限，或联系系统管理员。` : '';
  return `${context ? `${context}：` : ''}${message}${extra}${requestId ? `（请求 ID：${requestId}）` : ''}`;
}
