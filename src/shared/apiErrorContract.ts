// 服务端错误响应的线格式（wire format）。api/_apiError.ts 构造错误响应、
// src/services/apiError.ts 解析错误响应时共用这份定义。

export type ApiErrorResponse = {
  ok: false;
  code: string;
  error: string;
  retryable?: boolean;
  requestId?: string;
  operation?: string;
  permission?: string;
  field?: string;
  retryAfterMs?: number;
};
