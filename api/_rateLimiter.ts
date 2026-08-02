import { createHash } from "node:crypto";

type WindowEntry = { count: number; windowStart: number };

const buckets = new Map<string, WindowEntry>();
const MAX_TRACKED_KEYS = 5_000;

export type RateLimitOptions = {
  windowMs: number;
  maxRequests: number;
  now?: () => number;
};

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterMs: number;
};

export const WRITE_TIER_EXEMPT_POST_ACTIONS = new Set([
  "plugin-pair-status",
  "plugin-bootstrap",
  "plugin-viewer-heartbeat",
  "device-heartbeat",
]);

export function isWriteTierExemptAction(action: string): boolean {
  return WRITE_TIER_EXEMPT_POST_ACTIONS.has(action);
}

export function readRateLimitSetting(
  raw: string | undefined,
  fallback: number,
): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const EVICTION_SCAN_LIMIT = 32;

function evictOldestBucket(now: number, windowMs: number): void {
  let scanned = 0;
  for (const [candidateKey, candidateEntry] of buckets) {
    scanned += 1;
    if (now - candidateEntry.windowStart >= windowMs) {
      buckets.delete(candidateKey);
      return;
    }
    if (scanned >= EVICTION_SCAN_LIMIT) break;
  }
  const oldestKey = buckets.keys().next().value as string | undefined;
  if (oldestKey) {
    console.warn(`[rateLimiter] evicting an active bucket after scanning ${scanned} candidates with no expired window`);
    buckets.delete(oldestKey);
  }
}

/** Consumes one request from a source-specific, in-process fixed window. */
export function consumeRateLimit(
  key: string,
  options: RateLimitOptions,
): RateLimitDecision {
  const now = (options.now ?? Date.now)();
  const existing = buckets.get(key);
  if (existing) buckets.delete(key);
  let entry = existing;
  if (!entry || now - entry.windowStart >= options.windowMs) {
    if (!entry && buckets.size >= MAX_TRACKED_KEYS) evictOldestBucket(now, options.windowMs);
    entry = { count: 1, windowStart: now };
    buckets.set(key, entry);
    return { allowed: true, retryAfterMs: 0 };
  }

  entry.count += 1;
  buckets.set(key, entry);
  return {
    allowed: entry.count <= options.maxRequests,
    retryAfterMs: Math.max(0, options.windowMs - (now - entry.windowStart)),
  };
}

export function checkRateLimit(key: string, options: RateLimitOptions): boolean {
  return consumeRateLimit(key, options).allowed;
}

export function __resetRateLimiterForTests(): void {
  buckets.clear();
}

type RateLimitRequest = {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  query?: Record<string, unknown>;
  body?: unknown;
  socket?: { remoteAddress?: string | null };
};

function boundedString(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 128) : "";
}

function tokenKey(token: string): string {
  return `token:${createHash("sha256").update(token).digest("hex")}`;
}

export function getRateLimitKey(req: RateLimitRequest): string {
  const authorization = req.headers.authorization;
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  const match = value?.match(/^Bearer\s+(.+)$/i);
  const token = boundedString(match?.[1]);
  if (token) return tokenKey(token);

  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  const instanceId = boundedString(
    req.method === "GET" ? query.instanceId : body.instanceId,
  );
  if (instanceId) return `device:${instanceId}`;

  const forwarded = req.headers["x-forwarded-for"];
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = boundedString(header?.split(",")[0]) || boundedString(req.socket?.remoteAddress) || "unknown";
  return `ip:${ip}`;
}
