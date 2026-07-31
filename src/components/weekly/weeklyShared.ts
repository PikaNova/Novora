import type {
  IsoWeekday,
  WeeklyConflictPolicy,
  WeeklyWeekType,
} from "../../types/exam";

export const WEEKDAY_LABEL: Record<IsoWeekday, string> = {
  1: "\u5468\u4e00",
  2: "\u5468\u4e8c",
  3: "\u5468\u4e09",
  4: "\u5468\u56db",
  5: "\u5468\u4e94",
  6: "\u5468\u516d",
  7: "\u5468\u65e5",
};

export const WEEKDAY_ORDER: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

export const WEEK_TYPE_LABEL: Record<WeeklyWeekType, string> = {
  all: "\u6bcf\u5468",
  a: "A \u5468",
  b: "B \u5468",
};

export const SCOPE_LABEL: Record<WeeklyConflictPolicy["scope"], string> = {
  "time-overlap": "\u4ec5\u5b9e\u9645\u65f6\u95f4\u91cd\u53e0\u65f6\u6682\u505c\u5468\u6d4b",
  "whole-day": "\u5927\u578b\u8003\u8bd5\u5f53\u5929\u6682\u505c\u5168\u90e8\u5468\u6d4b\uff08\u63a8\u8350\uff09",
  "whole-major-period": "\u5927\u578b\u8003\u8bd5\u6574\u4e2a\u8003\u671f\u6682\u505c\u5168\u90e8\u5468\u6d4b",
};

export type PreviewOcc = {
  date: string;
  weekday: IsoWeekday;
  name: string;
  startTime: string;
  endTime: string;
  suppressed: boolean;
  forced: boolean;
  weeklyItemId: string;
  message?: string;
  conflict?: {
    majorName: string;
    majorStartTime: string;
    majorEndTime: string;
    scope: string;
  };
};

export function fmtDT(iso?: string) {
  return iso ? iso.slice(0, 16).replace("T", " ") : "\u2014";
}

export function weeklyPlanDetailName(
  planName: string,
  gradeName: string,
  className: string,
): string {
  const original = planName.trim();
  let detail = original;
  const prefixes = [`${gradeName} \u00b7 ${className}`, className].filter(Boolean);

  // Older copied plans may already contain their grade/class prefix. Strip
  // every repeated prefix because the picker renders ownership separately.
  for (let pass = 0; pass < 4; pass += 1) {
    const prefix = prefixes.find((candidate) => {
      if (!detail.startsWith(candidate)) return false;
      const remainder = detail.slice(candidate.length);
      return /^[\s\u00b7\-\u2014_/]+/u.test(remainder);
    });
    if (!prefix) break;
    detail = detail.slice(prefix.length).replace(/^[\s\u00b7\-\u2014_/]+/u, "").trim();
  }

  return detail || original;
}
