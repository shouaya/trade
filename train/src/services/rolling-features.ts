const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface RollingFeatureKlineLike {
  readonly open_time: number | string;
  readonly open?: number | string | null;
  readonly high?: number | string | null;
  readonly low?: number | string | null;
  readonly close?: number | string | null;
  readonly bid_open?: number | string | null;
  readonly bid_high?: number | string | null;
  readonly bid_low?: number | string | null;
  readonly bid_close?: number | string | null;
  readonly ask_open?: number | string | null;
  readonly ask_high?: number | string | null;
  readonly ask_low?: number | string | null;
  readonly ask_close?: number | string | null;
}

interface PeriodAccumulator {
  key: string;
  count: number;
  firstOpen: number;
  lastClose: number;
  sumSquaredLogReturns: number;
  sumAbsReturnPct: number;
  sumRangePct: number;
  maxAbsReturnPct: number;
  maxRangePct: number;
  upMinutes: number;
  openingWindowCount: number;
  openingWindowClose: number;
}

export interface PeriodFeature {
  readonly key: string;
  readonly minutes: number;
  readonly realizedVolPct: number;
  readonly avgAbsReturnPct: number;
  readonly avgRangePct: number;
  readonly maxAbsReturnPct: number;
  readonly maxRangePct: number;
  readonly returnPct: number;
  readonly upMinuteRatio: number;
  readonly trendEfficiency: number;
  readonly volExpansionRatio: number;
  readonly openingImpulse: number;
  readonly reversalStrength: number;
  readonly featureBucket: string;
  readonly positiveStrategyRatio?: number;
  readonly bestVsMedianGap?: number;
  readonly monthlyWeeklyAlignment?: number;
  readonly weeklyDailyAlignment?: number;
}

export interface PeriodFeatureBuildOptions {
  readonly openingWindowCount?: number;
  readonly volBaselineLookback?: number;
}

export interface PoolHealthMetrics {
  readonly positiveStrategyRatio: number;
  readonly bestVsMedianGap: number;
}

export function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

export function toJstDate(timestampMs: number): Date {
  return new Date(timestampMs + JST_OFFSET_MS);
}

