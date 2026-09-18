/**
 * 识别「请求被主动取消」产生的错误。
 *
 * 组件卸载、路由切换时用 AbortController 取消未完成的 fetch 属于正常控制流，不该
 * 被当成程序缺陷。但发起请求的 Promise 链必须自己接住它，否则会冒泡成
 * unhandledrejection —— 线上就据此上报过
 * `AbortError: signal is aborted without reason`（栈顶在 DashboardPanel）。
 */
const ABORT_MESSAGES = ['signal is aborted without reason', 'the user aborted a request', 'the operation was aborted'];

function matchesAbortText(text: string): boolean {
  const lower = text.toLowerCase();
  return ABORT_MESSAGES.some((pattern) => lower.includes(pattern));
}

export function isAbortError(error: unknown): boolean {
  if (typeof error === 'string') return matchesAbortText(error);
  if (!error || typeof error !== 'object') return false;
  const record = error as { name?: unknown; message?: unknown };
  // AbortSignal.timeout() 产生的是 TimeoutError，语义是超时而不是主动取消。
  if (String(record.name || '') === 'AbortError') return true;
  return typeof record.message === 'string' && matchesAbortText(record.message);
}
