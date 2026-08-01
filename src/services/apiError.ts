import { reportError } from './errorReport';

export type ApiErrorDetail = {
  status: number;
  code: string;
  message: string;
  requestId?: string;
  retryable: boolean;
  field?: string;
  /** 服务端返回的缺少的权限字段，用于前端展示可操作信息 */
  permission?: string;
  /** 服务端返回的数据库操作类型，如 read/write/transaction */
  operation?: string;
};

export class ApiError extends Error {
  status: number;
  code: string;
  requestId?: string;
  retryable: boolean;
  field?: string;
  permission?: string;
  operation?: string;

  constructor(detail: ApiErrorDetail) {
    super(detail.message);
    this.name = 'ApiError';
    this.status = detail.status;
    this.code = detail.code;
    this.requestId = detail.requestId;
    this.retryable = detail.retryable;
    this.field = detail.field;
    this.permission = detail.permission;
    this.operation = detail.operation;
  }
}

// ── 默认错误消息表（V3：仅作兜底，不再覆盖服务端返回的具体原因）──────────────
const DEFAULT_MESSAGES: Record<string, string> = {
  // 数据库 — 配置类（不可重试）
  DATABASE_NOT_CONFIGURED:   '服务器尚未配置数据库连接，请在 Vercel 中检查 DATABASE_URL。',
  DATABASE_AUTH_FAILED:      '数据库连接配置无效，请检查服务器环境变量。',
  DATABASE_SCHEMA_MISMATCH:  '数据库结构与当前版本不兼容，请重新部署最新版本完成数据库升级。',

  // 数据库 — 可重试
  DATABASE_UNAVAILABLE:      '暂时无法连接数据库，本机数据已保留，恢复后会自动重试。',
  DATABASE_TIMEOUT:          '数据库响应超时，本机数据已保留，请稍后重试。',
  DATABASE_READ_FAILED:      '读取数据库失败，当前可能显示最近一次缓存数据。',
  DATABASE_WRITE_FAILED:     '写入数据库失败，服务端变更未完成。',
  DATABASE_TRANSACTION_FAILED: '数据库操作未完成，服务端变更已回滚。',
  DATABASE_POOL_EXHAUSTED:   '服务器连接繁忙，请稍后重试。',
  DATABASE_CONFLICT:         '操作遇到并发冲突，已自动回滚，请重试。',
  RATE_LIMITED:              '其他设备正在保存数据，系统将很快自动重试。',

  // 验证 / 权限 / 会话
  ALREADY_INITIALIZED:       '云端已经完成初始化，请在年级与班级页面调整学校结构。',
  PERMISSION_DENIED:         '当前账号没有执行此操作的权限。',
  PASSWORD_CHANGE_REQUIRED:  '当前账号需要先完成密码修改，才能继续编辑。',
  AUTH_EXPIRED:              '登录状态已失效，请重新登录。',
  INVALID_CREDENTIALS:       '用户名或密码不正确，请重新输入。',
  RECOVERY_FAILED:           '账户恢复信息不正确，请核对用户名与恢复密钥。',

  // 网络
  NETWORK_UNAVAILABLE: '无法连接服务器，请检查网络后重试。',
  NETWORK_TIMEOUT:     '请求超时，请检查网络连接或稍后重试。',

  // 业务
  DATA_CONFLICT:          '本机数据与云端版本冲突，系统将自动合并，请稍候。',
  INVALID_RESPONSE:       '服务器返回了无效数据，请刷新后重试。',
  VIEWER_CLASS_REQUIRED:  '看板尚未绑定有效班级，请先完成设备绑定。',
  CLASS_DEVICE_EXISTS:    '该班级已绑定其他考试端设备。',
  MERGE_FAILED:           '本地数据与云端数据合并失败，将在下次重试。',
  UNEXPECTED_ERROR:       '发生了意外错误，请刷新页面后重试。',

  // HTTP 兜底
  HTTP_400: '请求参数有误，请刷新页面后重试。',
  HTTP_403: '当前账号没有执行此操作的权限。',
  HTTP_404: '请求的资源不存在，请刷新页面。',
  HTTP_500: '服务器内部错误，请稍后重试。',
  HTTP_502: '服务暂时不可用（502），请稍后重试。',
  HTTP_503: '服务暂时不可用（503），请稍后重试。',
  HTTP_504: '服务器响应超时（504），请稍后重试。',
};

// ── 根据错误码附加用户下一步行动指引 ──────────────────────────────────
function getActionHint(error: ApiError): string {
  switch (error.code) {
    case 'AUTH_EXPIRED':              return ' 请重新登录。';
    case 'PASSWORD_CHANGE_REQUIRED':  return ' 请前往账号设置完成密码修改后再试。';
    case 'CLASS_DEVICE_EXISTS':       return ' 可先在设备管理中解绑原设备后重试。';
    case 'PERMISSION_DENIED':         return ' 请联系系统管理员。';
    case 'DATABASE_NOT_CONFIGURED':   return ' 请在 Vercel 检查 DATABASE_URL 环境变量。';
    case 'DATABASE_SCHEMA_MISMATCH':  return ' 请重新部署最新版本完成数据库升级。';
    case 'DATABASE_AUTH_FAILED':      return ' 请检查 Vercel 项目中的数据库环境变量。';
    default:
      return error.retryable ? ' 可稍后重试。' : '';
  }
}

