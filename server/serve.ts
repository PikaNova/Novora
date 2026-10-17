import { createServer } from 'node:http';
import { handleApiRequest } from './routes.js';
import { serveStatic } from './static.js';
import { randomUUID } from 'node:crypto';
import { logServer, logServerFatal, flushServerJournal } from '../api/_runtimeLogs/serverJournal.js';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';

const requestStats = { windowStart: Date.now(), total: 0, failed: 0 };
(globalThis as Record<string, unknown>).__NOVORA_LOCAL_REQ_STATS__ = requestStats;

const server = createServer(async (req, res) => {
  const started = performance.now();
  const requestId = `request_${randomUUID()}`;
  res.setHeader('X-Request-Id', requestId);
  res.once('finish', () => {
    const durationMs = Math.round(performance.now() - started);
    if (res.statusCode >= 400) requestStats.failed += 1;
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    // Dashboard polling and log ingestion do not recursively generate successful log events.
    if (res.statusCode >= 400 || durationMs >= 4000)
      logServer(
        res.statusCode >= 400 ? 'server.request.failed' : 'server.request.slow',
        { endpoint: path, method: req.method || 'GET', status: res.statusCode, durationMs },
        res.statusCode >= 500 ? 'error' : 'warn',
        '接口失败或响应缓慢',
        requestId,
      );
    requestMinute.total++;
    requestMinute.failed += res.statusCode >= 400 ? 1 : 0;
    requestMinute.durationMs += durationMs;
  });
  if (Date.now() - requestStats.windowStart > 5 * 60_000) {
    requestStats.windowStart = Date.now();
    requestStats.total = 0;
    requestStats.failed = 0;
  }
  requestStats.total += 1;
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;
  try {
    if (pathname.startsWith('/api/')) {
      const handled = await handleApiRequest(req, res, pathname);
      if (!handled) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: 'not_found' }));
      }
      return;
    }
    serveStatic(req, res, pathname);
  } catch (error) {
    logServer(
      'server.request.exception',
      {},
      'error',
      error instanceof Error ? error.stack || error.message : String(error),
      requestId,
    );
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : 'internal_error',
        }),
      );
    } else {
      res.end();
    }
    return;
  }
});

const requestMinute = { total: 0, failed: 0, durationMs: 0 };
const summaryTimer = setInterval(() => {
  if (requestMinute.total)
    logServer('server.requests.summary', {
      total: requestMinute.total,
      failed: requestMinute.failed,
      averageMs: Math.round(requestMinute.durationMs / requestMinute.total),
      windowMs: 60000,
    });
  requestMinute.total = requestMinute.failed = requestMinute.durationMs = 0;
}, 60000);
summaryTimer.unref();
process.on('uncaughtExceptionMonitor', logServerFatal);
server.on('error', (error) => logServer('server.listen.failed', {}, 'error', error.message));
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    logServer('server.stopping', { signal });
    server.close(() => {
      void flushServerJournal().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });

server.listen(port, host, () => {
  logServer('server.started', { port, platform: process.platform, node: process.version });
  console.log(`Novora local server listening on http://${host}:${port}`);
});
