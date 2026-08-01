import type { ExamItem, MajorExam } from "../../types";

export type SyncState = "loading" | "saving" | "saved" | "offline" | "error";

export type MajorStateRef = {
  current: { majors: MajorExam[]; activeMajorId: string };
};

// Cross-domain saves compose a complete exam payload from this ref. Keep it in
// lockstep with React state before another domain can queue its own save.
export function syncMajorStateRef(
  stateRef: MajorStateRef,
  majors: MajorExam[],
  activeMajorId: string,
) {
  stateRef.current = { majors, activeMajorId };
}

export function fmtAnnTime(ms: number) {
  if (!ms) return "";
  return new Date(Number(ms)).toLocaleString("zh-CN", { hour12: false });
}

export function makeId() {
  return `exam_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function fmtLocal(iso: string) {
  return iso?.replace("T", " ")?.slice(0, 16) ?? "";
}

export function toISO(value: string) {
  return value.replace(" ", "T").trim();
}

export function toLocalInput(time: number) {
  const date = new Date(time - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

export function duration(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const minutes = Math.round(ms / 60000);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h${minutes % 60 ? `${minutes % 60}m` : ""}`
    : `${minutes}m`;
}

export function phase(item: ExamItem): "waiting" | "ongoing" | "ended" {
  const now = Date.now();
  if (now < new Date(item.startTime).getTime()) return "waiting";
  if (now <= new Date(item.endTime).getTime()) return "ongoing";
  return "ended";
}
