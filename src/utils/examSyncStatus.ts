import type { ExamDataSyncState } from "../hooks/useExamSync";

export function labelForExamSync(state: ExamDataSyncState, pending: boolean): string {
  if (state === "syncing") return "正在同步";
  if (state === "offline") return "离线，载入本地";
  if (state === "max-retries") return "同步失败，点击重试";
  if (state === "error") return "重试同步";
  if (state === "auth-required") return "等待管理员同步";
  if (pending || state === "pending") return "同步本地修改";
  return "立即同步";
}

export function statusForExamSync(
  state: ExamDataSyncState,
  lastSyncAt: number,
  pending: boolean,
  syncError?: string,
): string {
  if (state === "offline") return "当前离线，正在显示本地安排";
  if (state === "max-retries") return syncError || "已达到最大自动重试次数，请手动同步或联系管理员";
  if (state === "error") return "云端暂不可用，本地数据已保留";
  if (state === "auth-required") return "本地修改等待管理员登录后同步";
  if (pending || state === "pending") return "本地修改等待同步";
  if (state === "syncing") return "正在检查最新考试安排";
  return lastSyncAt
    ? `数据已同步，${new Date(lastSyncAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`
    : "已载入本地数据";
}

export function needsUrgentAttention(state: ExamDataSyncState): boolean {
  return state === "max-retries";
}
