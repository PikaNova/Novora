// api/_auth/env.ts
// 鉴权模块的可配置项：环境变量与策略数值。改策略只动这一个文件。

// 仅用于兼容已经配置过旧版环境变量的部署。新部署会在首次初始化时自动生成恢复密钥。
export const BOOTSTRAP_PASSWORD = process.env.ADMIN_PASSWORD || '';
export const LEGACY_ADMIN_RECOVERY_KEY = process.env.ADMIN_RECOVERY_KEY || '';

export const TOKEN_TTL = 24 * 60 * 60 * 1000;
export const GUEST_TOKEN_TTL = 180 * 24 * 60 * 60 * 1000;

export const REPAIR_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const REPAIR_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCKOUT_MAX_FAILURES = 5;
export const LOGIN_ALERT_MIN_FAILURES = 3;

/**
 * app_auth 是单行配置，但每次鉴权请求都会读一遍。实例内缓存 5 秒可以把管理端请求的
 * Neon 往返各减一次；token_version 变更后最多 5 秒在其它实例生效，本实例写入时立即失效。
 */
export const AUTH_CONFIG_CACHE_MS = 5_000;
