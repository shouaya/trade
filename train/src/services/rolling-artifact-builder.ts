import {
  buildLaggedFeatureMap,
  buildOpeningWindowPeriodFeatures,
  buildPeriodFeatures,
  buildPoolHealthMetrics,
  computeAlignmentScore,
  detectDailyFeatureBucket,
  detectMonthlyFeatureBucket,
  detectWeeklyFeatureBucket,
  getIsoWeekKey,
  getJstDayKey,
  getJstMonthKey,
  round,
  type PeriodFeature
} from './rolling-features';

type JsonObject = any;

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

interface PoolItem {
  readonly strategyName: string;
  readonly totalPnl: number;
  readonly score: number;
  readonly rank: number;
}

interface PeriodDecisionSample {
  readonly periodKey: string;
  readonly feature: PeriodFeature;
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
  readonly featureEngineering?: JsonObject;
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

function rankPoolByPeriodPnl(
  pool: readonly PoolItem[],
  strategyMap: ReadonlyMap<string, number>
): readonly { readonly strategyName: string; readonly pnl: number }[] {
  return pool
    .map((entry) => ({
      strategyName: entry.strategyName,
      pnl: round(strategyMap.get(entry.strategyName) ?? 0, 4)
    }))
    .sort((left, right) => {
      if (right.pnl !== left.pnl) return right.pnl - left.pnl;
      return left.strategyName.localeCompare(right.strategyName);
    });
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

const SPLIT_METRIC_KEYS = [
  'trendEfficiency',
  'volExpansionRatio',
  'openingImpulse',
  'reversalStrength',
  'positiveStrategyRatio',
  'bestVsMedianGap',
  'monthlyWeeklyAlignment',
  'weeklyDailyAlignment'
] as const;

type SplitMetricKey = typeof SPLIT_METRIC_KEYS[number];

function normalizeSplitMetricKeys(value: unknown): readonly SplitMetricKey[] {
  if (!Array.isArray(value) || value.length === 0) {
    return SPLIT_METRIC_KEYS;
  }

  const allowed = new Set<string>(SPLIT_METRIC_KEYS);
  const normalized = value
    .map((item) => String(item || '').trim())
    .filter((item): item is SplitMetricKey => allowed.has(item));

  return normalized.length > 0 ? normalized : SPLIT_METRIC_KEYS;
}

interface SampleSummary {
  readonly actionType: RollingRouterAction;
  readonly averageRisk: number;
  readonly dominantStrategy: string | null;
  readonly sampleCount: number;
}

export function normalizeLayerSummary(
  layer: RollingRouterLayer,
  summary: SampleSummary
): SampleSummary {
  if (layer === 'loss_recheck' || summary.actionType !== 'stop') {
    return summary;
  }

  return {
    ...summary,
    actionType: 'reduce',
    averageRisk: Math.max(summary.averageRisk, 0.5)
  };
}

function summarizeSamples(samples: readonly PeriodDecisionSample[]): SampleSummary {
  const candidateScores = new Map<string, { score: number; count: number }>();
  let stopCount = 0;
  let reduceCount = 0;
  let riskAccumulator = 0;

  for (const sample of samples) {
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

  const dominantStrategy = Array.from(candidateScores.entries())
    .sort((left, right) => {
      if (right[1].score !== left[1].score) return right[1].score - left[1].score;
      if (right[1].count !== left[1].count) return right[1].count - left[1].count;
      return left[0].localeCompare(right[0]);
    })[0]?.[0] ?? null;
  const stopShare = stopCount / samples.length;
  const reduceShare = reduceCount / samples.length;
  const actionType: RollingRouterAction = stopShare >= 0.5
    ? 'stop'
    : reduceShare >= 0.5
      ? 'reduce'
      : 'trade';

  return {
    actionType,
    averageRisk: round(riskAccumulator / samples.length, 4),
    dominantStrategy,
    sampleCount: samples.length
  };
}

function getSampleMetric(sample: PeriodDecisionSample, key: SplitMetricKey): number | null {
  const value = sample.feature[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildAction(
  layer: RollingRouterLayer,
  summary: SampleSummary,
  strategyKeyMap: ReadonlyMap<string, string>
): RouterRule['action'] {
  const normalizedSummary = normalizeLayerSummary(layer, summary);
  const strategyKey = normalizedSummary.dominantStrategy
    ? strategyKeyMap.get(normalizedSummary.dominantStrategy) ?? null
    : null;
  return {
    type: normalizedSummary.actionType,
    ...(layer === 'monthly_guard' || layer === 'weekly_guard'
      ? { riskCap: normalizedSummary.actionType === 'stop' ? 0 : normalizedSummary.averageRisk }
      : normalizedSummary.actionType === 'reduce'
        ? { riskMultiplier: normalizedSummary.averageRisk }
        : {}),
    ...(strategyKey && normalizedSummary.actionType !== 'stop' ? { strategyKey } : {})
  };
}

function withMetricCondition(featureBucket: string, metricKey: SplitMetricKey, threshold: number, isUpper: boolean): JsonObject {
  const numericCondition = isUpper ? { gt: threshold } : { lte: threshold };
  return {
    featureBucket: [featureBucket],
    [metricKey]: numericCondition
  };
}

function chooseMetricSplit(
  samples: readonly PeriodDecisionSample[],
  metrics: readonly SplitMetricKey[],
  minSamplesPerBranch: number
): { readonly metricKey: SplitMetricKey; readonly threshold: number } | null {
  let best: { metricKey: SplitMetricKey; threshold: number; score: number } | null = null;

  for (const metricKey of metrics) {
    const metricValues = samples
      .map((sample) => getSampleMetric(sample, metricKey))
      .filter((value): value is number => value !== null);
    const distinctCount = new Set(metricValues.map((value) => value.toFixed(4))).size;
    if (metricValues.length < samples.length || distinctCount < 2) {
      continue;
    }

    const sortedValues = [...metricValues].sort((left, right) => left - right);
    const threshold = sortedValues[Math.floor((sortedValues.length - 1) / 2)] ?? null;
    if (threshold === null) {
      continue;
    }

    const lower = samples.filter((sample) => (getSampleMetric(sample, metricKey) ?? Number.NaN) <= threshold);
    const upper = samples.filter((sample) => (getSampleMetric(sample, metricKey) ?? Number.NaN) > threshold);
    if (lower.length < minSamplesPerBranch || upper.length < minSamplesPerBranch) {
      continue;
    }

    const lowerSummary = summarizeSamples(lower);
    const upperSummary = summarizeSamples(upper);
    const actionDivergence = lowerSummary.actionType === upperSummary.actionType ? 0 : 2;
    const strategyDivergence = lowerSummary.dominantStrategy === upperSummary.dominantStrategy ? 0 : 1;
    const riskDivergence = Math.abs(lowerSummary.averageRisk - upperSummary.averageRisk) >= 0.25 ? 1 : 0;
    const score = actionDivergence + strategyDivergence + riskDivergence;

    if (score <= 0) {
      continue;
    }

    if (!best || score > best.score) {
      best = { metricKey, threshold: round(threshold, 4), score };
    }
  }

  return best ? { metricKey: best.metricKey, threshold: best.threshold } : null;
}

function aggregateByBucket(
  samples: readonly PeriodDecisionSample[],
  layer: RollingRouterLayer,
  strategyKeyMap: ReadonlyMap<string, string>,
  splitConfig: {
    readonly enabled: boolean;
    readonly metrics: readonly SplitMetricKey[];
    readonly minSamplesPerBranch: number;
  }
): readonly RouterRule[] {
  const bucketMap = new Map<string, PeriodDecisionSample[]>();

  for (const sample of samples) {
    const items = bucketMap.get(sample.feature.featureBucket) ?? [];
    items.push(sample);
    bucketMap.set(sample.feature.featureBucket, items);
  }

  const rules: RouterRule[] = [];
  let priority = 1;

  for (const [featureBucket, bucketSamples] of Array.from(bucketMap.entries()).sort((left, right) => left[0].localeCompare(right[0]))) {
    const split = splitConfig.enabled
      ? chooseMetricSplit(bucketSamples, splitConfig.metrics, splitConfig.minSamplesPerBranch)
      : null;
    if (!split) {
      const summary = summarizeSamples(bucketSamples);
      rules.push({
        id: `${layer}_${featureBucket.replace(/[^a-zA-Z0-9]+/g, '_')}`,
        layer,
        priority: priority++,
        when: {
          featureBucket: [featureBucket]
        },
        action: buildAction(layer, summary, strategyKeyMap),
        rationale: `${layer} learned from ${bucketSamples.length} rolling samples`
      });
      continue;
    }

    const lower = bucketSamples.filter((sample) => (getSampleMetric(sample, split.metricKey) ?? Number.NaN) <= split.threshold);
    const upper = bucketSamples.filter((sample) => (getSampleMetric(sample, split.metricKey) ?? Number.NaN) > split.threshold);
    const lowerSummary = summarizeSamples(lower);
    const upperSummary = summarizeSamples(upper);

    rules.push({
      id: `${layer}_${featureBucket.replace(/[^a-zA-Z0-9]+/g, '_')}_${split.metricKey}_low`,
      layer,
      priority: priority++,
      when: withMetricCondition(featureBucket, split.metricKey, split.threshold, false),
      action: buildAction(layer, lowerSummary, strategyKeyMap),
      rationale: `${layer} learned ${split.metricKey}<=${split.threshold} from ${lower.length} rolling samples`
    });
    rules.push({
      id: `${layer}_${featureBucket.replace(/[^a-zA-Z0-9]+/g, '_')}_${split.metricKey}_high`,
      layer,
      priority: priority++,
      when: withMetricCondition(featureBucket, split.metricKey, split.threshold, true),
      action: buildAction(layer, upperSummary, strategyKeyMap),
      rationale: `${layer} learned ${split.metricKey}>${split.threshold} from ${upper.length} rolling samples`
    });
  }

  return rules;
}

function buildLossRules(
  dailyFeatures: readonly PeriodFeature[],
  dailyPnlMap: ReadonlyMap<string, Map<string, number>>,
  weeklyDecisionsByDay: ReadonlyMap<string, string | null>,
  strategyKeyMap: ReadonlyMap<string, string>,
  splitConfig: {
    readonly enabled: boolean;
    readonly metrics: readonly SplitMetricKey[];
    readonly minSamplesPerBranch: number;
  }
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
      feature: dayFeature,
      selectedStrategyName: previousStrategyName,
      actionType,
      riskMultiplier: actionType === 'stop' ? 0 : 0.5,
      avgPnl: round(currentStrategyPnl, 4),
      sampleSize: 1
    });
  }

  return aggregateByBucket(samples, 'loss_recheck', strategyKeyMap, splitConfig).map((rule) => ({
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
  const featureEngineering = (options.featureEngineering && typeof options.featureEngineering === 'object')
    ? options.featureEngineering
    : {};
  const routerSplit = (featureEngineering['routerSplit'] && typeof featureEngineering['routerSplit'] === 'object')
    ? featureEngineering['routerSplit'] as JsonObject
    : {};
  const openingWindowCount = Math.max(1, Number(featureEngineering['openingWindowMinutes'] || 60));
  const volBaselineLookback = Math.max(1, Number(featureEngineering['volBaselineLookbackPeriods'] || 8));
  const splitConfig = {
    enabled: routerSplit['enabled'] !== false,
    metrics: normalizeSplitMetricKeys(routerSplit['metrics']),
    minSamplesPerBranch: Math.max(1, Number(routerSplit['minSamplesPerBranch'] || 2))
  };
  const strategyMetaList = normalizeStrategyRows(options.strategyRows);
  const strategyMeta = new Map(strategyMetaList.map((item) => [item.name, item] as const));
  const periodFeatureOptions = {
    openingWindowCount,
    volBaselineLookback
  };
  const dailyFeatures = buildPeriodFeatures(options.klines, getJstDayKey, detectDailyFeatureBucket, periodFeatureOptions);
  const dailyOpeningFeatures = buildOpeningWindowPeriodFeatures(
    options.klines,
    getJstDayKey,
    detectDailyFeatureBucket,
    periodFeatureOptions
  );
  const weeklyFeatures = buildPeriodFeatures(options.klines, getIsoWeekKey, detectWeeklyFeatureBucket, periodFeatureOptions);
  const monthlyFeatures = buildPeriodFeatures(options.klines, getJstMonthKey, detectMonthlyFeatureBucket, periodFeatureOptions);
  const laggedDailyFeatureMap = buildLaggedFeatureMap(dailyFeatures);
  const laggedWeeklyFeatureMap = buildLaggedFeatureMap(weeklyFeatures);
  const laggedMonthlyFeatureMap = buildLaggedFeatureMap(monthlyFeatures);
  const dailyPnlMap = buildPeriodStrategyPnlMap(options.trades, getJstDayKey);
  const weeklyPnlMap = buildPeriodStrategyPnlMap(options.trades, getIsoWeekKey);
  const monthlyPnlMap = buildPeriodStrategyPnlMap(options.trades, getJstMonthKey);

  const weekToMonthMap = new Map<string, string>();
  for (const feature of dailyFeatures) {
    const dayTimeMs = Date.parse(`${feature.key}T00:00:00.000Z`) - (9 * 60 * 60 * 1000);
    const weekKey = getIsoWeekKey(dayTimeMs);
    if (!weekToMonthMap.has(weekKey)) {
      weekToMonthMap.set(weekKey, feature.key.slice(0, 7));
    }
  }
  const monthPoolMap = new Map<string, readonly PoolItem[]>();
  const monthPrimaryStrategyMap = new Map<string, string | null>();
  const monthlyPools = monthlyFeatures.flatMap((feature) => {
    const previousMonthFeature = laggedMonthlyFeatureMap.get(feature.key) ?? null;
    if (!previousMonthFeature) {
      return [];
    }

    const previousMonthStrategyMap = monthlyPnlMap.get(previousMonthFeature.key) ?? new Map<string, number>();
    const currentMonthStrategyMap = monthlyPnlMap.get(feature.key) ?? new Map<string, number>();
    const fullMonthPnls = Array.from(strategyMeta.values()).map((item) => round((previousMonthStrategyMap.get(item.name) ?? 0), 4));
    const health = buildPoolHealthMetrics(fullMonthPnls);
    const enrichedFeature: PeriodFeature = {
      ...previousMonthFeature,
      positiveStrategyRatio: health.positiveStrategyRatio,
      bestVsMedianGap: health.bestVsMedianGap
    };
    const pool = buildMonthPool(previousMonthStrategyMap, strategyMeta, options.topN);
    monthPoolMap.set(feature.key, pool);
    const rankedCurrent = rankPoolByPeriodPnl(pool, currentMonthStrategyMap);
    const best = rankedCurrent[0] ?? null;
    const action = choosePeriodAction(best?.pnl ?? 0);
    monthPrimaryStrategyMap.set(feature.key, best?.strategyName ?? null);
    return [{
      month: feature.key,
      sourceMonth: previousMonthFeature.key,
      featureBucket: feature.featureBucket,
      trendEfficiency: enrichedFeature.trendEfficiency,
      volExpansionRatio: enrichedFeature.volExpansionRatio,
      openingImpulse: enrichedFeature.openingImpulse,
      reversalStrength: enrichedFeature.reversalStrength,
      positiveStrategyRatio: enrichedFeature.positiveStrategyRatio,
      bestVsMedianGap: enrichedFeature.bestVsMedianGap,
      selectedStrategyName: best?.strategyName ?? null,
      actionType: action.type,
      riskCap: action.risk,
      currentBestPnl: best?.pnl ?? 0,
      topStrategies: pool,
      feature: enrichedFeature
    }];
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
  const weeklySelectedStrategyByWeek = new Map<string, string | null>();
  const weeklyDecisionsByDay = new Map<string, string | null>();
  for (const feature of weeklyFeatures) {
    const previousWeekFeature = laggedWeeklyFeatureMap.get(feature.key) ?? null;
    if (!previousWeekFeature) {
      continue;
    }
    const candidateMonth = weekToMonthMap.get(feature.key) ?? null;
    const monthFeature = candidateMonth ? (laggedMonthlyFeatureMap.get(candidateMonth) ?? null) : null;
    const pool = candidateMonth ? (monthPoolMap.get(candidateMonth) ?? []) : [];
    const previousWeekStrategyMap = weeklyPnlMap.get(previousWeekFeature.key) ?? new Map<string, number>();
    const currentWeekStrategyMap = weeklyPnlMap.get(feature.key) ?? new Map<string, number>();
    const ranked = rankPoolByPeriodPnl(pool, currentWeekStrategyMap);
    const health = buildPoolHealthMetrics(pool.map((entry) => round(previousWeekStrategyMap.get(entry.strategyName) ?? 0, 4)));
    const enrichedFeature: PeriodFeature = {
      ...previousWeekFeature,
      positiveStrategyRatio: health.positiveStrategyRatio,
      bestVsMedianGap: health.bestVsMedianGap,
      monthlyWeeklyAlignment: computeAlignmentScore(monthFeature, previousWeekFeature)
    };
    const best = ranked[0] ?? null;
    const action = choosePeriodAction(best?.pnl ?? 0);
    weeklySamples.push({
      periodKey: feature.key,
      feature: enrichedFeature,
      selectedStrategyName: best?.strategyName ?? (candidateMonth ? monthPrimaryStrategyMap.get(candidateMonth) ?? null : null),
      actionType: action.type,
      riskCap: action.risk,
      avgPnl: best?.pnl ?? 0,
      sampleSize: ranked.length
    });
    weeklySelectedStrategyByWeek.set(
      feature.key,
      best?.strategyName ?? (candidateMonth ? monthPrimaryStrategyMap.get(candidateMonth) ?? null : null)
    );
  }

  const weeklyRules = aggregateByBucket(weeklySamples, 'weekly_guard', strategyKeyMap, splitConfig);

  const dailySamples: PeriodDecisionSample[] = [];
  for (const feature of dailyOpeningFeatures) {
    const monthKey = feature.key.slice(0, 7);
    const dayTimeMs = Date.parse(`${feature.key}T00:00:00.000Z`) - (9 * 60 * 60 * 1000);
    const weekKey = getIsoWeekKey(dayTimeMs);
    const weekFeature = laggedWeeklyFeatureMap.get(weekKey) ?? null;
    const weekBaseStrategyName = weeklySelectedStrategyByWeek.get(weekKey) ?? null;
    weeklyDecisionsByDay.set(feature.key, weekBaseStrategyName);
    const pool = monthPoolMap.get(monthKey) ?? [];
    const strategyMap = dailyPnlMap.get(feature.key) ?? new Map<string, number>();
    const ranked = rankPoolByPeriodPnl(pool, strategyMap);
    const previousDayFeature = laggedDailyFeatureMap.get(feature.key) ?? null;
    const previousDayStrategyMap = previousDayFeature ? (dailyPnlMap.get(previousDayFeature.key) ?? new Map<string, number>()) : new Map<string, number>();
    const health = buildPoolHealthMetrics(pool.map((entry) => round(previousDayStrategyMap.get(entry.strategyName) ?? 0, 4)));
    const enrichedFeature: PeriodFeature = {
      ...feature,
      positiveStrategyRatio: health.positiveStrategyRatio,
      bestVsMedianGap: health.bestVsMedianGap,
      weeklyDailyAlignment: computeAlignmentScore(weekFeature ?? null, feature)
    };
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
      feature: enrichedFeature,
      selectedStrategyName,
      actionType,
      riskMultiplier,
      avgPnl: best?.pnl ?? 0,
      sampleSize: ranked.length
    });
  }

  const monthlySamples: PeriodDecisionSample[] = monthlyPools.map((item) => ({
    periodKey: item.month,
    feature: item.feature as PeriodFeature,
    selectedStrategyName: item.selectedStrategyName,
    actionType: item.actionType,
    riskCap: item.riskCap,
    avgPnl: Number(item.currentBestPnl ?? 0),
    sampleSize: item.topStrategies.length
  }));

  const monthlyRules = aggregateByBucket(monthlySamples, 'monthly_guard', strategyKeyMap, splitConfig);
  const dailyRules = aggregateByBucket(dailySamples, 'daily_router', strategyKeyMap, splitConfig);
  const lossRules = buildLossRules(dailyOpeningFeatures, dailyPnlMap, weeklyDecisionsByDay, strategyKeyMap, splitConfig);

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
