export type SyncTone = 'ok' | 'wait' | 'off';

export interface SyncStatus {
  text: string;
  tone: SyncTone;
}

/**
 * 统一的状态胶囊文案 / 色调。
 * 胶囊反映“当下真实状态”：
 * - 离线（navigator 下线）：不论历史是否校时过，一律提示用本机时间。
 * - 在线且已校时：绿灯。
 * - 在线但尚未校时：黄灯。
 */
export function getSyncStatus(online: boolean, timeSynced: boolean): SyncStatus {
  if (!online) return { text: '离线 · 本机时间', tone: 'off' };
  if (timeSynced) return { text: '在线 · 已校时', tone: 'ok' };
  return { text: '在线 · 未校时', tone: 'wait' };
}
