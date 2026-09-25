import type { ExamItem, MajorExam, AlertsSettings } from '../types';
import type { DesignPolicy, ScheduleMode, WeeklyPlan, WeeklyConflictPolicy } from '../types/exam';
import type { SchoolClass, SchoolGrade } from '../types/school';
import type { ExamSettings } from '../utils/appSettings';
import { ApiError, apiErrorFromResponse, networkApiError } from './apiError';
import { fetchWithTimeout } from './fetchWithTimeout';
import { saveDesignPolicyDraft, clearDesignPolicyDraft } from './designPolicyDraft';
import { runQueued } from './syncQueue';
import {
  canAccessClass as sharedCanAccessClass,
  canAccessGrade as sharedCanAccessGrade,
  hasPermission as sharedHasPermission,
  type PermissionScope,
} from '../shared/permissionRules';
import { examSnapshotQuery, parseExamPayload, parseExamVersion, type ExamPayload } from '../shared/examContracts';
import {
  changedExamDomains,
  fullExamSaveBody,
  mergeExamRevisions,
  presentExamSaveDomains,
  revisionDomainsFor,
  EXAM_REVISION_DOMAINS,
  type ExamSaveDomain,
  type ExamSaveSnapshot,
} from '../shared/examSaveDiff';

export type { ExamPayload };

const API_URL = '/api/exams';
const LOGIN_URL = '/api/login';
const TOKEN_KEY = 'admin_auth_token';
const TOKEN_EXPIRES_KEY = 'admin_auth_token_expires';
const ADMIN_USER_KEY = 'admin_user_context';
const GRADE_ADMIN_FIRST_LOGIN_KEY = 'novora_grade_admin_first_login';
const CLOUD_VERSION_KEY = 'exam_cloud_updated_at';
const CLOUD_SNAPSHOT_KEY = 'exam_cloud_snapshot';
const CLOUD_ETAG_KEY = 'exam_cloud_etag';
/**
 * 最近一次 409 返回的云端快照（与 `CLOUD_SNAPSHOT_KEY` 分开存）。
 *
 * 冲突后的重试（客户端三方合并 → 再提交）需要一份「与服务端版本配套的基线」才能继续只提交变化域。
 * 但不能把它写成 `getCloudSnapshot()`：调用方把 getCloudSnapshot() 当作三方合并的 base，
 * 换成 remote 会让「远端已改、本地未改」的字段被误判成本地值，静默丢掉对方的改动。
 * 因此单独存一份，仅在保存时作为逐域比对基线使用。
 */
const CLOUD_CONFLICT_BASE_KEY = 'exam_cloud_conflict_base';
/**
 * 边缘缓存能力标记：只有服务端在某次心跳里回过 version 才会置位。
 * 置位后客户端才使用版本化快照 URL、并放弃公告的缓存穿透参数；
 * 本地 / Docker / 内网部署不会置位，因此连请求形状都保持改造前不变，
 * 后续本地改用 WSS 推送时也不会被这里的判断牵动。
 */
const EDGE_CACHE_SUPPORT_KEY = 'exam_board_edge_cache_support';
/**
 * 心跳会带上服务端当前的快照版本号（仅 Vercel 部署）。收到事件后由 useExamSync 决定
 * 是否需要拉取快照，避免再单独轮询一次。
 */
export const CLOUD_VERSION_EVENT = 'exam-board:cloud-version';
let lastExamApiError: ApiError | null = null;
let lastAuthApiError: ApiError | null = null;
let generatedRecoveryKey: string | null = null;

export function getLastExamApiError(): ApiError | null {
  return lastExamApiError;
}
export function getLastAuthApiError(): ApiError | null {
  return lastAuthApiError;
}
export function takeGeneratedRecoveryKey(): string | null {
  const value = generatedRecoveryKey;
  generatedRecoveryKey = null;
  return value;
}

function rememberCloudSnapshot(payload: ExamPayload): void {
  try {
    localStorage.setItem(CLOUD_VERSION_KEY, String(payload.updatedAt));
    localStorage.setItem(CLOUD_SNAPSHOT_KEY, JSON.stringify(payload));
  } catch {
    /* 离线/隐私模式下仍可正常使用当前会话数据 */
  }
}

/** 本机已应用的云端快照版本号；0 表示还没同步过。 */
export function getCloudVersion(): number {
  try {
    return parseExamVersion(localStorage.getItem(CLOUD_VERSION_KEY));
  } catch {
    return 0;
  }
}

