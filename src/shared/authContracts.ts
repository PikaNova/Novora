// 前后端共用的认证/审计响应契约。api/_auth.ts 与 src/services/adminUsers.ts
// 都从这里取类型，避免同一形状各写一份后漂移。

export type LoginFailureAlert = {
  username: string;
  failureCount: number;
  windowStart: number;
  latestFailureAt: number;
};
