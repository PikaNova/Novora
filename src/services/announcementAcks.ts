import {
  ANNOUNCEMENT_ACK_BATCH_MAX,
  mergeSeenItems,
  normalizeSeenItems,
  type AnnouncementSeenItem,
} from '../shared/examAnnouncementContracts.js';
import { sendAnnouncementAck } from './examAnnouncements';

/**
 * 教室端公告回执的本地缓冲。
 *
 * 大屏上报"看过"时先落本地（localStorage），再尝试发出去：网络抖动、教室断网、
 * 服务端 429 都不会丢回执，下次轮询（60 秒）或下次展示时会重试。
 * 缓冲本身有上限（最多 200 条公告），且同一条只保留累计时长，不写流水。
 */
export const ANNOUNCEMENT_ACK_PENDING_KEY = 'exam_board_announcement_ack_pending_v1';
const PENDING_LIMIT = 200;

type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 读取待发送的回执（{公告 id: 累计时长}）。 */
export function readPendingAnnouncementAcks(target: StorageLike | null = storage()): Record<string, number> {
  if (!target) return {};
  try {
    const raw = target.getItem(ANNOUNCEMENT_ACK_PENDING_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const seenMs = Math.trunc(Number(value) || 0);
      if (id && seenMs > 0) out[id] = seenMs;
    }
    return out;
  } catch {
    return {};
  }
}

function writePending(pending: Record<string, number>, target: StorageLike | null): void {
  if (!target) return;
  try {
    const entries = Object.entries(pending)
      .sort((left, right) => right[1] - left[1])
      .slice(0, PENDING_LIMIT);
    target.setItem(ANNOUNCEMENT_ACK_PENDING_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* 写不进去就不缓存，本次回执仍会尝试直接发送 */
  }
}

/** 记下"这几条公告看过了"，累加到待发送缓冲。 */
export function queueAnnouncementSeen(
  items: readonly AnnouncementSeenItem[],
  target: StorageLike | null = storage(),
): void {
  const incoming = normalizeSeenItems(items);
  if (!incoming.length) return;
  writePending(mergeSeenItems(readPendingAnnouncementAcks(target), incoming), target);
}

/** 从待发送缓冲里摘掉已经确认送达服务端的条目。 */
export function dropPendingAnnouncementAcks(ids: readonly string[], target: StorageLike | null = storage()): void {
  if (!ids.length) return;
  const pending = readPendingAnnouncementAcks(target);
  for (const id of ids) delete pending[id];
  writePending(pending, target);
}

/**
 * 尝试把待发送的回执发出去（每次最多 ANNOUNCEMENT_ACK_BATCH_MAX 条）。
 *
 * 由展示结束、每分钟轮询、恢复联网时调用；失败不抛异常（保持缓冲，下次重试），
 * 返回本次真正被服务端接受的条数，便于界面上做调试。
 */
export async function flushAnnouncementAcks(
  instanceId: string,
  target: StorageLike | null = storage(),
): Promise<number> {
  if (!instanceId) return 0;
  const pending = readPendingAnnouncementAcks(target);
  const batch = Object.entries(pending)
    .slice(0, ANNOUNCEMENT_ACK_BATCH_MAX)
    .map(([id, seenMs]) => ({ id, seenMs }));
  if (!batch.length) return 0;
  try {
    const { recorded } = await sendAnnouncementAck({ instanceId, seen: batch });
    if (recorded > 0)
      dropPendingAnnouncementAcks(
        batch.map((item) => item.id),
        target,
      );
    return recorded;
  } catch {
    // 离线 / 服务端不可用：保留缓冲，等下一次 flush。
    return 0;
  }
}