export function supportsEdgeCache(): boolean {
  try {
    return localStorage.getItem(EDGE_CACHE_SUPPORT_KEY) === '1';
  } catch {
    return false;
  }
}

export function markEdgeCacheSupport(): void {
  try {
    localStorage.setItem(EDGE_CACHE_SUPPORT_KEY, '1');
  } catch {
    /* 隐私模式下退化为普通轮询 */
  }
}

/** 最近一次成功读取或保存的云端完整快照，是三方合并的共同基线。 */
export function getCloudSnapshot(): ExamPayload | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CLOUD_SNAPSHOT_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parseExamPayload(parsed) : null;
  } catch {
    return null;
  }
}

// ── 统一的网络错误分类 ────────────────────────────────────────────────────────────
function classifyFetchError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof TypeError && /fetch|network|load/i.test(err.message)) {
    return networkApiError();
  }
  console.error('[examService] unexpected error:', err);
  return new ApiError({
    status: 0,
    code: 'UNEXPECTED_ERROR',
    message: '发生了意外错误，请刷新页面后重试。',
    retryable: false,
  });
}

/**
 * 并发单飞：同一时刻只保留一次快照读取（包含 304 之后的完整回读）。
 *
 * 之前每个调用方各发一条：条件请求拿到 304、本地又没有缓存快照时，每个调用方都会
 * 各自再发一次完整快照——一屏能叠出 6 条 /api/exams，而且它们是顺序发生的，
 * 请求合并层（只管同时在途）拦不住。管理端开机、总览、设计规则、批量预设、
 * 大屏轮询都调这里，收敛成一次就能砍掉大半。
 */
let snapshotFlight: Promise<ExamPayload | null> | null = null;

/**
 * 结果窗口：刚取到的快照在这段时间内直接被复用，不再发条件请求。
 *
 * 单飞只能合并"同时在途"的调用；开机首轮里 `useExamSync` / `useAdminSyncEngine` /
 * 总览 / 设计规则 / 批量预设是错峰发起的（相隔几百毫秒），单飞拦不住，一屏仍会叠出 5 条。
 * 快照本身有 ETag 与本地缓存兜底，1 秒内的复用不会带来可感知的数据滞后；
 * 任何一次写操作都会立刻作废这个窗口（见 saveExamsToServer）。
 */
let snapshotReuseWindowMs = 1_000;
let lastSnapshot: { at: number; payload: ExamPayload | null } | null = null;

/** 写操作后调用：保证紧接着的读取不会拿到写完之前的快照。 */
export function invalidateExamSnapshotReuse(): void {
  lastSnapshot = null;
}

/** 仅供测试：清掉正在共享的那次读取与结果窗口。 */
export function __resetSnapshotFlightForTests(): void {
  snapshotFlight = null;
  lastSnapshot = null;
}

/** 仅供测试：把结果窗口调短，避免用例真的等 1 秒。 */
export function __setSnapshotReuseWindowForTests(ms: number): void {
  snapshotReuseWindowMs = Math.max(0, ms);
}

export async function fetchExamsFromServer(
  bootstrapInstanceId?: string,
  options: { fresh?: boolean } = {},
): Promise<ExamPayload | null> {
  // bootstrap 带设备身份、URL 也不同，单独走，不与普通快照合并。
  if (bootstrapInstanceId) return fetchExamsOnce(bootstrapInstanceId);
  if (!options.fresh && lastSnapshot && Date.now() - lastSnapshot.at < snapshotReuseWindowMs) {
    return lastSnapshot.payload;
  }
  if (snapshotFlight) return snapshotFlight;
  snapshotFlight = fetchExamsOnce()
    .then((payload) => {
      lastSnapshot = { at: Date.now(), payload };
      return payload;
    })
    .finally(() => {
      snapshotFlight = null;
    });
  return snapshotFlight;
}

