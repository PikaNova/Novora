import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isPasswordRequired, verifyToken, extractBearer } from './_auth.js';

/**
 * 一键重新部署：触发 Vercel Deploy Hook，从 GitHub 拉取最新代码并重新构建。
 * - 需在 Vercel 项目环境变量配置 VERCEL_DEPLOY_HOOK_URL
 *   （Project Settings → Git → Deploy Hooks 生成）。
 * - GET  ：返回是否已配置部署钩子（用于前端显示/隐藏按钮）。
 * - POST ：需管理鉴权（与其他写接口一致），触发部署。
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL || '';

  if (req.method === 'GET') {
    res.status(200).json({ ok: true, configured: !!hookUrl });
    return;
  }

  if (req.method === 'POST') {
    // 鉴权：若设了管理密码，则需有效 token
    if (await isPasswordRequired()) {
      const token = extractBearer(req.headers.authorization);
      if (!await verifyToken(token)) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
    }
    if (!hookUrl) {
      res.status(501).json({ ok: false, code: 'NO_HOOK', error: '尚未配置 VERCEL_DEPLOY_HOOK_URL 环境变量' });
      return;
    }
    try {
      const hookRes = await fetch(hookUrl, { method: 'POST' });
      const text = await hookRes.text();
      let job: unknown = null;
      try { job = text ? JSON.parse(text) : null; } catch { job = { raw: text.slice(0, 500) }; }
      if (!hookRes.ok) {
        res.status(502).json({ ok: false, error: `Deploy Hook 返回 ${hookRes.status}`, job });
        return;
      }
      res.status(200).json({ ok: true, job });
    } catch (error: unknown) {
      res.status(502).json({ ok: false, error: error instanceof Error ? error.message : '触发部署失败' });
    }
    return;
  }

  res.status(405).json({ ok: false, error: 'Method not allowed' });
}
