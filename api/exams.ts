// api/exams.ts
// 考试看板 / ClassIsland 插件 / 设备绑定的 HTTP 入口（Vercel Serverless Function）。
// 第二阶段解耦：原本集中在本文件的数据库迁移、payload 映射与 diff、鉴权校验、
// 插件逻辑、设备/插件路由已拆到 ./_exams/* 子模块；本文件只保留请求分发与编排（thin handler）。
// 对外行为与接口保持不变。

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requestId, sendDatabaseError, sendRateLimited } from "./_apiError.js";
import { applyCors } from "./_cors.js";
import {
  consumeRateLimit,
  getRateLimitKey,
  isWriteTierExemptAction,
  readRateLimitSetting,
} from "./_rateLimiter.js";
import {
  handleBootstrap,
  handleExamDataGet,
  handleExamDataPost,
} from "./_exams/routes/examDataRoutes.js";
import {
  handlePluginApi,
  handlePluginPairStart,
  handlePluginPairInfo,
  handlePluginPairConfirm,
  handlePluginPairStatusOrBootstrap,
  handlePluginViewerHeartbeat,
} from "./_exams/routes/pluginRoutes.js";
import {
  handleDeviceBindings,
  handleDeviceBindingOptions,
  handleManagedDeviceSetup,
  handleDeviceRoleUpdate,
  handleDeviceCommand,
  handleDeviceRevoke,
} from "./_exams/routes/deviceAdminRoutes.js";
import {
  handleDeviceBinding,
  handleDeviceHeartbeat,
} from "./_exams/routes/deviceSelfRoutes.js";
import {
  handleDesignPolicy,
  handleResetData,
} from "./_exams/routes/settingsRoutes.js";

type RouteHandler = (
  req: VercelRequest,
  res: VercelResponse,
  startedAt: number,
) => Promise<void>;

// 这些 action 对应的处理函数会自行校验 HTTP 方法（方法不匹配时会显式返回 405），
// 因此在分发表中始终优先尝试匹配，不区分 GET/POST。
const ACTION_ONLY_ROUTES: Record<string, RouteHandler> = {
  "plugin-api": (req, res) => handlePluginApi(req, res),
  "plugin-pair-start": (req, res) => handlePluginPairStart(req, res),
  "plugin-pair-info": (req, res) => handlePluginPairInfo(req, res),
  "plugin-pair-confirm": (req, res) => handlePluginPairConfirm(req, res),
  "plugin-pair-status": (req, res) =>
    handlePluginPairStatusOrBootstrap(req, res, "plugin-pair-status"),
  "plugin-bootstrap": (req, res) =>
    handlePluginPairStatusOrBootstrap(req, res, "plugin-bootstrap"),
  "plugin-viewer-heartbeat": (req, res) => handlePluginViewerHeartbeat(req, res),
  bootstrap: (req, res, startedAt) => handleBootstrap(req, res, startedAt),
  "device-bindings": (req, res) => handleDeviceBindings(req, res),
  "device-binding-options": (req, res) => handleDeviceBindingOptions(req, res),
  "device-binding": (req, res) => handleDeviceBinding(req, res),
};

// 这些 action 原本只在 POST 分支里出现；GET 或其他方法命中同名 action 时，
// 会像原始实现一样静默落到下面的默认 GET/POST 处理逻辑，而不是显式 405。
const POST_ONLY_ROUTES: Record<string, RouteHandler> = {
  "managed-device-setup": (req, res) => handleManagedDeviceSetup(req, res),
  "device-role-update": (req, res) => handleDeviceRoleUpdate(req, res),
  "device-heartbeat": (req, res) => handleDeviceHeartbeat(req, res),
  "device-command": (req, res) => handleDeviceCommand(req, res),
  "device-revoke": (req, res) => handleDeviceRevoke(req, res),
  "design-policy": (req, res) => handleDesignPolicy(req, res),
  "reset-data": (req, res) => handleResetData(req, res),
};