async function fetchExamsOnce(bootstrapInstanceId?: string): Promise<ExamPayload | null> {
  try {
    const headers: Record<string, string> = {};
    const isBootstrap = !!bootstrapInstanceId;
    const etag = isBootstrap ? null : localStorage.getItem(CLOUD_ETAG_KEY);
    if (etag) headers['If-None-Match'] = etag;
    // 只有服务端确认支持（心跳带过 version）且本机已知版本时，才改用版本化快照 URL：
    // 数据没变就是同一个 URL，可被边缘长期缓存；其它情况保持原来的请求形状。
    const cloudVersion = isBootstrap ? 0 : getCloudVersion();
    let url = API_URL;
    if (isBootstrap) {
      url = `${API_URL}?action=bootstrap&instanceId=${encodeURIComponent(bootstrapInstanceId)}`;
    } else if (cloudVersion > 0 && supportsEdgeCache()) {
      url = `${API_URL}?${examSnapshotQuery(cloudVersion)}`;
    }

    const res = await fetchWithTimeout(
      url,
      { method: 'GET', headers, cache: isBootstrap ? 'no-store' : 'no-cache' },
      15_000,
    );

    if (res.status === 304) {
      const snap = getCloudSnapshot();
      if (snap) return snap;
      const full = await fetchWithTimeout(API_URL, { method: 'GET', cache: 'no-cache' }, 15_000);
      if (!full.ok) {
        lastExamApiError = await apiErrorFromResponse(full, '读取考试与班级数据失败');
        return null;
      }
      const fullEtag = full.headers.get('ETag');
      if (fullEtag) localStorage.setItem(CLOUD_ETAG_KEY, fullEtag);
      const fullData = await full.json();
      if (!fullData?.ok) {
        lastExamApiError = new ApiError({
          status: 500,
          code: 'INVALID_RESPONSE',
          message: '服务器返回了无效的数据，请刷新后重试。',
          retryable: true,
        });
        return null;
      }
      const fullPayload = parseExamPayload(fullData);
      rememberCloudSnapshot(fullPayload);
      return fullPayload;
    }

    if (!res.ok) {
      lastExamApiError = await apiErrorFromResponse(res, '读取考试与班级数据失败');
      return null;
    }
    const freshEtag = res.headers.get('ETag');
    if (freshEtag) localStorage.setItem(CLOUD_ETAG_KEY, freshEtag);
    const data = await res.json();
    if (!data?.ok) {
      lastExamApiError = new ApiError({
        status: 500,
        code: 'INVALID_RESPONSE',
        message: '服务器返回了无效的数据，请刷新后重试。',
        retryable: true,
      });
      return null;
    }
    const payload = parseExamPayload(data);
    rememberCloudSnapshot(payload);
    lastExamApiError = null;
    return payload;
  } catch (err) {
    lastExamApiError = classifyFetchError(err);
    return null;
  }
}

export interface SaveExamsInput {
  items: ExamItem[];
  action?: 'initialize';
  baseUpdatedAt?: number;
  clientSyncLabel?: string;
  clientQueueKey?: string;
  title?: string;
  majors?: MajorExam[];
  activeMajorId?: string;
  alerts?: AlertsSettings | null;
  scheduleMode?: ScheduleMode;
  weeklyPlans?: WeeklyPlan[];
  activeWeeklyPlanId?: string | null;
  activeWeeklyPlanIdByClassId?: Record<string, string | null>;
  grades?: SchoolGrade[];
  classes?: SchoolClass[];
  initialization?: ExamSettings['initialization'];
  weeklyConflictPolicy?: WeeklyConflictPolicy | null;
}

export type SaveExamsResult =
  | number
  | 'unauthorized'
  | { kind: 'conflict'; remote: ExamPayload | null }
  | { kind: 'error'; error: ApiError }
  | null;

/**
 * 最近一次保存里被服务端冻结的归档考试（服务端版本）。
 *
 * 服务端对已归档考试一律只读：客户端提交的修改/删除会被回退，并把这些条目原样回传。
 * 不消费它就会出现「本机显示删掉了/改好了，刷新又变回来」。
 */
let frozenArchivedMajors: MajorExam[] = [];

/** 取走并清空最近一次保存被冻结的归档考试；调用方负责回灌本地状态并提示用户。 */
export function takeFrozenArchivedMajors(): MajorExam[] {
  const value = frozenArchivedMajors;
  frozenArchivedMajors = [];
  return value;
}

/**
 * 把服务端冻结的归档考试并回一份 local majors：同 id 用服务端版本替换，服务端有的本地没有就补回。
 * 单独抽出来是为了让「本地已删、服务端仍冻结保留」这条路径可测。
 */
export function applyFrozenArchivedMajors(majors: MajorExam[], frozen: MajorExam[]): MajorExam[] {
  if (!frozen.length) return majors;
  const frozenById = new Map(frozen.map((major) => [String(major.id), major]));
  const kept = majors.map((major) => frozenById.get(String(major.id)) ?? major);
  const restored = frozen.filter((major) => !majors.some((item) => String(item.id) === String(major.id)));
  return [...kept, ...restored];
}

