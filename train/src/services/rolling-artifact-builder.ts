type JsonObject = any;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type RollingRouterLayer = 'monthly_guard' | 'weekly_guard' | 'daily_router' | 'loss_recheck';
export type RollingRouterAction = 'trade' | 'reduce' | 'stop';

export interface RollingStrategyResultRow {
  readonly strategy_name: string;
  readonly strategy_type: string;
  readonly total_trades: number | string;
  readonly win_rate: number | string;
  readonly total_pnl: number | string;
  readonly score: number | string;
  readonly parameters: JsonObject | string;
}

export interface RollingTradeRow {
  readonly strategy_name: string;
  readonly exit_time: number | string;
  readonly pnl: number | string;
}

export interface RollingKlineRow {
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

interface StrategyMeta {
  readonly name: string;
  readonly type: string;
  readonly totalTrades: number;
  readonly winRate: number;
  readonly totalPnl: number;
  readonly score: number;
  readonly parameters: JsonObject;
}

interface PeriodAccumulator {
  key: string;
  count: number;
  firstOpen: number;
  lastClose: number;
  sumSquaredLogReturns: number;
  sumAbsReturnPct: number;
  sumRangePct: number;
  upMinutes: number;
}

interface PeriodFeature {
  readonly key: string;
  readonly returnPct: number;
  readonly realizedVolPct: number;
  readonly avgRangePct: number;
  readonly upMinuteRatio: number;
  readonly featureBucket: string;
}

interface PoolItem {
  readonly strategyName: string;
  readonly totalPnl: number;
  readonly score: number;
  readonly rank: number;
}

interface PeriodDecisionSample {
  readonly periodKey: string;
  readonly featureBucket: string;
  readonly selectedStrategyName: string | null;
  readonly actionType: RollingRouterAction;
  readonly riskCap?: number;
  readonly riskMultiplier?: number;
  readonly avgPnl: number;
  readonly sampleSize: number;
}

interface RouterStrategyRef {
  readonly strategyName: string;
  readonly shortLabel: string;
  readonly role?: string;
}

interface RouterRule {
  readonly id: string;
  readonly layer: RollingRouterLayer;
  readonly priority: number;
  readonly when: JsonObject;
  readonly action: {
    readonly type: RollingRouterAction;
    readonly riskCap?: number;
    readonly riskMultiplier?: number;
    readonly strategyKey?: string;
  };
  readonly rationale?: string;
}

export interface RollingArtifactBuilderOptions {
  readonly topN: number;
  readonly strategyRows: readonly RollingStrategyResultRow[];
  readonly trades: readonly RollingTradeRow[];
  readonly klines: readonly RollingKlineRow[];
}

export interface RollingArtifactPackage {
  readonly explicitStrategies: readonly JsonObject[];
  readonly strategyCatalog: Record<string, RouterStrategyRef>;
  readonly routerRules: readonly RouterRule[];
  readonly defaultStrategyKey: string | null;
  readonly monthlyPools: readonly JsonObject[];
  readonly monthlyRules: readonly JsonObject[];
  readonly weeklyRules: readonly JsonObject[];
  readonly dailyRules: readonly JsonObject[];
  readonly lossRules: readonly JsonObject[];
}

function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(digits));
}

function toJstDate(timestampMs: number): Date {
  return new Date(timestampMs + JST_OFFSET_MS);
}

