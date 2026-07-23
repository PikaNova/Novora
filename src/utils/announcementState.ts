import type { Announcement } from '../services/announcements';

const READ_KEY = 'exam_board_announcement_reads_v1';
export const announcementVersion = (a: Announcement) => `${a.id}:${a.updated_at}:${a.pinned ? 1 : 0}`;
export function sortAnnouncements(list: Announcement[]): Announcement[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.updated_at) - Number(a.updated_at) || Number(b.created_at) - Number(a.created_at));
}
function reads(): Record<string, number> { try { return JSON.parse(localStorage.getItem(READ_KEY) || '{}'); } catch { return {}; } }
export function isAnnouncementRead(a: Announcement): boolean { return reads()[String(a.id)] === Number(a.updated_at); }
export function markAnnouncementRead(a: Announcement): void { try { const r = reads(); r[String(a.id)] = Number(a.updated_at); localStorage.setItem(READ_KEY, JSON.stringify(r)); } catch { /* storage optional */ } }
