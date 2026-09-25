import type { ExamItem } from '../types';
import type { NoticeTone } from '../services/notify';

/**
 * 教室端的「后台动作提示」。
 *
 * 背景：后台能对一场考试做很多事——暂停 / 继续 / 延长 / 改时间 / 申请停止 / 结束 / 强制结束 /
 * 归档 / 删除，还有针对本机临时考试的设备指令。这些以前大多只体现在"倒计时冻结"或"整场消失"
 * 上，教室端既不提示、也不说明，看起来就像"后台按了没用"。
 *
 * 这里把「上一轮看到的状态」和「这一轮看到的状态」做差，产出该提示什么：
 * - 常驻（sticky）：暂停中、已申请停止——贴在教室端横幅上，状态结束自动消失；
 * - 瞬时（transient）：继续 / 延长 / 改时间 / 结束 / 归档 / 删除——发一条 toast。
 */

export type ClassroomNoticeKind =
  'paused' | 'resumed' | 'extended' | 'shortened' | 'stop-requested' | 'ended' | 'archived' | 'removed';

export type ClassroomNotice = {
  key: string;
  kind: ClassroomNoticeKind;
  tone: NoticeTone;
  title: string;
  message: string;
  /** 常驻提示（横幅）；false 表示一次性 toast。 */
  sticky: boolean;
};

export type ClassroomExamSnapshot = {
  /** 这场考试在快照里的 id（大型/快速考试用记录 id，本机临时考试用自己的 id）。 */
  examId: string;
  name: string;
  source: 'formal' | 'temporary';
  startAt: number | null;
  /** 含暂停顺延的有效结束时刻。 */
  endAt: number | null;
  pausedAt: number | null;
  stopRequestedAt: number | null;
  endedAt: number | null;
  archivedAt: number | null;
};

type MajorLike = {
  id?: unknown;
  name?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  pausedAt?: unknown;
  pausedMs?: unknown;
  stopRequestedAt?: unknown;
  endedAt?: unknown;
  archivedAt?: unknown;
};

export type TemporaryExamLike = {
  id: string;
  subject: string;
  status: string;
  pausedAt?: number;
};

export type ClassroomSnapshotInput = {
  items: readonly ExamItem[];
  majors?: readonly MajorLike[];
  temporaryExam?: TemporaryExamLike | null;
  now: number;
};

const num = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * 当前教室端"正在看"的那场考试（与 ExamPage.computeRawState 同一口径：
 * 暂停时把"现在"钉在暂停时刻，所以暂停中的考试仍然算当前考试）。
 */
export function classroomSnapshotOf(input: ClassroomSnapshotInput): ClassroomExamSnapshot | null {
  const { items, majors = [], temporaryExam = null, now } = input;
  const enabled = items.filter((item) => item.enabled !== false);
  if (!enabled.length) return null;
  const parsed = enabled.map((item) => ({
    item,
    start: new Date(item.startTime).getTime(),
    end: new Date(item.endTime).getTime(),
  }));
  const pausedAtOf = (value: unknown): number | null => {
    const parsedValue = num(value);
    return parsedValue;
  };
  const pausedAt =
    parsed.map((entry) => pausedAtOf((entry.item as { pausedAt?: unknown }).pausedAt)).find((v) => v != null) ?? null;
  const effectiveNow = pausedAt != null && pausedAt < now ? pausedAt : now;
  const current = parsed.find(
    (entry) =>
      Number.isFinite(entry.start) &&
      Number.isFinite(entry.end) &&
      entry.start <= effectiveNow &&
      entry.end > effectiveNow,
  );
  if (!current) return null;
  const item = current.item as ExamItem & {
    majorExamId?: string;
    majorName?: string;
    pausedAt?: number | null;
    kind?: string;
  };
  const isTemporary = item.kind === 'temporary';
  const majorId = typeof item.majorExamId === 'string' ? item.majorExamId : '';
  const major = isTemporary ? undefined : majors.find((entry) => String(entry.id ?? '') === majorId);
  const pausedMs = Math.max(0, num(major?.pausedMs) ?? 0);
  const declaredEnd = num(major?.endAt) ?? (Number.isFinite(current.end) ? current.end : null);
  return {
    examId: isTemporary ? String(temporaryExam?.id ?? item.id) : majorId || item.id,
    name: isTemporary
      ? `${temporaryExam?.subject || item.name} - 临时考试`
      : String(item.majorName || major?.name || item.name),
    source: isTemporary ? 'temporary' : 'formal',
    startAt: num(major?.startAt) ?? (Number.isFinite(current.start) ? current.start : null),
    endAt: declaredEnd == null ? null : declaredEnd + pausedMs,
    pausedAt: pausedAtOf(item.pausedAt) ?? pausedAtOf(major?.pausedAt),
    stopRequestedAt: num(major?.stopRequestedAt),
    endedAt: isTemporary ? null : num(major?.endedAt),
    archivedAt: isTemporary ? null : num(major?.archivedAt),
  };
}

