import type { IncomingMessage, ServerResponse } from 'node:http';
import { createVercelRequest, createVercelResponse, readBody } from './adapter.js';

// Vercel 文件路由 → handler 模块名。合并进同一个入口的 URL 在这里指向那个入口，
// 由 handler 按 URL 末段 / ?sys= 区分（与 vercel.json rewrites 行为一致）：
// - system.ts：health、status、email-worker、diagnostic-worker、time、update-check、redeploy
// - announcements.ts：announcements、announcement-images
// - telemetry.ts：telemetry、error-report
const MODULE_FOR_NAME: Record<string, string> = {
  'announcement-images': 'announcements',
  announcements: 'announcements',
  'email-worker': 'system',
  'diagnostic-worker': 'system',
  'error-report': 'telemetry',
  'diagnostic-logs': 'diagnostic-logs',
  exams: 'exams',
  health: 'system',
  login: 'login',
  redeploy: 'system',
  status: 'system',
  system: 'system',
  telemetry: 'telemetry',
  time: 'system',
  'update-check': 'system',
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