/**
 * 与服务端基线对齐的「已保存快照」：只有版本号与快照一致时才可用于逐域比对。
 *
 * 先看本机已应用的快照；对不上时再看最近一次 409 回传的云端版本——冲突重试正是拿它当基线，
 * 否则每次冲突都会退回「整份提交」，把 A 段省下来的字节又还回去。
 * 两者都对不上（例如快照属于更早的版本）才返回 null，由调用方退回整份提交。
 */
function saveBaseSnapshot(baseUpdatedAt: number): ExamPayload | null {
  if (!(baseUpdatedAt > 0)) return null;
  const snapshot = getCloudSnapshot();
  if (snapshot && snapshot.updatedAt === baseUpdatedAt) return snapshot;
  const conflictBase = getConflictBaseSnapshot();
  return conflictBase && conflictBase.updatedAt === baseUpdatedAt ? conflictBase : null;
}

/** 冲突重试的基线：只在 409 之后写入，成功后清除。 */
function rememberConflictBase(payload: ExamPayload): void {
  try {
    localStorage.setItem(CLOUD_CONFLICT_BASE_KEY, JSON.stringify(payload));
  } catch {
    /* 隐私模式下退化为整份提交 */
  }
}

function getConflictBaseSnapshot(): ExamPayload | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CLOUD_CONFLICT_BASE_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parseExamPayload(parsed) : null;
  } catch {
    return null;
  }
}

function clearConflictBase(): void {
  try {
    localStorage.removeItem(CLOUD_CONFLICT_BASE_KEY);
  } catch {
    /* ignore */
  }
}

function toSaveSnapshot(input: SaveExamsInput): ExamSaveSnapshot {
  return {
    items: input.items,
    title: input.title ?? '',
    majors: input.majors ?? [],
    activeMajorId: input.activeMajorId ?? '',
    alerts: input.alerts,
    scheduleMode: input.scheduleMode,
    weeklyPlans: input.weeklyPlans,
    activeWeeklyPlanId: input.activeWeeklyPlanId,
    activeWeeklyPlanIdByClassId: input.activeWeeklyPlanIdByClassId,
    grades: input.grades,
    classes: input.classes,
    initialization: input.initialization,
    weeklyConflictPolicy: input.weeklyConflictPolicy,
  };
}

/** 最近一次保存提交了哪些域、多少字节；供「提交瘦身」观测与测试断言。 */
export interface ExamSaveSummary {
  domains: ExamSaveDomain[];
  bytes: number;
  skipped: boolean;
}

let lastSaveSummary: ExamSaveSummary | null = null;

export function getLastExamSaveSummary(): ExamSaveSummary | null {
  return lastSaveSummary;
}

function recordSaveSummary(domains: readonly ExamSaveDomain[], bytes: number, skipped: boolean): void {
  lastSaveSummary = { domains: [...domains], bytes, skipped };
  console.info(
    skipped
      ? '[examService] save skipped: 与服务端基线一致，未发起请求'
      : `[examService] save domains=${domains.join('+') || 'none'} bytes=${bytes}`,
  );
}