function isStabilityIssue(status: number, code: string): boolean {
  if (status === 0 || status >= 500) return true;
  if (code.startsWith('DATABASE_')) return true;
  return code === 'UNEXPECTED_ERROR' || code === 'INVALID_RESPONSE' || code === 'MERGE_FAILED' || code === 'DATA_CONFLICT';
}

function reportIfStabilityIssue(error: ApiError, apiEndpoint?: string): void {
  if (!isStabilityIssue(error.status, error.code)) return;
  void reportError({
    message: error.message,
    errorName: error.code,
    level: 'error',
    apiEndpoint,
    httpStatus: error.status,
    context: { requestId: error.requestId, operation: error.operation },
  });
}

export async function apiErrorFromResponse(response: Response, fallback: string): Promise<ApiError> {
  const data = await response.json().catch(() => null);
  const code = typeof data?.code === 'string'
    ? data.code
    : response.status === 401 ? 'AUTH_EXPIRED'
    : response.status === 403 ? 'PERMISSION_DENIED'
    : `HTTP_${response.status}`;

  const serverMessage = typeof data?.error === 'string' ? data.error : '';

  // ── V3 核心修复：权限不足时提示真实原因 ────────────────────────────
  // 服务端返回的具体中文业务原因（如「周测计划超出当前账号的班级管理范围」）
  // 必须优先展示。旧逻辑中 DEFAULT_MESSAGES[code] 会把所有 PERMISSION_DENIED
  // 统一覆盖为笼统提示，用户永远看不到真实不足的原因。
  // DEFAULT_MESSAGES 现在仅用于：英文消息（如 'Forbidden'）或空消息时的兜底。
  const hasSpecificServerMessage = /[\u4e00-\u9fa5]/.test(serverMessage);
  const base = hasSpecificServerMessage
    ? serverMessage
    : (DEFAULT_MESSAGES[code] || serverMessage || fallback);

  const permission = typeof data?.permission === 'string' ? data.permission : undefined;
  const requestId = typeof data?.requestId === 'string'
    ? data.requestId
    : response.headers.get('X-Request-Id') || undefined;
  const operation = typeof data?.operation === 'string' ? data.operation : undefined;

  const error = new ApiError({
    status: response.status,
    code,
    message: base,
    requestId,
    retryable: data?.retryable === true || response.status >= 500,
    field: typeof data?.field === 'string' ? data.field : undefined,
    permission,
    operation,
  });
  reportIfStabilityIssue(error, response.url || undefined);
  return error;
}

export function networkApiError(fallback = '无法连接服务器，请检查网络后重试。'): ApiError {
  const error = new ApiError({ status: 0, code: 'NETWORK_UNAVAILABLE', message: fallback, retryable: true });
  reportIfStabilityIssue(error);
  return error;
}

export function timeoutApiError(fallback = '请求超时，请检查网络连接或稍后重试。'): ApiError {
  const error = new ApiError({ status: 0, code: 'NETWORK_TIMEOUT', message: fallback, retryable: true });
  reportIfStabilityIssue(error);
  return error;
}

/**
 * 格式化 API 错误为用户可读字符串。
 * 包含：操作上下文、错误消息（服务端真实原因优先）、缺失权限、下一步行动、请求 ID。
 */
export function formatApiError(error: unknown, context?: string): string {
  if (!(error instanceof ApiError)) {
    const msg = error instanceof Error ? error.message : '发生未知错误';
    return context ? `${context}：${msg}` : msg;
  }

  const hint = getActionHint(error);
  // 权限字段仅当消息中尚未体现时追加，避免重复
  const permission = error.permission && !error.message.includes(error.permission)
    ? `（需要权限：${error.permission}）` : '';
  const rid = error.requestId ? `（请求 ID：${error.requestId}）` : '';

  return `${context ? `${context}：` : ''}${error.message}${permission}${hint}${rid}`.trim();
}

/** 同步错误的通知标题：按错误码细分，避免所有错误都显示「同步失败」。 */
export function getSyncNotifyTitle(code?: string): string {
  if (!code) return '同步失败';
  if (code.startsWith('DATABASE_')) return '数据库同步失败';
  if (code.startsWith('NETWORK_')) return '网络连接失败';
  if (code === 'PERMISSION_DENIED') return '权限不足';
  if (code === 'PASSWORD_CHANGE_REQUIRED') return '需要修改密码';
  if (code === 'AUTH_EXPIRED') return '登录已失效';
  if (code === 'DATA_CONFLICT') return '数据冲突';
  if (code === 'CLASS_DEVICE_EXISTS') return '设备冲突';
  if (code === 'ALREADY_INITIALIZED') return '已初始化';
  if (code === 'RATE_LIMITED') return '多设备同步繁忙';
  return '同步失败';
}