const GENERAL_RATE_LIMIT_WINDOW_MS = readRateLimitSetting(
  process.env.ENTRY_RATE_LIMIT_WINDOW_MS,
  10_000,
);
const GENERAL_RATE_LIMIT_MAX_REQUESTS = readRateLimitSetting(
  process.env.ENTRY_RATE_LIMIT_MAX_REQUESTS,
  30,
);
const WRITE_RATE_LIMIT_WINDOW_MS = readRateLimitSetting(
  process.env.ENTRY_RATE_LIMIT_WRITE_WINDOW_MS,
  10_000,
);
const WRITE_RATE_LIMIT_MAX_REQUESTS = readRateLimitSetting(
  process.env.ENTRY_RATE_LIMIT_WRITE_MAX_REQUESTS,
  8,
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startedAt = Date.now();
  requestId(req, res);
  const action = String(
    req.method === "GET" ? (req.query?.action ?? "") : (req.body?.action ?? ""),
  );
  const publicPostActions = new Set([
    "plugin-pair-start",
    "plugin-pair-confirm",
    "plugin-pair-status",
    "plugin-bootstrap",
    "plugin-viewer-heartbeat",
    "device-binding",
    "device-heartbeat",
  ]);
  const publicRequest =
    req.method === "OPTIONS" ||
    (req.method === "GET" && action !== "device-bindings") ||
    (req.method === "POST" && publicPostActions.has(action));
  // 只做“协商缓存”（ETag/If-None-Match），不再声明 public 共享缓存：
  // 之前的 `public, s-maxage=3` 允许 Vercel 边缘节点在写入后的几秒内，把旧数据返回给
  // 任意用户；配合下面已移除的实例内存缓存，会出现「明明已创建班级，第一次进入却显示未创建，
  // 刷新后才恢复」的问题。改为 private + no-cache 后，每次请求都必须向源站校验 ETag，
  // 数据永远来自当次真实查询，只是命中 304 时不重复传输正文。
  if (req.method === "GET")
    res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
  else res.setHeader("Cache-Control", "no-store");
  if (!applyCors(req, res, { methods: ["GET", "POST"], public: publicRequest }))
    return;

  try {
    const rateLimitKey = getRateLimitKey(req);
    const generalLimit = consumeRateLimit(rateLimitKey, {
      windowMs: GENERAL_RATE_LIMIT_WINDOW_MS,
      maxRequests: GENERAL_RATE_LIMIT_MAX_REQUESTS,
    });
    if (!generalLimit.allowed) {
      sendRateLimited(req, res, generalLimit.retryAfterMs / 1_000);
      return;
    }

    if (req.method === "POST" && !isWriteTierExemptAction(action)) {
      const writeLimit = consumeRateLimit(`${rateLimitKey}:write`, {
        windowMs: WRITE_RATE_LIMIT_WINDOW_MS,
        maxRequests: WRITE_RATE_LIMIT_MAX_REQUESTS,
      });
      if (!writeLimit.allowed) {
        sendRateLimited(req, res, writeLimit.retryAfterMs / 1_000);
        return;
      }
    }

    const actionOnlyHandler = ACTION_ONLY_ROUTES[action];
    if (actionOnlyHandler) {
      await actionOnlyHandler(req, res, startedAt);
      return;
    }

    if (req.method === "POST") {
      const postOnlyHandler = POST_ONLY_ROUTES[action];
      if (postOnlyHandler) {
        await postOnlyHandler(req, res, startedAt);
        return;
      }
    }

    if (req.method === "GET") {
      await handleExamDataGet(req, res, startedAt);
      return;
    }
    if (req.method === "POST") {
      await handleExamDataPost(req, res, startedAt);
      return;
    }
    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    sendDatabaseError(req, res, error, req.method === "GET" ? "read" : "write");
  }
}
