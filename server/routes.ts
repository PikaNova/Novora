import type { IncomingMessage, ServerResponse } from 'node:http';
import { createVercelRequest, createVercelResponse, readBody } from './adapter.js';

// Vercel 文件路由 → handler 模块名。health/status/email-worker/diagnostic-worker 已合并进 system.ts，
// 由 system handler 按 URL 段 / ?sys= 区分（与 vercel.json rewrites 行为一致）。
const MODULE_FOR_NAME: Record<string, string> = {
  'announcement-images': 'announcement-images',
  announcements: 'announcements',
  'email-worker': 'system',
  'diagnostic-worker': 'system',
  emailAuth: 'emailAuth',
  'error-report': 'error-report',
  'diagnostic-logs': 'diagnostic-logs',
  exams: 'exams',
  health: 'system',
  login: 'login',
  redeploy: 'redeploy',
  status: 'system',
  system: 'system',
  telemetry: 'telemetry',
  time: 'time',
  'update-check': 'update-check',
  users: 'users',
};

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const match = /^\/api\/([A-Za-z0-9_-]+)$/.exec(pathname);
  if (!match) return false;
  const name = match[1];
  const moduleName = MODULE_FOR_NAME[name];
  if (!moduleName) return false;

  const modulePath = `../api/${moduleName}.js`;
  const mod = (await import(modulePath)) as {
    default?: (request: unknown, response: unknown) => void | Promise<void>;
  };
  if (typeof mod.default !== 'function') return false;

  const body = await readBody(req);
  const vercelRequest = createVercelRequest(req, body);
  const vercelResponse = createVercelResponse(res);
  await mod.default(vercelRequest, vercelResponse);
  return true;
}