export function getJstDayKey(timestampMs: number): string {
  const date = toJstDate(timestampMs);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function getJstMonthKey(timestampMs: number): string {
  const date = toJstDate(timestampMs);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function getIsoWeekKey(timestampMs: number): string {
  const date = toJstDate(timestampMs);
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function detectMonthlyFeatureBucket(returnPct: number, realizedVolPct: number): string {
  if (returnPct <= -8 && realizedVolPct >= 9) return 'crash-trend';
  if (returnPct >= 8 && realizedVolPct >= 9) return 'strong-trend';
  if (Math.abs(returnPct) <= 3 && realizedVolPct < 8) return 'range-low-vol';
  if (Math.abs(returnPct) <= 6) return 'range-mid-vol';
  return 'mixed-trend';
}

export function detectWeeklyFeatureBucket(returnPct: number, realizedVolPct: number): string {
  if (returnPct <= -4 && realizedVolPct >= 5) return 'crash-trend';
  if (returnPct >= 4 && realizedVolPct >= 5) return 'strong-trend';
  if (Math.abs(returnPct) <= 1.5 && realizedVolPct < 4) return 'range-low-vol';
  if (Math.abs(returnPct) <= 3.5) return 'range-mid-vol';
  return 'mixed-trend';
}

export function detectDailyFeatureBucket(returnPct: number, realizedVolPct: number): string {
  if (returnPct <= -2.5 && realizedVolPct >= 2.5) return 'crash-trend';
  if (returnPct >= 2.5 && realizedVolPct >= 2.5) return 'strong-trend';
  if (Math.abs(returnPct) <= 0.8 && realizedVolPct < 2.2) return 'range-low-vol';
  if (Math.abs(returnPct) <= 1.5) return 'range-mid-vol';
  return 'mixed-trend';
}

export function extractPrice(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function choosePrice(row: RollingFeatureKlineLike, field: 'open' | 'high' | 'low' | 'close'): number | null {
  if (field === 'open') {
    return extractPrice(row.open) ?? extractPrice(row.bid_open) ?? extractPrice(row.ask_open);
  }
  if (field === 'high') {
    return extractPrice(row.high) ?? extractPrice(row.bid_high) ?? extractPrice(row.ask_high);
  }
  if (field === 'low') {
    return extractPrice(row.low) ?? extractPrice(row.bid_low) ?? extractPrice(row.ask_low);
  }
  return extractPrice(row.close) ?? extractPrice(row.bid_close) ?? extractPrice(row.ask_close);
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
  return sorted[middle]!;
}

export function buildPoolHealthMetrics(values: readonly number[]): PoolHealthMetrics {
  if (!values.length) {
    return {
      positiveStrategyRatio: 0,
      bestVsMedianGap: 0
    };
  }

  const sortedDesc = [...values].sort((left, right) => right - left);
  const positiveCount = values.filter((value) => value > 0).length;
  const best = sortedDesc[0] ?? 0;
  const middle = median(values);

  return {
    positiveStrategyRatio: round((positiveCount / values.length) * 100, 2),
    bestVsMedianGap: round(best - middle, 4)
  };
}

function classifyDirectionalState(feature: PeriodFeature | null): 'up' | 'down' | 'range' | 'unknown' {
  if (!feature) return 'unknown';
  if (feature.featureBucket.startsWith('range') || Math.abs(feature.returnPct) < 0.25) {
    return 'range';
  }
  if (feature.returnPct > 0) return 'up';
  if (feature.returnPct < 0) return 'down';
  return 'unknown';
}

export function computeAlignmentScore(parent: PeriodFeature | null, child: PeriodFeature | null): number {
  const parentState = classifyDirectionalState(parent);
  const childState = classifyDirectionalState(child);

  if (parentState === 'unknown' || childState === 'unknown') {
    return 0;
  }
  if (parentState === childState) {
    return 1;
  }
  if (parentState === 'range' || childState === 'range') {
    return 0.5;
  }
  return 0;
}

export function buildPeriodFeatures<T extends RollingFeatureKlineLike>(
  klines: readonly T[],
  getKey: (timestampMs: number) => string,
  detectBucket: (returnPct: number, realizedVolPct: number) => string,
  options: PeriodFeatureBuildOptions = {}
): readonly PeriodFeature[] {
  const periods = new Map<string, PeriodAccumulator>();
  const openingWindowCount = options.openingWindowCount ?? 60;
  const volBaselineLookback = options.volBaselineLookback ?? 8;

  for (const row of klines) {
    const openTime = Number(row.open_time);
    const open = choosePrice(row, 'open');
    const high = choosePrice(row, 'high');
    const low = choosePrice(row, 'low');
    const close = choosePrice(row, 'close');

    if (!Number.isFinite(openTime) || open === null || high === null || low === null || close === null || open <= 0 || close <= 0) {
      continue;
    }

    const key = getKey(openTime);
    let period = periods.get(key);
    if (!period) {
      period = {
        key,
        count: 0,
        firstOpen: open,
        lastClose: close,
        sumSquaredLogReturns: 0,
        sumAbsReturnPct: 0,
        sumRangePct: 0,
        maxAbsReturnPct: 0,
        maxRangePct: 0,
        upMinutes: 0,
        openingWindowCount: 0,
        openingWindowClose: close
      };
      periods.set(key, period);
    }

    const logReturn = Math.log(close / open);
    const absReturnPct = Math.abs(logReturn) * 100;
    const rangePct = ((high - low) / open) * 100;

    period.count += 1;
    period.lastClose = close;
    period.sumSquaredLogReturns += logReturn * logReturn;
    period.sumAbsReturnPct += absReturnPct;
    period.sumRangePct += rangePct;
    period.maxAbsReturnPct = Math.max(period.maxAbsReturnPct, absReturnPct);
    period.maxRangePct = Math.max(period.maxRangePct, rangePct);
    if (close > open) {
      period.upMinutes += 1;
    }
    if (period.openingWindowCount < openingWindowCount) {
      period.openingWindowCount += 1;
      period.openingWindowClose = close;
    }
  }

  const rawFeatures = Array.from(periods.values())
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((period) => {
      const realizedVolPct = Math.sqrt(period.sumSquaredLogReturns) * 100;
      const returnPct = ((period.lastClose / period.firstOpen) - 1) * 100;
      const openingImpulse = ((period.openingWindowClose / period.firstOpen) - 1) * 100;
      const trendEfficiencyDenominator = Math.max(period.sumAbsReturnPct, 0.0001);
      const trendEfficiency = Math.min(1, Math.abs(returnPct) / trendEfficiencyDenominator);
      const reversalStrength = Math.sign(openingImpulse) !== 0
        && Math.sign(returnPct) !== 0
        && Math.sign(openingImpulse) !== Math.sign(returnPct)
        ? Math.abs(openingImpulse) + Math.abs(returnPct)
        : Math.max(0, Math.abs(openingImpulse) - Math.abs(returnPct));

      return {
        key: period.key,
        minutes: period.count,
        realizedVolPct: round(realizedVolPct, 2),
        avgAbsReturnPct: round(period.sumAbsReturnPct / period.count, 4),
        avgRangePct: round(period.sumRangePct / period.count, 4),
        maxAbsReturnPct: round(period.maxAbsReturnPct, 4),
        maxRangePct: round(period.maxRangePct, 4),
        returnPct: round(returnPct, 2),
        upMinuteRatio: round((period.upMinutes / period.count) * 100, 2),
        trendEfficiency: round(trendEfficiency, 4),
        volExpansionRatio: 1,
        openingImpulse: round(openingImpulse, 4),
        reversalStrength: round(reversalStrength, 4),
        featureBucket: detectBucket(returnPct, realizedVolPct)
      } satisfies PeriodFeature;
    });

  return rawFeatures.map((feature, index) => {
    const start = Math.max(0, index - volBaselineLookback);
    const baselineWindow = rawFeatures.slice(start, index);
    const baselineVol = baselineWindow.length
      ? baselineWindow.reduce((sum, item) => sum + item.realizedVolPct, 0) / baselineWindow.length
      : feature.realizedVolPct;
    const volExpansionRatio = baselineVol > 0 ? feature.realizedVolPct / baselineVol : 1;

    return {
      ...feature,
      volExpansionRatio: round(volExpansionRatio, 4)
    };
  });
}
