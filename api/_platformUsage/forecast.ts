// 用量预测：回答「按现在的速度，本周期会不会用完、大概第几天用完」。
//
// 设计要点：
//
//   1. 用**中位数**而不是平均值当典型速度。真实账号的用量极度突发（同一个团队
//      7 月 1,337,528 次请求、9 月 18,809 次），平均值会被一次爆发彻底带偏。
//   2. 免费额度按周期重置，所以「还能用 47 天」没有意义。真正有用的是
//      「会不会在周期结束前用尽」——天数必须和「距周期结束还有几天」比。
//   3. 样本不足就不预测。宁可显示「样本不足」，也不拿两天的数据外推一整月。
//   4. 纯函数：输入上限、已用、日序列、周期起止与当前时间，输出结论。
//      不碰数据库、不发请求，方便单测。

export type ForecastPoint = { date: string; value: number };

/** 预测状态：ok 可预测；insufficient 样本不足；no-usage 没有消耗；exceeded 已超限。 */
export type ForecastStatus = 'ok' | 'insufficient' | 'no-usage' | 'exceeded';

/** 速度的口径：period = 只用本周期内的样本；window = 本周期样本不足，退回整个窗口。 */
export type ForecastBasis = 'period' | 'window';

export type ForecastResult = {
  status: ForecastStatus;
  basis: ForecastBasis | null;
  /** 参与计算的样本天数。 */
  sampleDays: number;
  /** 典型日用量（中位数）；无样本时为 null。 */
  dailyRate: number | null;
  /** 近 7 天均值，用于和典型速度对照。 */
  recentDailyRate: number | null;
  /** 上限 − 已用；未设上限时为 null。 */
  remaining: number | null;
  /** 距周期结束还有几天；没有周期信息时为 null。 */
  daysToPeriodEnd: number | null;
  /** 预计还能撑几天；无法预测时为 null。 */
  daysLeft: number | null;
  /** 是否会在本周期内用尽；没有周期信息时为 null。 */
  exhaustsWithinPeriod: boolean | null;
  /** 预计用尽日期（YYYY-MM-DD）；不会用尽或无法预测时为 null。 */
  projectedExhaustDate: string | null;
  /** 近 7 天速度与典型速度相差 3 倍以上。 */
  volatile: boolean;
};

const DAY_MS = 86_400_000;
/** 少于这么多天的样本不做外推。 */
export const MIN_SAMPLE_DAYS = 3;
/** 近 7 天均值与中位数相差超过这个倍数就认为波动大。 */
const VOLATILE_RATIO = 3;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toDayNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function emptyResult(overrides: Partial<ForecastResult> = {}): ForecastResult {
  return {
    status: 'insufficient',
    basis: null,
    sampleDays: 0,
    dailyRate: null,
    recentDailyRate: null,
    remaining: null,
    daysToPeriodEnd: null,
    daysLeft: null,
    exhaustsWithinPeriod: null,
    projectedExhaustDate: null,
    volatile: false,
    ...overrides,
  };
}

export type ForecastInput = {
  /** 本周期已用量。 */
  used: number;
  /** 上限；null 表示没有上限，无法预测。 */
  limit: number | null | undefined;
  /** 按天（或按月）的用量序列，日期升序或乱序均可。 */
  series?: readonly ForecastPoint[] | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  now: number;
};

export function forecastUsage(input: ForecastInput): ForecastResult {
  const limit = typeof input.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0 ? input.limit : null;
  const used = Number.isFinite(input.used) ? Math.max(0, input.used) : 0;
  const periodStartMs = toDayNumber(input.periodStart);
  const periodEndMs = toDayNumber(input.periodEnd);
  const daysToPeriodEnd = periodEndMs != null ? Math.max(0, Math.ceil((periodEndMs - input.now) / DAY_MS)) : null;

  if (limit == null) return emptyResult({ daysToPeriodEnd });

  const remaining = limit - used;
  if (remaining <= 0) {
    return emptyResult({
      status: 'exceeded',
      remaining,
      daysToPeriodEnd,
      daysLeft: 0,
      exhaustsWithinPeriod: true,
    });
  }

  // 只统计落在本周期内的样本；样本足够就用它，否则退回整个窗口。
  const points = (input.series ?? [])
    .map((point) => ({ at: toDayNumber(point.date), value: point.value }))
    .filter((point): point is { at: number; value: number } => point.at != null && Number.isFinite(point.value))
    .filter((point) => point.at <= input.now)
    .sort((a, b) => a.at - b.at);

  const inPeriod = periodStartMs != null ? points.filter((point) => point.at >= periodStartMs) : points;
  const usePeriod = inPeriod.length >= MIN_SAMPLE_DAYS;
  const sample = usePeriod ? inPeriod : points;
  if (sample.length < MIN_SAMPLE_DAYS) {
    return emptyResult({ remaining, daysToPeriodEnd, sampleDays: sample.length });
  }

  const values = sample.map((point) => point.value);
  const dailyRate = median(values);
  const recentDailyRate = mean(values.slice(-7));
  const volatile =
    dailyRate != null &&
    dailyRate > 0 &&
    recentDailyRate != null &&
    (recentDailyRate / dailyRate > VOLATILE_RATIO || recentDailyRate / dailyRate < 1 / VOLATILE_RATIO);

  const base = {
    basis: (usePeriod ? 'period' : 'window') as ForecastBasis,
    sampleDays: sample.length,
    dailyRate,
    recentDailyRate,
    remaining,
    daysToPeriodEnd,
    volatile,
  };

  // 速度为零：本周期不会用尽，但没有「还能用几天」这回事。
  if (dailyRate == null || dailyRate <= 0) {
    return { ...emptyResult(), ...base, status: 'no-usage', exhaustsWithinPeriod: false };
  }

  const daysLeft = Math.ceil(remaining / dailyRate);
  const exhaustsWithinPeriod = daysToPeriodEnd == null ? null : daysLeft <= daysToPeriodEnd;
  return {
    ...emptyResult(),
    ...base,
    status: 'ok',
    daysLeft,
    exhaustsWithinPeriod,
    projectedExhaustDate: exhaustsWithinPeriod ? isoDate(input.now + daysLeft * DAY_MS) : null,
  };
}

/**
 * 把「累计用量」采样点换算成「日均速度」序列。
 *
 * 平台自己给的日桶是每天的量，可以直接用；而我们自己记的历史是**累计值**（某个时刻
 * 本周期已用多少），不能当成每日用量。相邻两次采样求差再除以相隔天数，才得到速度。
 * 用量回落（周期重置）的点直接丢掉，否则一个巨大的负值会把中位数带偏。
 */
export function cumulativeToDailyRates(points: readonly ForecastPoint[]): ForecastPoint[] {
  const sorted = points
    .map((point) => ({ at: Date.parse(point.date), value: point.value }))
    .filter((point) => Number.isFinite(point.at) && Number.isFinite(point.value))
    .sort((a, b) => a.at - b.at);

  const rates: ForecastPoint[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const days = (current.at - previous.at) / DAY_MS;
    if (!Number.isFinite(days) || days <= 0) continue;
    const delta = current.value - previous.value;
    if (delta < 0) continue;
    rates.push({ date: new Date(current.at).toISOString(), value: delta / days });
  }
  return rates;
}
