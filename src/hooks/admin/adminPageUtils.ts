import type { ExamItem, MajorExam } from '../../types';

export type SyncState = 'loading' | 'saving' | 'saved' | 'offline' | 'error';

export type MajorStateRef = {
  current: { majors: MajorExam[]; activeMajorId: string };
};

// Cross-domain saves compose a complete exam payload from this ref. Keep it in
// lockstep with React state before another domain can queue its own save.
export function syncMajorStateRef(stateRef: MajorStateRef, majors: MajorExam[], activeMajorId: string) {
  stateRef.current = { majors, activeMajorId };
}

export function fmtAnnTime(ms: number) {
  if (!ms) return '';
  return new Date(Number(ms)).toLocaleString('zh-CN', { hour12: false });
}

export function makeId() {
  return `exam_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function fmtLocal(iso: string) {
  return iso?.replace('T', ' ')?.slice(0, 16) ?? '';
}

export function toISO(value: string) {
  return value.replace(' ', 'T').trim();
}

export function toLocalInput(time: number) {
  const date = new Date(time - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

export function duration(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const minutes = Math.round(ms / 60000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? `${minutes % 60}m` : ''}` : `${minutes}m`;
}

export function phase(item: ExamItem): 'waiting' | 'ongoing' | 'ended' {
  const now = Date.now();
  if (now < new Date(item.startTime).getTime()) return 'waiting';
  if (now <= new Date(item.endTime).getTime()) return 'ongoing';
  return 'ended';
}

/**
 * 新建向导第 3 步那条右下角提示是否显示。
 *
 * 它是回到向导「确认」步骤的唯一入口：提示一旦被关掉，用户就只能去考试安排里重新找这场
 * 草稿，所以它必须常驻，只在向导弹窗自己打开时让位。草稿被删掉时（用户在考试安排里删了
 * 它）一并撤下——否则提示条上的「下一步」会把当时正在编辑的另一场考试当成它来发布。
 */
export function shouldShowWizardDraftHint(input: {
  draftCreated: boolean;
  /** 第 1 步建出来的草稿 id；还没记下来时传空串。 */
  draftId: string;
  draftExists: boolean;
  modalOpen: boolean;
  tabIsExam: boolean;
}): boolean {
  if (!input.draftCreated || input.modalOpen || !input.tabIsExam) return false;
  // 刚建完草稿的那一帧还没记下 id，先显示；记下之后草稿不在了就撤下。
  return !input.draftId || input.draftExists;
}
