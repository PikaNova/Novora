export const COMMON_EXAM_SUBJECTS: readonly string[] = [
  "语文",
  "数学",
  "外语",
  "物理",
  "化学",
  "生物",
  "思想政治",
  "历史",
  "地理",
  "信息技术",
  "通用技术",
  "体育",
  "音乐",
  "美术",
] as const;

export const COMPULSORY_EXAM_SUBJECTS: readonly string[] = ["语文", "数学", "外语"];

export const TRACK_FIRST_CHOICE_EXAM_SUBJECTS: readonly string[] = ["物理", "历史"];

export const TRACK_SECOND_CHOICE_EXAM_SUBJECTS: readonly string[] = [
  "化学",
  "生物",
  "地理",
  "思想政治",
] as const;

export const TRACK_EXAM_SUBJECTS: readonly string[] = [
  ...TRACK_FIRST_CHOICE_EXAM_SUBJECTS,
  ...TRACK_SECOND_CHOICE_EXAM_SUBJECTS,
] as const;

export function normalizeSubjectName(subject: string): string {
  const value = String(subject ?? "").trim();
  if (value === "英语") return "外语";
  if (value === "政治") return "思想政治";
  return value;
}

export function normalizeSubjectList(subjects?: string[] | null): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of subjects ?? []) {
    const subject = normalizeSubjectName(item);
    if (!subject || seen.has(subject)) continue;
    seen.add(subject);
    next.push(subject);
  }
  return next;
}

export function isTrackSubject(subject: string): boolean {
  return normalizeSubjectName(subject)
    .split("/")
    .some((item) => TRACK_EXAM_SUBJECTS.includes(normalizeSubjectName(item)));
}

export function isCompulsorySubject(subject: string): boolean {
  return COMPULSORY_EXAM_SUBJECTS.includes(normalizeSubjectName(subject));
}