function getJstDayKey(timestampMs: number): string {
  const date = toJstDate(timestampMs);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function getJstMonthKey(timestampMs: number): string {
  const date = toJstDate(timestampMs);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getIsoWeekKey(timestampMs: number): string {
  const date = toJstDate(timestampMs);
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function detectMonthlyFeatureBucket(returnPct: number, realizedVolPct: number): string {
  if (returnPct <= -8 && realizedVolPct >= 9) return 'crash-trend';
  if (returnPct >= 8 && realizedVolPct >= 9) return 'strong-trend';
  if (Math.abs(returnPct) <= 3 && realizedVolPct < 8) return 'range-low-vol';
  if (Math.abs(returnPct) <= 6) return 'range-mid-vol';
  return 'mixed-trend';
}

function detectWeeklyFeatureBucket(returnPct: number, realizedVolPct: number): string {
  if (returnPct <= -4 && realizedVolPct >= 5) return 'crash-trend';
  if (returnPct >= 4 && realizedVolPct >= 5) return 'strong-trend';
  if (Math.abs(returnPct) <= 1.5 && realizedVolPct < 4) return 'range-low-vol';
  if (Math.abs(returnPct) <= 3.5) return 'range-mid-vol';
  return 'mixed-trend';
}

function detectDailyFeatureBucket(returnPct: number, realizedVolPct: number): string {
  if (returnPct <= -2.5 && realizedVolPct >= 2.5) return 'crash-trend';
  if (returnPct >= 2.5 && realizedVolPct >= 2.5) return 'strong-trend';
  if (Math.abs(returnPct) <= 0.8 && realizedVolPct < 2.2) return 'range-low-vol';
  if (Math.abs(returnPct) <= 1.5) return 'range-mid-vol';
  return 'mixed-trend';
}

function parseParameters(value: JsonObject | string): JsonObject {
  if (typeof value === 'string') {
    return JSON.parse(value) as JsonObject;
  }
  return value;
}

function normalizeStrategyRows(rows: readonly RollingStrategyResultRow[]): readonly StrategyMeta[] {
  return rows.map((row) => ({
    name: String(row.strategy_name),
    type: String(row.strategy_type),
    totalTrades: Number(row.total_trades || 0),
    winRate: Number(row.win_rate || 0),
    totalPnl: Number(row.total_pnl || 0),
    score: Number(row.score || 0),
    parameters: parseParameters(row.parameters)
  }));
}

function extractPrice(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function choosePrice(row: RollingKlineRow, field: 'open' | 'high' | 'low' | 'close'): number | null {
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

function buildPeriodFeatures(
  klines: readonly RollingKlineRow[],
  getKey: (timestampMs: number) => string,
  detectBucket: (returnPct: number, realizedVolPct: number) => string
): readonly PeriodFeature[] {
  const periods = new Map<string, PeriodAccumulator>();

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
        upMinutes: 0
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
    if (close > open) {
      period.upMinutes += 1;
    }
  }

  return Array.from(periods.values())
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((period) => {
      const realizedVolPct = Math.sqrt(period.sumSquaredLogReturns) * 100;
      const returnPct = ((period.lastClose / period.firstOpen) - 1) * 100;
      return {
        key: period.key,
        returnPct: round(returnPct, 2),
        realizedVolPct: round(realizedVolPct, 2),
        avgRangePct: round(period.sumRangePct / period.count, 4),
        upMinuteRatio: round((period.upMinutes / period.count) * 100, 2),
        featureBucket: detectBucket(returnPct, realizedVolPct)
      };
    });
}

function buildPeriodStrategyPnlMap(
  trades: readonly RollingTradeRow[],
  getKey: (timestampMs: number) => string
): Map<string, Map<string, number>> {
  const periodMap = new Map<string, Map<string, number>>();

  for (const row of trades) {
    const key = getKey(Number(row.exit_time));
    const strategyName = String(row.strategy_name);
    const pnl = Number(row.pnl || 0);
    let strategyMap = periodMap.get(key);
    if (!strategyMap) {
      strategyMap = new Map<string, number>();
      periodMap.set(key, strategyMap);
    }
    strategyMap.set(strategyName, round((strategyMap.get(strategyName) ?? 0) + pnl, 4));
  }

  return periodMap;
}

function buildMonthPool(
  strategyMap: Map<string, number>,
  strategyMeta: ReadonlyMap<string, StrategyMeta>,
  topN: number
): readonly PoolItem[] {
  return Array.from(strategyMeta.values())
    .map((item) => ({
      strategyName: item.name,
      totalPnl: round(strategyMap.get(item.name) ?? 0, 4),
      score: round(item.score, 4),
      rank: 0
    }))
    .sort((left, right) => {
      if (right.totalPnl !== left.totalPnl) return right.totalPnl - left.totalPnl;
      if (right.score !== left.score) return right.score - left.score;
      return left.strategyName.localeCompare(right.strategyName);
    })
    .slice(0, topN)
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }));
}

function choosePeriodAction(bestPnl: number): { readonly type: RollingRouterAction; readonly risk: number } {
  if (bestPnl <= 0) {
    return { type: 'stop', risk: 0 };
  }
  if (bestPnl < 1000) {
    return { type: 'reduce', risk: 0.5 };
  }
  return { type: 'trade', risk: 1 };
}

function toShortLabel(parameters: JsonObject): string {
  const rsi = parameters['rsi'] && typeof parameters['rsi'] === 'object' ? parameters['rsi'] as JsonObject : {};
  const risk = parameters['risk'] && typeof parameters['risk'] === 'object' ? parameters['risk'] as JsonObject : {};
  const atr = parameters['atr'] && typeof parameters['atr'] === 'object' ? parameters['atr'] as JsonObject : {};
  return `OS${String(rsi['oversold'] ?? '-')}`
    + `/OB${String(rsi['overbought'] ?? '-')}`
    + `/H${String(risk['maxHoldMinutes'] ?? '-')}`
    + `/SL${String(atr['slMultiplier'] ?? '-')}`
    + `/TP${String(atr['tpMultiplier'] ?? '-')}`;
}

function buildExplicitStrategies(strategyNames: readonly string[], strategyMeta: ReadonlyMap<string, StrategyMeta>): readonly JsonObject[] {
  return strategyNames.map((strategyName, index) => {
    const meta = strategyMeta.get(strategyName);
    if (!meta) {
      return {
        rank: index + 1,
        name: strategyName,
        type: 'rsi_macd',
        parameters: {}
      };
    }

    return {
      rank: index + 1,
      name: strategyName,
      type: meta.type,
      parameters: meta.parameters
    };
  });
}

function aggregateByBucket(
  samples: readonly PeriodDecisionSample[],
  layer: RollingRouterLayer,
  strategyKeyMap: ReadonlyMap<string, string>
): readonly RouterRule[] {
  const bucketMap = new Map<string, PeriodDecisionSample[]>();

  for (const sample of samples) {
    const items = bucketMap.get(sample.featureBucket) ?? [];
    items.push(sample);
    bucketMap.set(sample.featureBucket, items);
  }

  const rules: RouterRule[] = [];
  let priority = 1;

  for (const [featureBucket, bucketSamples] of Array.from(bucketMap.entries()).sort((left, right) => left[0].localeCompare(right[0]))) {
    const candidateScores = new Map<string, { score: number; count: number }>();
    let stopCount = 0;
    let reduceCount = 0;
    let riskAccumulator = 0;

    for (const sample of bucketSamples) {
      riskAccumulator += sample.riskCap ?? sample.riskMultiplier ?? 1;
      if (sample.actionType === 'stop') {
        stopCount += 1;
      } else if (sample.actionType === 'reduce') {
        reduceCount += 1;
      }

      if (sample.selectedStrategyName) {
        const current = candidateScores.get(sample.selectedStrategyName) ?? { score: 0, count: 0 };
        candidateScores.set(sample.selectedStrategyName, {
          score: current.score + sample.avgPnl,
          count: current.count + 1
        });
      }
    }

    const averageRisk = round(riskAccumulator / bucketSamples.length, 4);
    const dominantStrategy = Array.from(candidateScores.entries())
      .sort((left, right) => {
        if (right[1].score !== left[1].score) return right[1].score - left[1].score;
        if (right[1].count !== left[1].count) return right[1].count - left[1].count;
        return left[0].localeCompare(right[0]);
      })[0]?.[0] ?? null;
    const stopShare = stopCount / bucketSamples.length;
    const reduceShare = reduceCount / bucketSamples.length;
    const actionType: RollingRouterAction = stopShare >= 0.5
      ? 'stop'
      : reduceShare >= 0.5
        ? 'reduce'
        : 'trade';
    const strategyKey = dominantStrategy ? strategyKeyMap.get(dominantStrategy) ?? null : null;
    const action: {
      type: RollingRouterAction;
      riskCap?: number;
      riskMultiplier?: number;
      strategyKey?: string;
    } = {
      type: actionType,
      ...(layer === 'monthly_guard' || layer === 'weekly_guard'
        ? { riskCap: actionType === 'stop' ? 0 : averageRisk }
        : actionType === 'reduce'
          ? { riskMultiplier: averageRisk }
          : {})
    };

    if (strategyKey && actionType !== 'stop') {
      action.strategyKey = strategyKey;
    }

    rules.push({
      id: `${layer}_${featureBucket.replace(/[^a-zA-Z0-9]+/g, '_')}`,
      layer,
      priority: priority++,
      when: {
        featureBucket: [featureBucket]
      },
      action,
      rationale: `${layer} learned from ${bucketSamples.length} rolling samples`
    });
  }

  return rules;
}

function buildLossRules(
  dailyFeatures: readonly PeriodFeature[],
  dailyPnlMap: ReadonlyMap<string, Map<string, number>>,
  weeklyDecisionsByDay: ReadonlyMap<string, string | null>,
  strategyKeyMap: ReadonlyMap<string, string>
): readonly RouterRule[] {
  const samples: PeriodDecisionSample[] = [];
  for (let index = 1; index < dailyFeatures.length; index += 1) {
    const previousDay = dailyFeatures[index - 1];
    const dayFeature = dailyFeatures[index];
    if (!previousDay || !dayFeature) {
      continue;
    }

    const previousStrategyName = weeklyDecisionsByDay.get(previousDay.key) ?? null;
    const currentMap = dailyPnlMap.get(dayFeature.key) ?? new Map<string, number>();
    const currentStrategyPnl = previousStrategyName ? currentMap.get(previousStrategyName) ?? 0 : 0;
    if ((dailyPnlMap.get(previousDay.key)?.get(previousStrategyName || '') ?? 0) >= 0) {
      continue;
    }

    const actionType: RollingRouterAction = currentStrategyPnl <= 0 ? 'stop' : 'reduce';
    samples.push({
      periodKey: dayFeature.key,
      featureBucket: dayFeature.featureBucket,
      selectedStrategyName: previousStrategyName,
      actionType,
      riskMultiplier: actionType === 'stop' ? 0 : 0.5,
      avgPnl: round(currentStrategyPnl, 4),
      sampleSize: 1
    });
  }

  return aggregateByBucket(samples, 'loss_recheck', strategyKeyMap).map((rule) => ({
    ...rule,
    when: {
      ...rule.when,
      previousDayRoutedPnl: {
        lt: 0
      }
    }
  }));
}

export function buildRollingArtifactPackage(options: RollingArtifactBuilderOptions): RollingArtifactPackage {
  const strategyMetaList = normalizeStrategyRows(options.strategyRows);
  const strategyMeta = new Map(strategyMetaList.map((item) => [item.name, item] as const));
  const dailyFeatures = buildPeriodFeatures(options.klines, getJstDayKey, detectDailyFeatureBucket);
  const weeklyFeatures = buildPeriodFeatures(options.klines, getIsoWeekKey, detectWeeklyFeatureBucket);
  const monthlyFeatures = buildPeriodFeatures(options.klines, getJstMonthKey, detectMonthlyFeatureBucket);
  const dailyPnlMap = buildPeriodStrategyPnlMap(options.trades, getJstDayKey);
  const weeklyPnlMap = buildPeriodStrategyPnlMap(options.trades, getIsoWeekKey);
  const monthlyPnlMap = buildPeriodStrategyPnlMap(options.trades, getJstMonthKey);

  const weeklyFeatureMap = new Map(weeklyFeatures.map((item) => [item.key, item] as const));
  const monthPoolMap = new Map<string, readonly PoolItem[]>();
  const monthPrimaryStrategyMap = new Map<string, string | null>();
  const monthRiskMap = new Map<string, number>();
  const monthlyPools = monthlyFeatures.map((feature) => {
    const pool = buildMonthPool(monthlyPnlMap.get(feature.key) ?? new Map<string, number>(), strategyMeta, options.topN);
    monthPoolMap.set(feature.key, pool);
    const best = pool[0];
    const action = choosePeriodAction(best?.totalPnl ?? 0);
    monthPrimaryStrategyMap.set(feature.key, best?.strategyName ?? null);
    monthRiskMap.set(feature.key, action.risk);
    return {
      month: feature.key,
      featureBucket: feature.featureBucket,
      selectedStrategyName: best?.strategyName ?? null,
      actionType: action.type,
      riskCap: action.risk,
      topStrategies: pool
    };
  });

  const monthlySelectedStrategies = Array.from(new Set(
    monthlyPools.flatMap((item) => item.topStrategies.map((entry) => entry.strategyName))
  ));
  const explicitStrategies = buildExplicitStrategies(monthlySelectedStrategies, strategyMeta);
  const strategyCatalog = explicitStrategies.reduce((accumulator, strategy, index) => {
    const key = `rank${index + 1}`;
    accumulator[key] = {
      strategyName: String(strategy['name']),
      shortLabel: toShortLabel(strategy['parameters'] as JsonObject),
      role: index === 0 ? 'default-fallback' : 'candidate'
    };
    return accumulator;
  }, {} as Record<string, RouterStrategyRef>);
  const strategyKeyMap = new Map(
    Object.entries(strategyCatalog).map(([key, value]) => [String((value as RouterStrategyRef).strategyName), key] as const)
  );
  const defaultStrategyKey = explicitStrategies[0] ? strategyKeyMap.get(String(explicitStrategies[0]['name'])) ?? null : null;

  const weeklySamples: PeriodDecisionSample[] = [];
  const weeklyDecisionsByDay = new Map<string, string | null>();
  for (const feature of weeklyFeatures) {
    const approxDayKey = `${feature.key}`;
    void approxDayKey;
    const candidateMonth = feature.key.slice(0, 7);
    const pool = monthPoolMap.get(candidateMonth) ?? [];
    const strategyMap = weeklyPnlMap.get(feature.key) ?? new Map<string, number>();
    const ranked = pool
      .map((entry) => ({
        strategyName: entry.strategyName,
        pnl: round(strategyMap.get(entry.strategyName) ?? 0, 4)
      }))
      .sort((left, right) => {
        if (right.pnl !== left.pnl) return right.pnl - left.pnl;
        return left.strategyName.localeCompare(right.strategyName);
      });
    const best = ranked[0] ?? null;
    const action = choosePeriodAction(best?.pnl ?? 0);
    weeklySamples.push({
      periodKey: feature.key,
      featureBucket: feature.featureBucket,
      selectedStrategyName: best?.strategyName ?? monthPrimaryStrategyMap.get(candidateMonth) ?? null,
      actionType: action.type,
      riskCap: action.risk,
      avgPnl: best?.pnl ?? 0,
      sampleSize: ranked.length
    });
  }

  const weeklyRules = aggregateByBucket(weeklySamples, 'weekly_guard', strategyKeyMap);

  const weeklyRuleByBucket = new Map(
    weeklyRules.map((rule) => [
      String((((rule.when['featureBucket']) as readonly string[] | undefined)?.[0]) || ''),
      String(rule.action.strategyKey ? strategyCatalog[rule.action.strategyKey]?.strategyName || '' : '')
    ] as const)
  );

  const dailySamples: PeriodDecisionSample[] = [];
  for (const feature of dailyFeatures) {
    const monthKey = feature.key.slice(0, 7);
    const dayTimeMs = Date.parse(`${feature.key}T00:00:00.000Z`) - JST_OFFSET_MS;
    const weekKey = getIsoWeekKey(dayTimeMs);
    const weekFeature = weeklyFeatureMap.get(weekKey);
    const weekBaseStrategyName = weekFeature ? weeklyRuleByBucket.get(weekFeature.featureBucket) || null : null;
    weeklyDecisionsByDay.set(feature.key, weekBaseStrategyName);
    const pool = monthPoolMap.get(monthKey) ?? [];
    const strategyMap = dailyPnlMap.get(feature.key) ?? new Map<string, number>();
    const ranked = pool
      .map((entry) => ({
        strategyName: entry.strategyName,
        pnl: round(strategyMap.get(entry.strategyName) ?? 0, 4)
      }))
      .sort((left, right) => {
        if (right.pnl !== left.pnl) return right.pnl - left.pnl;
        return left.strategyName.localeCompare(right.strategyName);
      });
    const best = ranked[0] ?? null;
    const weekBasePnl = weekBaseStrategyName ? round(strategyMap.get(weekBaseStrategyName) ?? 0, 4) : 0;
    let actionType: RollingRouterAction = 'trade';
    let riskMultiplier = 1;
    let selectedStrategyName = best?.strategyName ?? weekBaseStrategyName ?? monthPrimaryStrategyMap.get(monthKey) ?? null;

    if ((best?.pnl ?? 0) <= 0) {
      actionType = 'stop';
      riskMultiplier = 0;
      selectedStrategyName = null;
    } else if ((best?.pnl ?? 0) <= weekBasePnl + 200) {
      actionType = 'reduce';
      riskMultiplier = 0.5;
      selectedStrategyName = weekBaseStrategyName ?? selectedStrategyName;
    }

    dailySamples.push({
      periodKey: feature.key,
      featureBucket: feature.featureBucket,
      selectedStrategyName,
      actionType,
      riskMultiplier,
      avgPnl: best?.pnl ?? 0,
      sampleSize: ranked.length
    });
  }

  const monthlySamples: PeriodDecisionSample[] = monthlyPools.map((item) => ({
    periodKey: item.month,
    featureBucket: item.featureBucket,
    selectedStrategyName: item.selectedStrategyName,
    actionType: item.actionType,
    riskCap: item.riskCap,
    avgPnl: item.topStrategies[0]?.totalPnl ?? 0,
    sampleSize: item.topStrategies.length
  }));

  const monthlyRules = aggregateByBucket(monthlySamples, 'monthly_guard', strategyKeyMap);
  const dailyRules = aggregateByBucket(dailySamples, 'daily_router', strategyKeyMap);
  const lossRules = buildLossRules(dailyFeatures, dailyPnlMap, weeklyDecisionsByDay, strategyKeyMap);

  return {
    explicitStrategies,
    strategyCatalog,
    routerRules: [...monthlyRules, ...weeklyRules, ...dailyRules, ...lossRules],
    defaultStrategyKey,
    monthlyPools,
    monthlyRules: monthlyRules.map((item) => ({ ...item })),
    weeklyRules: weeklyRules.map((item) => ({ ...item })),
    dailyRules: dailyRules.map((item) => ({ ...item })),
    lossRules: lossRules.map((item) => ({ ...item }))
  };
}
