// Neon 免费计划额度适配器。
//
// 2026-10-01 用真实免费账号实测（5 个项目交叉验证）之后的事实边界：
//
//   - `consumption_history/*` 按时间粒度的历史接口只对付费计划开放，这里完全不用。
//   - `GET /projects/{project_id}` 虽然文档里带 consumption 字段，但免费账号下
//     `active_time_seconds` / `compute_time_seconds` / `written_data_bytes` /
//     `data_transfer_bytes` / `data_storage_bytes_hour` / `cpu_used_sec` **全部恒为 0**，
//     且 `quota` 为 null。所以 Compute 与公网传输在免费版读不出来。
//   - 唯一有真实值的是存储：`synthetic_storage_size` 以及各分支的 `logical_size`。
//
// 因此这里的策略是：只报能读到的（存储），读不到的指标不摆一个 0 出来充数，
// 而是在提示里说明「免费版读不到，请到控制台看」。
import type { PlatformMetric, PlatformProviderSnapshot } from './types.js';

const API_BASE = 'https://console.neon.tech/api/v2';
const CONSOLE_BASE = 'https://console.neon.tech/app/projects';
const GB = 1_000_000_000;

/** Neon Free 文档额度：100 CU-hours/项目/月、0.5 GB/项目、5 GB 公网传输/项目/月。 */
export const NEON_FREE_LIMITS = {
  computeCuHours: 100,
  storageBytes: 500_000_000,
  transferBytes: 5_000_000_000,
};

/** 单次刷新最多检查的项目数，避免把免费版的请求额度吃光。 */
const MAX_PROJECTS = 5;

type Failure = { ok: false; status: number; message: string };
type NeonResponse<T> = { ok: true; data: T } | Failure;
type OrganizationResult = { ok: true; id: string } | Failure;

function isFailure(value: NeonResponse<unknown> | OrganizationResult): value is Failure {
  return value.ok === false;
}

