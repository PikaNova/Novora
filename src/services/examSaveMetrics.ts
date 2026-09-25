/**
 * 保存通道的自观测指标。
 *
 * 起因：提交瘦身与域级版本改完之后，「到底省了多少字节、409 还剩多少、冲突集中在哪个域」
 * 只能靠开发者控制台的临时日志看，线上无法回答。这里把每次提交与每次冲突累加成计数与分布，
 * 存进 localStorage，供管理界面与错误上报读取。
 *
 * 边界：只存计数、字节数与域名（域名是代码里的固定枚举），不含任何考试内容或用户数据。
 */
import type { ErrorReportContext } from '../shared/errorReportContracts';

const STORAGE_KEY = 'novora_exam_save_metrics_v1';
/** 字节数只保留最近若干次样本，用于算分位数；再多也只是重复存储。 */
const MAX_BYTE_SAMPLES = 100;
/** 域名分布最多保留这些键，避免旧版本遗留的未知域名把存储撑大。 */
const MAX_DOMAIN_KEYS = 24;

export interface ExamSaveMetrics {
  /** 真正提交出去的次数（不含 no-op 跳过）。 */
  submits: number;
  /** 因「与服务端基线一致」而直接跳过、未发起请求的次数。 */
  skipped: number;
  /** 服务端返回 409 的次数。 */
  conflicts: number;
  bytesTotal: number;
  bytesLast: number;
  bytesMax: number;
  bytesSamples: number[];
  /** 各保存域被提交的次数。 */
  domains: Record<string, number>;
  /** 各修订域发生冲突的次数（老服务端不带 `conflicts` 时记入 `unspecified`）。 */
  conflictDomains: Record<string, number>;
}

function empty(): ExamSaveMetrics {
  return {
    submits: 0,
    skipped: 0,
    conflicts: 0,
    bytesTotal: 0,
    bytesLast: 0,
    bytesMax: 0,
    bytesSamples: [],
    domains: {},
    conflictDomains: {},
  };
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function countMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, MAX_DOMAIN_KEYS)) {
    const count = finite(raw);
    if (count > 0) result[key] = count;
  }
  return result;
}

/** 读取累计指标；存储缺失或损坏时给出全零对象，绝不抛错。 */
export function getExamSaveMetrics(): ExamSaveMetrics {
  const raw = store()?.getItem(STORAGE_KEY);
  if (!raw) return empty();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      submits: finite(parsed.submits),
      skipped: finite(parsed.skipped),
      conflicts: finite(parsed.conflicts),
      bytesTotal: finite(parsed.bytesTotal),
      bytesLast: finite(parsed.bytesLast),
      bytesMax: finite(parsed.bytesMax),
      bytesSamples: Array.isArray(parsed.bytesSamples)
        ? parsed.bytesSamples.slice(-MAX_BYTE_SAMPLES).map((value) => finite(value))
        : [],
      domains: countMap(parsed.domains),
      conflictDomains: countMap(parsed.conflictDomains),
    };
  } catch {
    return empty();
  }
}

function write(metrics: ExamSaveMetrics): void {
  try {
    store()?.setItem(STORAGE_KEY, JSON.stringify(metrics));
  } catch {
    /* 隐私模式/配额满时只是没有指标，不影响保存 */
  }
}

function topEntries(counts: Record<string, number>, limit: number): string {
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key, count]) => `${key}:${count}`)
    .join(',');
}

/** 记录一次保存尝试（含 no-op 跳过）。 */
export function recordExamSave(input: { domains: readonly string[]; bytes: number; skipped: boolean }): void {
  const metrics = getExamSaveMetrics();
  if (input.skipped) {
    metrics.skipped += 1;
    write(metrics);
    return;
  }
  const bytes = finite(input.bytes);
  metrics.submits += 1;
  metrics.bytesTotal += bytes;
  metrics.bytesLast = bytes;
  metrics.bytesMax = Math.max(metrics.bytesMax, bytes);
  metrics.bytesSamples = [...metrics.bytesSamples, bytes].slice(-MAX_BYTE_SAMPLES);
  for (const domain of new Set(input.domains)) {
    metrics.domains[domain] = (metrics.domains[domain] ?? 0) + 1;
  }
  write(metrics);
}

/** 记录一次 409。`domains` 来自服务端的 `conflicts`（老服务端为空）。 */
export function recordExamSaveConflict(domains: readonly string[]): void {
  const metrics = getExamSaveMetrics();
  metrics.conflicts += 1;
  const keys = domains.length ? [...new Set(domains)] : ['unspecified'];
  for (const domain of keys) metrics.conflictDomains[domain] = (metrics.conflictDomains[domain] ?? 0) + 1;
  write(metrics);
}

/** 最近样本的 p 分位（0–100）。样本为空时返回 0。 */
export function percentile(samples: readonly number[], p: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

/**
 * 给错误上报的同步快照用的扁平键值（作者端直接展示）。
 * 只挑最关键的六项，避免挤掉其它快照字段。
 */
export function examSaveMetricsContext(): ErrorReportContext {
  const metrics = getExamSaveMetrics();
  const average = metrics.submits ? Math.round(metrics.bytesTotal / metrics.submits) : 0;
  return {
    saveSubmits: metrics.submits,
    saveSkipped: metrics.skipped,
    saveConflicts: metrics.conflicts,
    saveBytesAvg: average,
    saveBytesP95: percentile(metrics.bytesSamples, 95),
    saveBytesMax: metrics.bytesMax,
    saveDomainsTop: topEntries(metrics.domains, 5) || '-',
    saveConflictDomainsTop: topEntries(metrics.conflictDomains, 5) || '-',
  };
}

export function __resetExamSaveMetricsForTests(): void {
  try {
    store()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