async function saveExamsToServerNow(input: SaveExamsInput): Promise<SaveExamsResult> {
  try {
    const baseUpdatedAt = input.baseUpdatedAt ?? Number(localStorage.getItem(CLOUD_VERSION_KEY) ?? 0);
    // 只提交改动的域：先与服务端基线快照逐域比对。拿不到可比基线（版本对不上或没有快照）
    // 时退回整份提交，行为与改动前完全一致。
    const base = saveBaseSnapshot(baseUpdatedAt);
    const diff = base && !input.action ? changedExamDomains(toSaveSnapshot(input), base) : null;
    if (diff && diff.domains.length === 0) {
      // 本地状态与服务端基线逐域一致：不发请求，直接按已保存处理，省掉一次全局写槽。
      recordSaveSummary([], 0, true);
      return baseUpdatedAt;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const requestBody: Record<string, unknown> = {
      ...(diff ? diff.body : fullExamSaveBody(toSaveSnapshot(input))),
      baseUpdatedAt,
    };
    // 有可比基线时同时给出域级修订号：服务端据此只校验「本次要写的域」，
    // 改不同域的两台设备不再互相 409。老服务端会忽略该字段，退回整行版本比较。
    const baseRevisions = base?.revisions;
    if (diff && baseRevisions !== undefined) requestBody.baseRevisions = baseRevisions;
    if (input.action) requestBody.action = input.action;
    recordSaveSummary(
      diff ? diff.domains : presentExamSaveDomains(requestBody),
      JSON.stringify(requestBody).length,
      false,
    );

    const res = await fetchWithTimeout(API_URL, { method: 'POST', headers, body: JSON.stringify(requestBody) }, 20_000);

    if (res.status === 401) {
      lastExamApiError = await apiErrorFromResponse(res, '登录状态已失效');
      logoutAdmin();
      return 'unauthorized';
    }
    if (res.status === 409) {
      const data = await res.json().catch(() => null);
      if (data?.code === 'DATA_CONFLICT' || data?.remote) {
        const remote = data?.remote ? parseExamPayload(data.remote) : null;
        // 记下服务端版本：调用方的三方合并会用 remote.updatedAt 重试，那时只有这份快照配得上该版本号。
        if (remote) rememberConflictBase(remote);
        return { kind: 'conflict', remote };
      }
      const replay = new Response(JSON.stringify(data), { status: res.status, headers: res.headers });
      const error = await apiErrorFromResponse(replay, '云端拒绝了本次保存');
      lastExamApiError = error;
      return { kind: 'error', error };
    }
    // V3：403 专门处理——区分「PASSWORD_CHANGE_REQUIRED」与「PERMISSION_DENIED」，
    // 避免前端统一展示为笼统的「权限不足」。真实错误文本已在 apiErrorFromResponse 中优先取服务端原始文本。
    if (!res.ok) {
      const error = await apiErrorFromResponse(res, '考试数据同步失败');
      lastExamApiError = error;
      return { kind: 'error', error };
    }
    const data = await res.json();
    if (!data?.ok) return null;
    if (input.action === 'initialize' && typeof data.recoveryKey === 'string') generatedRecoveryKey = data.recoveryKey;
    const updatedAt = Number(data.updatedAt ?? Date.now());
    // 本次提交已经落地，冲突基线作废；留着只会让后续版本号比较多一条擦边命中的可能。
    clearConflictBase();
    const frozen = Array.isArray(data.frozenMajors) ? (data.frozenMajors as MajorExam[]) : [];
    frozenArchivedMajors = frozen;
    // 归档条目按服务端版本写进基线快照：否则本地基线仍是"已删除/已改名"的旧值，
    // 下一次三方合并还会把这份错误差异当成"本机修改"再推一遍。
    const submittedMajors = input.majors ?? [];
    const majorsForBase = applyFrozenArchivedMajors(submittedMajors, frozen);
    const previousSnapshot = getCloudSnapshot();
    // 修订号基线：只采信「本次真正提交过」的域，其余域保留旧修订号——
    // 它们的本地内容仍基于旧版本，跟着换新号会变成静默覆盖别人改动。
    const submittedRevisionDomains = diff ? revisionDomainsFor(diff.domains) : EXAM_REVISION_DOMAINS;
    const mergedRevisions = mergeExamRevisions(
      previousSnapshot?.revisions ?? base?.revisions,
      data.revisions,
      submittedRevisionDomains,
    );
    const revisionsKnown = previousSnapshot?.revisions !== undefined || data.revisions !== undefined;
    rememberCloudSnapshot({
      items: input.items,
      title: input.title ?? '',
      majors: majorsForBase,
      activeMajorId: input.activeMajorId ?? '',
      alerts: input.alerts ?? null,
      ...(revisionsKnown ? { revisions: mergedRevisions } : {}),
      scheduleMode: input.scheduleMode ?? previousSnapshot?.scheduleMode,
      weeklyPlans: input.weeklyPlans ?? previousSnapshot?.weeklyPlans,
      activeWeeklyPlanId: input.activeWeeklyPlanId ?? previousSnapshot?.activeWeeklyPlanId,
      activeWeeklyPlanIdByClassId: input.activeWeeklyPlanIdByClassId ?? previousSnapshot?.activeWeeklyPlanIdByClassId,
      grades: input.grades ?? previousSnapshot?.grades,
      classes: input.classes ?? previousSnapshot?.classes,
      initialization: input.initialization ?? previousSnapshot?.initialization,
      weeklyConflictPolicy: input.weeklyConflictPolicy ?? previousSnapshot?.weeklyConflictPolicy,
      designPolicy: previousSnapshot?.designPolicy,
      majorBatchPresets: previousSnapshot?.majorBatchPresets,
      updatedAt,
    });
    lastExamApiError = null;
    return updatedAt;
  } catch (err) {
    const error = classifyFetchError(err);
    const wrappedError =
      error.code === 'NETWORK_UNAVAILABLE' || error.code === 'NETWORK_TIMEOUT'
        ? new ApiError({ ...error, message: '无法连接服务器，本机修改已保留，联网后会自动重试。' })
        : error;
    lastExamApiError = wrappedError;
    return { kind: 'error', error: wrappedError };
  }
}

/** 经全局 syncQueue 排队（高优先级）：与设备写入共享同一最小请求间隔，避免并发打爆 Neon 免费额度。 */
export async function saveExamsToServer(input: SaveExamsInput): Promise<SaveExamsResult> {
  // 有写入就作废快照复用窗口：否则紧接着的读取可能拿回写之前的快照。
  invalidateExamSnapshotReuse();
  return runQueued(() => saveExamsToServerNow(input), {
    priority: 'high',
    key: input.clientQueueKey,
    label: input.clientSyncLabel ?? '保存考试安排',
    supersededValue: input.clientQueueKey ? null : undefined,
  });
}

/** V3：失败时写入 localStorage 草稿，下次打开管理页可提示恢复。同样经全局队列排队（普通优先级）。 */
export async function saveDesignPolicy(designPolicy: DesignPolicy): Promise<DesignPolicy> {
  const token = localStorage.getItem(TOKEN_KEY) ?? '';
  try {
    const response = await runQueued(() =>
      fetchWithTimeout(
        API_URL,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ action: 'design-policy', designPolicy }),
        },
        20_000,
      ),
    );
    if (!response.ok) {
      const error = await apiErrorFromResponse(response, '考试端设计规则保存失败');
      saveDesignPolicyDraft(designPolicy, error.message);
      throw error;
    }
    const data = await response.json();
    if (!data?.designPolicy) throw new Error('服务器未返回设计规则');
    const saved = data.designPolicy as DesignPolicy;
    clearDesignPolicyDraft();
    const snapshot = getCloudSnapshot();
    if (snapshot)
      rememberCloudSnapshot({ ...snapshot, designPolicy: saved, updatedAt: Number(data.updatedAt ?? saved.updatedAt) });
    else localStorage.setItem(CLOUD_VERSION_KEY, String(data.updatedAt ?? saved.updatedAt));
    return saved;
  } catch (err) {
    if (!(err instanceof ApiError)) {
      const wrapped = classifyFetchError(err);
      saveDesignPolicyDraft(designPolicy, wrapped.message);
      throw wrapped;
    }
    throw err;
  }
}