async function neonGet<T>(path: string, apiKey: string): Promise<NeonResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = `Neon API 返回 HTTP ${response.status}`;
      try {
        const body = (await response.json()) as { message?: unknown };
        if (typeof body?.message === 'string' && body.message) message = body.message;
      } catch {
        /* 保留默认信息 */
      }
      return { ok: false, status: response.status, message };
    }
    return { ok: true, data: (await response.json()) as T };
  } catch (error) {
    return { ok: false, status: 0, message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function toIso(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

type OrganizationOption = { id: string; name: string; plan: string };

function organizationOptions(value: unknown): OrganizationOption[] {
  const list = Array.isArray(value) ? value : [];
  const options: OrganizationOption[] = [];
  for (const item of list) {
    const record = asRecord(item);
    if (typeof record.id !== 'string' || !record.id) continue;
    options.push({
      id: record.id,
      name: typeof record.name === 'string' && record.name ? record.name : record.id,
      plan: typeof record.plan === 'string' ? record.plan : '',
    });
  }
  return options;
}

/**
 * 从 Key 可访问的组织里挑一个。
 *
 * 有多个组织时**把候选列在报错信息里**——「请在设置里指定组织 ID」而不告诉用户有哪些 ID，
 * 等于把找 ID 的活儿又推回给用户，而这正是最容易卡住的一步。
 */
function pickOrganization(options: OrganizationOption[]): OrganizationResult {
  if (options.length === 1) return { ok: true, id: options[0].id };
  if (!options.length) return { ok: false, status: 0, message: '该 API Key 下没有可访问的 Neon 组织。' };
  const listed = options
    .slice(0, 6)
    .map((option) => `${option.name}（${option.id}${option.plan ? `, ${option.plan}` : ''}）`)
    .join('、');
  return {
    ok: false,
    status: 0,
    message: `该 API Key 可访问 ${options.length} 个组织，请在设置里填写组织 ID。可选：${listed}`,
  };
}

async function resolveOrganization(apiKey: string, configured?: string): Promise<OrganizationResult> {
  if (configured) return { ok: true, id: configured };

  const personal = await neonGet<{ organizations?: unknown }>('/users/me/organizations', apiKey);
  if (!isFailure(personal)) return pickOrganization(organizationOptions(personal.data.organizations));

  // 组织级 API Key 访问不了 /users/me/*，退回组织列表接口。
  const scoped = await neonGet<{ organizations?: unknown }>('/organizations', apiKey);
  if (!isFailure(scoped)) return pickOrganization(organizationOptions(scoped.data.organizations));

  return { ok: false, status: personal.status, message: personal.message };
}

export type NeonProjectUsage = {
  projectId: string;
  name: string;
  computeSeconds: number;
  transferBytes: number;
  storageBytes: number | null;
  periodStart: string | null;
  periodEnd: string | null;
};

export type NeonCollectInput = {
  apiKey: string;
  organizationId?: string;
  projectId?: string;
  /** 来自我们自己数据库的自测存储大小；分支数据不可用时用它兜底。 */
  selfMeasuredStorageBytes?: number | null;
  now?: number;
};

async function readProjectUsage(
  apiKey: string,
  projectId: string,
  selfMeasuredStorageBytes: number | null | undefined,
): Promise<NeonProjectUsage | { error: string }> {
  const detail = await neonGet<{ project?: unknown }>(`/projects/${encodeURIComponent(projectId)}`, apiKey);
  if (isFailure(detail)) return { error: detail.message };
  const project = asRecord(detail.data.project);

  // 分支逻辑大小才是「当前存储」。`synthetic_storage_size` 作为整包兜底，
  // 我们自己测到的 pg_database_size 再兜一层（它只覆盖当前分支）。
  let storageBytes: number | null = null;
  const branches = await neonGet<{ branches?: unknown }>(`/projects/${encodeURIComponent(projectId)}/branches`, apiKey);
  if (!isFailure(branches)) {
    const list = Array.isArray(branches.data.branches) ? branches.data.branches : [];
    let total = 0;
    let known = 0;
    for (const item of list) {
      const size = numeric(asRecord(item).logical_size);
      if (size != null) {
        total += size;
        known += 1;
      }
    }
    if (known > 0) storageBytes = total;
  }
  if (storageBytes == null) storageBytes = numeric(project.synthetic_storage_size);
  if (storageBytes == null && typeof selfMeasuredStorageBytes === 'number' && selfMeasuredStorageBytes > 0) {
    storageBytes = selfMeasuredStorageBytes;
  }

  return {
    projectId,
    name: typeof project.name === 'string' && project.name ? project.name : projectId,
    computeSeconds: numeric(project.compute_time_seconds) ?? 0,
    transferBytes: numeric(project.data_transfer_bytes) ?? 0,
    storageBytes,
    periodStart: toIso(project.consumption_period_start),
    periodEnd: toIso(project.consumption_period_end),
  };
}

function percentOf(used: number, limit: number): number | null {
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return Number(((used / limit) * 100).toFixed(2));
}

/** 没有读数时只列文档额度，且不给百分比。 */
export function neonDeclarativeMetrics(): PlatformMetric[] {
  return [
    { key: 'storage', label: 'Storage', used: 0, limit: NEON_FREE_LIMITS.storageBytes / GB, unit: 'GB', percent: null },
    {
      key: 'compute',
      label: 'Compute',
      used: 0,
      limit: NEON_FREE_LIMITS.computeCuHours,
      unit: 'CU-hrs',
      percent: null,
    },
    {
      key: 'egress',
      label: 'Public network transfer',
      used: 0,
      limit: NEON_FREE_LIMITS.transferBytes / GB,
      unit: 'GB',
      percent: null,
    },
  ];
}

const UNREADABLE_NOTE = 'Compute 与公网传输在免费版接口里恒为 0，读不出来，请到 Neon 控制台查看。';

export async function collectNeonUsage(input: NeonCollectInput): Promise<PlatformProviderSnapshot> {
  const now = input.now ?? Date.now();
  const base: PlatformProviderSnapshot = {
    provider: 'neon',
    label: 'Neon',
    status: 'unsupported',
    message: '',
    observedAt: null,
    periodStart: null,
    periodEnd: null,
    metrics: neonDeclarativeMetrics(),
    consoleUrl: input.projectId
      ? `${CONSOLE_BASE}/${encodeURIComponent(input.projectId)}`
      : 'https://console.neon.tech',
    source: 'neon-api',
    accountLabel: input.organizationId ?? null,
    stale: false,
  };

  const organization = await resolveOrganization(input.apiKey, input.organizationId);
  if (isFailure(organization)) {
    if (organization.status === 401 || organization.status === 403) {
      return { ...base, status: 'credential_error', message: 'Neon API Key 无效或权限不足，请重新填写。' };
    }
    if (organization.status === 429) {
      return { ...base, status: 'rate_limited', message: 'Neon 接口触发限流，请稍后再试。' };
    }
    return { ...base, status: 'error', message: organization.message };
  }

  const listResult = await neonGet<{ projects?: unknown }>(
    `/projects?org_id=${encodeURIComponent(organization.id)}&limit=${MAX_PROJECTS}`,
    input.apiKey,
  );
  if (isFailure(listResult)) {
    if (listResult.status === 401 || listResult.status === 403) {
      return { ...base, status: 'credential_error', message: 'Neon API Key 无效或权限不足，请重新填写。' };
    }
    if (listResult.status === 429) {
      return { ...base, status: 'rate_limited', message: 'Neon 接口触发限流，请稍后再试。' };
    }
    return { ...base, status: 'error', message: listResult.message };
  }

  const listed = Array.isArray(listResult.data.projects) ? listResult.data.projects : [];
  const allIds = listed
    .map((item) => asRecord(item).id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const projectIds = input.projectId ? [input.projectId] : allIds.slice(0, MAX_PROJECTS);
  if (!projectIds.length) {
    return { ...base, status: 'unsupported', message: '该 Neon 组织下没有可读取的项目。' };
  }

  const usages: NeonProjectUsage[] = [];
  let lastError = '';
  for (const projectId of projectIds) {
    const usage = await readProjectUsage(input.apiKey, projectId, input.selfMeasuredStorageBytes);
    if ('error' in usage) lastError = usage.error;
    else usages.push(usage);
  }
  if (!usages.length) {
    return { ...base, status: 'error', message: lastError || 'Neon 项目用量读取失败。' };
  }

  const metrics: PlatformMetric[] = [];

  // 存储：唯一在免费版能读到的真实指标。
  const storageReadings = usages
    .filter((usage): usage is NeonProjectUsage & { storageBytes: number } => usage.storageBytes != null)
    .map((usage) => ({ project: usage.name, bytes: usage.storageBytes }));
  if (storageReadings.length) {
    const worst = storageReadings.reduce((a, b) => (b.bytes > a.bytes ? b : a));
    const used = Number((worst.bytes / GB).toFixed(3));
    const limit = NEON_FREE_LIMITS.storageBytes / GB;
    metrics.push({
      key: 'storage',
      label: 'Storage（分支逻辑大小）',
      used,
      limit,
      unit: 'GB',
      percent: percentOf(used, limit),
      note: storageReadings.length > 1 ? `最高：${worst.project}` : `项目：${worst.project}`,
    });
  }

  // 下面两项只在接口真的给出非零值时才出现——免费版恒为 0，摆出来等于谎报「没用量」。
  const computeSeconds = Math.max(...usages.map((usage) => usage.computeSeconds));
  if (computeSeconds > 0) {
    const used = Number((computeSeconds / 3600).toFixed(3));
    metrics.push({
      key: 'compute',
      label: 'Compute',
      used,
      limit: NEON_FREE_LIMITS.computeCuHours,
      unit: 'CU-hrs',
      percent: percentOf(used, NEON_FREE_LIMITS.computeCuHours),
    });
  }
  const transferBytes = Math.max(...usages.map((usage) => usage.transferBytes));
  if (transferBytes > 0) {
    const used = Number((transferBytes / GB).toFixed(3));
    const limit = NEON_FREE_LIMITS.transferBytes / GB;
    metrics.push({
      key: 'egress',
      label: 'Public network transfer',
      used,
      limit,
      unit: 'GB',
      percent: percentOf(used, limit),
    });
  }

  if (!metrics.length) {
    return { ...base, status: 'unsupported', message: `Neon 未返回可识别的用量字段。${UNREADABLE_NOTE}` };
  }

  const periodStart = usages.find((usage) => usage.periodStart)?.periodStart ?? null;
  const periodEnd = usages.find((usage) => usage.periodEnd)?.periodEnd ?? null;
  const scopeNote =
    allIds.length > projectIds.length ? `仅检查前 ${projectIds.length} 个项目（共 ${allIds.length} 个）。` : '';
  const notes = [UNREADABLE_NOTE];
  if (scopeNote) notes.push(scopeNote);

  const storageMetric = metrics.find((metric) => metric.key === 'storage');
  return {
    ...base,
    status:
      storageMetric?.percent != null && storageMetric.percent >= 95
        ? 'critical'
        : storageMetric?.percent != null && storageMetric.percent >= 80
          ? 'warning'
          : 'ok',
    message: `数据来自 Neon 项目接口，可能有最多 1 小时延迟。${notes.join(' ')}`,
    observedAt: now,
    periodStart,
    periodEnd,
    metrics,
    accountLabel: organization.id,
    consoleUrl: `${CONSOLE_BASE}/${encodeURIComponent(usages[0].projectId)}`,
  };
}
