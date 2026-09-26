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

/**
 * 向导「刚打开」时要不要把步骤打回第一步。
 *
 * 两种打开方式要分开看：用户新开向导要回到第一步；而草稿提示条「下一步」这条**恢复**路径
 * 会自己把步骤设成确认步，必须保留——否则它每次都被压回「考试名称」，
 * 用户填完科目就再也回不到确认与发布。
 */
export function shouldResetWizardStepOnOpen(input: {
  opened: boolean;
  /** 上一次渲染时向导是不是已经开着。 */
  wasOpen: boolean;
  /** 本次打开属于恢复路径（调用方已经设好步骤）。 */
  keepStep: boolean;
}): boolean {
  return input.opened && !input.wasOpen && !input.keepStep;
}

const WIZARD_DRAFT_STORAGE_KEY = 'novora_wizard_draft_v1';

/** 向导第 3 步的挂起状态：只要这几个字段就够在刷新后恢复流程。 */
export type PendingWizardDraft = {
  id: string;
  name: string;
  targetGradeIds: string[];
};

/**
 * 读取「向导还没走完」的那条草稿。
 *
 * 向导的快照与标记只存在内存里，页面一刷新（Service Worker 更新、手动 F5）就全没了，
 * 用户编辑完科目会卡在编辑器里——回不到确认步骤，而新流程下草稿已经没有发布入口。
 * 这里把最小状态落到 localStorage，刷新后据此恢复提示条与「下一步」。
 */
export function readPendingWizardDraft(): PendingWizardDraft | null {
  try {
    const raw = localStorage.getItem(WIZARD_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown; name?: unknown; targetGradeIds?: unknown } | null;
    const id = typeof parsed?.id === 'string' ? parsed.id.trim() : '';
    if (!id) return null;
    return {
      id,
      name: typeof parsed?.name === 'string' ? parsed.name : '',
      targetGradeIds: Array.isArray(parsed?.targetGradeIds)
        ? parsed.targetGradeIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : [],
    };
  } catch {
    // 隐私模式、存储被禁用、内容被改坏都当作「没有挂起的向导」，不影响正常流程。
    return null;
  }
}

/** 写入或清除挂起状态；传 null 表示向导已经结束（发布、取消或草稿被删）。 */
export function writePendingWizardDraft(draft: PendingWizardDraft | null): void {
  try {
    if (!draft) localStorage.removeItem(WIZARD_DRAFT_STORAGE_KEY);
    else localStorage.setItem(WIZARD_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* 存储不可用时忽略：向导仍按内存状态工作，只是刷新后不能恢复 */
  }
}