export async function saveMajorBatchPresets(presets: {
  subjectGroups: unknown[];
  timeGroups: unknown[];
}): Promise<{ subjectGroups: unknown[]; timeGroups: unknown[]; updatedAt: number }> {
  const token = localStorage.getItem(TOKEN_KEY) ?? '';
  const response = await runQueued(() =>
    fetchWithTimeout(
      API_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'major-batch-presets', presets }),
      },
      20_000,
    ),
  );
  if (!response.ok) {
    const error = await apiErrorFromResponse(response, '批量预设保存失败');
    throw error;
  }
  const data = await response.json();
  if (!data?.majorBatchPresets) throw new Error('服务器未返回批量预设');
  const saved = data.majorBatchPresets;
  const snapshot = getCloudSnapshot();
  if (snapshot)
    rememberCloudSnapshot({
      ...snapshot,
      majorBatchPresets: saved,
      updatedAt: Number(data.updatedAt ?? saved.updatedAt),
    });
  else localStorage.setItem(CLOUD_VERSION_KEY, String(data.updatedAt ?? saved.updatedAt));
  return saved;
}

export async function isLoginRequired(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(LOGIN_URL, { method: 'GET', headers: { 'Cache-Control': 'no-store' } }, 10_000);
    if (!res.ok) {
      lastAuthApiError = await apiErrorFromResponse(res, '无法读取登录配置');
      return true;
    }
    const data = await res.json();
    lastAuthApiError = null;
    return !!data?.required;
  } catch (err) {
    lastAuthApiError = classifyFetchError(err);
    return true;
  }
}

