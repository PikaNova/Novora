// 合并入口的二级路由解析。
//
// Vercel 把 api/ 目录当成「一个文件 = 一个 Serverless Function」，Hobby 单次部署上限 12 个，
// 所以多个对外 URL 会合并进同一个入口文件，再用 vercel.json 的 rewrite 把原路径指过去
// （例如 /api/time → /api/system?sys=time）。对外 URL 与响应契约都不变。
//
// 两种部署形态看到的请求不同，必须同时兼容：
// - Vercel：函数收到的是 rewrite 目标，路由名在查询串里（?sys=…）。
// - 本地 / 内网（server/routes.ts）：直接映射到模块并保留原始 URL，路由名在路径末段。
export function resolveSubRoute(
  req: { query?: unknown; url?: unknown },
  param: string,
  allowed: readonly string[],
): string {
  const query = (req.query ?? {}) as Record<string, unknown>;
  const rawFromQuery = query[param];
  const fromQuery = String(Array.isArray(rawFromQuery) ? rawFromQuery[0] : (rawFromQuery ?? ''));
  if (allowed.includes(fromQuery)) return fromQuery;
  const pathname = String(req.url ?? '')
    .split('?')[0]
    .replace(/\/+$/, '');
  const segment = pathname.split('/').pop() ?? '';
  return allowed.includes(segment) ? segment : '';
}