const hhmm = (value: number): string => {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const minutesOf = (ms: number): number => Math.max(1, Math.round(ms / 60_000));

/** 当前该常驻显示什么（暂停 / 已申请停止）；没有就返回 null。 */
export function stickyClassroomNotice(snapshot: ClassroomExamSnapshot | null): ClassroomNotice | null {
  if (!snapshot) return null;
  if (snapshot.pausedAt != null) {
    return {
      key: `paused:${snapshot.examId}`,
      kind: 'paused',
      tone: 'warning',
      title: '考试已暂停',
      message: `${snapshot.name} 已被后台暂停，倒计时已冻结，继续后自动顺延。`,
      sticky: true,
    };
  }
  if (snapshot.stopRequestedAt != null) {
    return {
      key: `stop-requested:${snapshot.examId}`,
      kind: 'stop-requested',
      tone: 'warning',
      title: '已申请停止',
      message: `${snapshot.name} 已提交停止申请，系统会在到点或教室端全部结束后收尾。`,
      sticky: true,
    };
  }
  return null;
}

/**
 * 对比两轮状态，产出需要提示的变化（不含常驻状态，常驻由 stickyClassroomNotice 负责）。
 * `majors` 用来判断"这场考试是被结束/归档了，还是被删掉了"。
 */
export function reconcileClassroomNotices(
  previous: ClassroomExamSnapshot | null,
  next: ClassroomExamSnapshot | null,
  options: { majors?: readonly MajorLike[]; temporaryExam?: TemporaryExamLike | null } = {},
): ClassroomNotice[] {
  if (!previous) return [];
  const notices: ClassroomNotice[] = [];
  const name = previous.name;
  const sameExam = next != null && next.examId === previous.examId;

  if (sameExam && next) {
    if (previous.pausedAt == null && next.pausedAt != null) {
      notices.push({
        key: `paused:${next.examId}:${next.pausedAt}`,
        kind: 'paused',
        tone: 'warning',
        title: '考试已暂停',
        message: `后台已暂停「${name}」，倒计时冻结。`,
        sticky: true,
      });
    } else if (previous.pausedAt != null && next.pausedAt == null) {
      const pausedMs = Date.now() - previous.pausedAt;
      notices.push({
        key: `resumed:${next.examId}:${next.pausedAt}`,
        kind: 'resumed',
        tone: 'success',
        title: '考试已继续',
        message: `后台已继续「${name}」，本次暂停 ${minutesOf(pausedMs)} 分钟，结束时间相应顺延。`,
        sticky: false,
      });
    }
    if (previous.endAt != null && next.endAt != null && next.endAt !== previous.endAt) {
      const deltaMs = next.endAt - previous.endAt;
      notices.push({
        key: `end-at:${next.examId}:${next.endAt}`,
        kind: deltaMs > 0 ? 'extended' : 'shortened',
        tone: deltaMs > 0 ? 'success' : 'warning',
        title: deltaMs > 0 ? '考试已延长' : '考试时间已调整',
        message:
          deltaMs > 0
            ? `后台已延长「${name}」${minutesOf(deltaMs)} 分钟，结束时间改为 ${hhmm(next.endAt)}。`
            : `「${name}」的结束时间改为 ${hhmm(next.endAt)}。`,
        sticky: false,
      });
    }
    if (previous.stopRequestedAt == null && next.stopRequestedAt != null) {
      notices.push({
        key: `stop-requested:${next.examId}:${next.stopRequestedAt}`,
        kind: 'stop-requested',
        tone: 'warning',
        title: '后台已申请停止',
        message: `「${name}」已提交停止申请：系统会在到点、教室端全部结束或长时间无在线设备时收尾。`,
        sticky: true,
      });
    }
    return notices;
  }

  // 上一轮在看的那场考试这一轮不在屏幕上了：是结束 / 归档 / 还是被删掉？
  const majors = options.majors ?? [];
  if (previous.source === 'temporary') {
    const temporary = options.temporaryExam ?? null;
    if (!temporary || temporary.status === 'ended') {
      notices.push({
        key: `ended:${previous.examId}`,
        kind: 'ended',
        tone: 'warning',
        title: '临时考试已结束',
        message: `本机临时考试「${name}」已结束。`,
        sticky: false,
      });
    }
    return notices;
  }
  const major = majors.find((entry) => String(entry.id ?? '') === previous.examId);
  if (major && num(major.endedAt) != null) {
    notices.push({
      key: `ended:${previous.examId}:${String(major.endedAt)}`,
      kind: 'ended',
      tone: 'warning',
      title: '考试已结束',
      message: `后台已结束「${name}」，本场考试结束。`,
      sticky: false,
    });
  } else if (major && num(major.archivedAt) != null) {
    notices.push({
      key: `archived:${previous.examId}:${String(major.archivedAt)}`,
      kind: 'archived',
      tone: 'warning',
      title: '考试已归档',
      message: `「${name}」已被归档，不再出现在考试安排里。`,
      sticky: false,
    });
  } else if (!major) {
    notices.push({
      key: `removed:${previous.examId}`,
      kind: 'removed',
      tone: 'warning',
      title: '考试已删除',
      message: `后台已删除「${name}」，本场安排取消。`,
      sticky: false,
    });
  }
  return notices;
}