export async function getAdminRecoveryStatus(): Promise<boolean> {
  const res = await fetchWithTimeout(
    `${LOGIN_URL}?action=recovery-status`,
    { headers: { 'Cache-Control': 'no-store' } },
    10_000,
  );
  if (!res.ok) throw await apiErrorFromResponse(res, '无法读取账户恢复配置');
  const data = await res.json();
  return data?.configured === true;
}

export async function recoverSuperAdminAccount(
  username: string,
  recoveryKey: string,
  newPassword: string,
): Promise<void> {
  const res = await fetchWithTimeout(
    LOGIN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'recover-super-admin', username, recoveryKey, newPassword }),
    },
    15_000,
  );
  if (!res.ok) throw await apiErrorFromResponse(res, '超级管理员账户恢复失败');
}

export async function repairSuperAdminAccount(
  username: string,
  recoveryKey: string,
  newPassword: string,
): Promise<{ created: boolean }> {
  const res = await fetchWithTimeout(
    LOGIN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'repair-super-admin', username, recoveryKey, newPassword }),
    },
    15_000,
  );
  const data = await res
    .clone()
    .json()
    .catch(() => null);
  if (!res.ok || data?.ok !== true) throw await apiErrorFromResponse(res, '超级管理员账户修复失败');
  return { created: data.created === true };
}

// 与后端 AdminScope 形状一致（实际上就是共享的 PermissionScope），保留本地名字以向后兼容现有引用方。
export type AdminScope = PermissionScope;
export type AdminUserContext = {
  id: number;
  username: string;
  displayName: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  scopes: AdminScope[];
  mustChangePassword: boolean;
};

export type LoginSession = {
  token: string | null;
  user: AdminUserContext | null;
};

function parseAdminUserContext(data: unknown): AdminUserContext | null {
  if (!data || typeof data !== 'object') return null;
  const u = data as Record<string, unknown>;
  if (typeof u.id !== 'number' || !Number.isFinite(u.id)) return null;
  if (typeof u.username !== 'string' || !u.username) return null;
  if (typeof u.displayName !== 'string' || typeof u.roleId !== 'string' || typeof u.roleName !== 'string') return null;
  if (!Array.isArray(u.permissions) || !u.permissions.every((p) => typeof p === 'string')) return null;
  if (!Array.isArray(u.scopes)) return null;
  const scopes: AdminScope[] = [];
  for (const scope of u.scopes) {
    const s = scope && typeof scope === 'object' ? (scope as Record<string, unknown>) : null;
    if (!s || (s.type !== 'all' && s.type !== 'grade' && s.type !== 'class')) return null;
    if (typeof s.gradeId !== 'string' || typeof s.classId !== 'string') return null;
    scopes.push({ type: s.type, gradeId: s.gradeId, classId: s.classId });
  }
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    roleId: u.roleId,
    roleName: u.roleName,
    permissions: u.permissions,
    scopes,
    mustChangePassword: u.mustChangePassword === true,
  };
}

export function getAdminUser(): AdminUserContext | null {
  try {
    return parseAdminUserContext(JSON.parse(localStorage.getItem(ADMIN_USER_KEY) || 'null'));
  } catch {
    return null;
  }
}

export function shouldPromptGradeAdminSetup(user: AdminUserContext | null): boolean {
  if (!user || user.roleId !== 'grade_admin' || user.mustChangePassword) return false;
  try {
    return localStorage.getItem(GRADE_ADMIN_FIRST_LOGIN_KEY) === String(user.id);
  } catch {
    return false;
  }
}

export function clearGradeAdminSetupPrompt(): void {
  try {
    localStorage.removeItem(GRADE_ADMIN_FIRST_LOGIN_KEY);
  } catch {
    /* storage optional */
  }
}

// 以下三个函数现在委托给 src/shared/permissionRules.ts 的共享实现，与后端 api/_auth.ts 的
// hasPermission/canAccessGrade/canAccessClass 保持完全一致的判断逻辑（注意：旧版 adminCanGrade 对年级范围的
// 判断曾与后端存在细微差异，现统一以后端的更严谨版本为准）。
export function adminCan(permission: string, user = getAdminUser()): boolean {
  return sharedHasPermission(user, permission);
}

export function adminCanGrade(gradeId: string, user = getAdminUser()): boolean {
  return sharedCanAccessGrade(user, gradeId);
}

export function adminCanClass(gradeId: string, classId: string, user = getAdminUser()): boolean {
  return sharedCanAccessClass(user, gradeId, classId);
}

/** V3：登录/进入管理页时主动刷新一次真实权限，消除前端 localStorage 缓存与服务端实际角色的漂移（见权限排查报告原因 5）。 */
export async function refreshAdminUser(): Promise<AdminUserContext | null> {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    const res = await fetchWithTimeout(
      `${LOGIN_URL}?action=me`,
      { headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-store' } },
      10_000,
    );
    if (!res.ok) {
      if (res.status === 401) logoutAdmin();
      return null;
    }
    const data = await res.json();
    if (!data?.user) return null;
    const user = parseAdminUserContext(data.user);
    if (!user) return null;
    localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(user));
    return user;
  } catch {
    return getAdminUser();
  }
}

export async function loginAdmin(username: string, password: string): Promise<LoginSession | null> {
  try {
    const res = await fetchWithTimeout(
      LOGIN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      },
      15_000,
    );
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      lastAuthApiError = await apiErrorFromResponse(
        new Response(JSON.stringify(data), { status: res.status, headers: res.headers }),
        '登录失败',
      );
      return null;
    }
    const token = typeof data.token === 'string' && data.token ? data.token : null;
    const user = parseAdminUserContext(data.user);
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(TOKEN_EXPIRES_KEY, String(data.expiresAt ?? 0));
    }
    if (user) {
      localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(user));
      if (data.firstLogin === true && user.roleId === 'grade_admin')
        localStorage.setItem(GRADE_ADMIN_FIRST_LOGIN_KEY, String(user.id));
    }
    lastAuthApiError = null;
    return { token, user };
  } catch (err) {
    lastAuthApiError = classifyFetchError(err);
    return null;
  }
}

export async function guestLogin(
  instanceId: string,
  gradeId: string,
  classId: string,
): Promise<{ token: string; user: AdminUserContext | null } | null> {
  try {
    const res = await fetchWithTimeout(
      LOGIN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'guest-login', instanceId, gradeId, classId }),
      },
      15_000,
    );
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      lastAuthApiError = await apiErrorFromResponse(
        new Response(JSON.stringify(data), { status: res.status, headers: res.headers }),
        '访客登录失败',
      );
      return null;
    }
    const token = typeof data.token === 'string' && data.token ? data.token : null;
    const user = parseAdminUserContext(data.user);
    storeAdminSession(token, Number(data.expiresAt ?? 0), user);
    lastAuthApiError = null;
    return { token: token ?? '', user };
  } catch (err) {
    lastAuthApiError = classifyFetchError(err);
    return null;
  }
}

export function storeAdminSession(
  token: string | null,
  expiresAt: number,
  user: AdminUserContext | null,
  firstLogin = false,
): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_EXPIRES_KEY, String(expiresAt ?? 0));
  }
  if (user) {
    localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(user));
    if (firstLogin === true && user.roleId === 'grade_admin')
      localStorage.setItem(GRADE_ADMIN_FIRST_LOGIN_KEY, String(user.id));
  }
}

export function hasValidLocalToken(): boolean {
  const token = localStorage.getItem(TOKEN_KEY);
  const expires = Number(localStorage.getItem(TOKEN_EXPIRES_KEY) ?? 0);
  if (!token) return false;
  if (expires && Date.now() > expires) {
    logoutAdmin();
    return false;
  }
  return true;
}

export function logoutAdmin(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRES_KEY);
  localStorage.removeItem(ADMIN_USER_KEY);
}

// ─────────────────────────────────────────────────────────────────
// resetCloudData
// 重置云端指定类别数据。调用方只需传入 categories（"all"|"major"|...
// ），内部统一处理 Token / 错误分类，不再散落在页面层用 raw fetch。
// ─────────────────────────────────────────────────────────────────
export type ResetCategory = 'all' | 'major' | 'weekly' | 'school' | 'settings' | 'devices';

export async function resetCloudData(categories: ResetCategory[]): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY) ?? '';
  const response = await fetchWithTimeout(
    API_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action: 'reset-data', categories }),
    },
    30_000,
  );
  if (!response.ok) {
    // Preserve the original response body for apiErrorFromResponse
    const body = await response.text();
    const replay = new Response(body, { status: response.status, headers: response.headers });
    throw await apiErrorFromResponse(replay, '数据库重置失败');
  }
  const data = await response.json().catch(() => null);
  if (!data?.ok) {
    throw new Error((data?.error as string | undefined) ?? '数据库重置失败');
  }
}
