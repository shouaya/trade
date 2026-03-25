#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as mysql from 'mysql2/promise';
import { createMysqlConnectionWithFallback } from '@money/database';
import { generateStrategyCombinations } from '../services/strategy-parameter-generator';
import { StrategyExecutor } from '../services/strategy-executor';
import { validateFeeModelConfig } from '../services/fee-model';
import {
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
} from '../services/rolling-features';
import {
  choosePeriodAction,
  decideDailyAction,
  getDecisionFeatureEngineeringConfig,
  summarizeAggregateAction,
  type RollingRouterAction
} from '../modules/decision-engine';
import { loadTrainEnv } from '../utils/train-env';

loadTrainEnv(dotenv);

interface Args {
  readonly trainConfig: string;
  readonly trainConfigRef: string | undefined;
  readonly symbol: string;
  readonly outPrefix: string;
  readonly strategyPrefix: string;
  readonly descriptionPrefix: string;
  readonly limit: number;
  readonly exact: boolean;
  readonly profile: string;
  readonly outputMode: 'json' | 'files';
}

type QueryableConnection = {
  readonly query: <T = any>(sql: string, params?: readonly unknown[]) => Promise<[T, any]>;
  readonly end: () => Promise<void>;
};

type JsonObject = any;
type RouterLayer = 'monthly_guard' | 'weekly_guard' | 'daily_router' | 'loss_recheck';

interface RuntimeStrategy {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly parameters: JsonObject;
}

interface RollingKlineRow {
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
  readonly symbol?: string;
  readonly interval_type?: string;
}

interface RankedStrategy {
  readonly rank: number;
  readonly name: string;
  readonly type: string;
  readonly parameters: JsonObject;
  readonly totalTrades: number;
  readonly totalPnl: number;
  readonly returnPct: number;
  readonly score: number;
}

interface ValidationDefinition {
  readonly suffix: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly tableToken: string;
  readonly descriptionLabel: string;
  readonly evaluationTimeRange: JsonObject;
  readonly executionTimeRange: JsonObject;
}

interface OosTrade {
  readonly strategyName: string;
  readonly exitTime: number;
  readonly pnl: number;
}

interface MonthlyEvaluationSnapshot {
  readonly definition: ValidationDefinition;
  readonly validationMonth: string;
  readonly trainingWindow: JsonObject;
  readonly sourceMonth: string;
  readonly monthFeature: PeriodFeature;
  readonly explicitStrategies: readonly RankedStrategy[];
  readonly monthlyTopStrategies: readonly {
    readonly rank: number;
    readonly strategyName: string;
    readonly totalPnl: number;
    readonly score: number;
  }[];
  readonly monthlyWinnerName: string | null;
  readonly monthlyWinnerPnl: number;
  readonly monthlyActionType: RollingRouterAction;
  readonly monthlyRiskCap: number;
  readonly oosTrades: readonly OosTrade[];
  readonly strategyDayPnlMap: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly strategyWeekPnlMap: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

interface GeneratedArtifactItem {
  readonly configKey: string;
  readonly configType: string;
  readonly content: JsonObject;
}

interface GeneratedArtifactsResult {
  readonly validationConfigs: readonly GeneratedArtifactItem[];
  readonly snapshot: GeneratedArtifactItem;
}

interface RuleSample {
  readonly periodKey: string;
  readonly feature: PeriodFeature;
  readonly selectedStrategyName: string | null;
  readonly actionType: RollingRouterAction;
  readonly riskValue: number;
  readonly avgPnl: number;
}

interface LossRuleSample extends RuleSample {
  readonly previousDayFeatureBucket: string | null;
  readonly consecutiveLossDaysBefore: number;
}

interface RouterRule {
  readonly id: string;
  readonly layer: RouterLayer;
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

interface StrategyAggregate {
  readonly name: string;
  readonly type: string;
  readonly parameters: JsonObject;
  totalTrades: number;
  totalPnl: number;
  totalScore: number;
  scoreCount: number;
}

const ROLLING_LOOKBACK_MONTHS = 3;
const JPY_INITIAL_CAPITAL = 1_000_000;
const DEFAULT_INITIAL_CAPITAL = 10_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function parseArgs(argv: readonly string[]): Args {
  const parsed: Record<string, string> = {};
  for (const arg of argv.slice(2)) {
    const index = arg.indexOf('=');
    if (index === -1) continue;
    parsed[arg.slice(0, index).replace(/^--/, '')] = arg.slice(index + 1);
  }

  const limit = Number(parsed['limit'] || '10');
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`invalid --limit=${parsed['limit']}`);
  }

  return {
    trainConfig: required(parsed['trainConfig'], 'trainConfig'),
    trainConfigRef: parsed['trainConfigRef'],
    symbol: required(parsed['symbol'], 'symbol').toUpperCase(),
    outPrefix: required(parsed['outPrefix'], 'outPrefix'),
    strategyPrefix: required(parsed['strategyPrefix'], 'strategyPrefix'),
    descriptionPrefix: required(parsed['descriptionPrefix'], 'descriptionPrefix'),
    limit,
    exact: String(parsed['exact'] || 'false').toLowerCase() === 'true',
    profile: normalizeValidationProfile(parsed['profile'] || 'rolling-window'),
    outputMode: String(parsed['outputMode'] || 'files').trim().toLowerCase() === 'json' ? 'json' : 'files'
  };
}

function required(value: string | undefined, key: string): string {
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

function readJson(filePath: string): JsonObject {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as JsonObject;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function resolveTrainConfigRef(trainConfigPath: string, explicitRef?: string): string {
  if (explicitRef) {
    return toPosix(explicitRef);
  }

  const trainRoot = path.resolve(__dirname, '..', '..');
  return toPosix(path.relative(trainRoot, trainConfigPath));
}

function normalizeValidationProfile(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'custom-range' ? 'custom-range' : 'rolling-window';
}

function getYearFromConfig(config: JsonObject, fallbackName: string): string | null {
  const baseYear = String(fallbackName || '').match(/^(\d{4})_/);
  if (baseYear) {
    return baseYear[1] || null;
  }

  const startIso = config?.timeRange?.startIso;
  if (startIso) {
    const year = new Date(startIso).getUTCFullYear();
    return Number.isNaN(year) ? null : String(year);
  }

  const startMs = config?.timeRange?.startTimeMs;
  if (startMs != null) {
    const year = new Date(Number(startMs)).getUTCFullYear();
    return Number.isNaN(year) ? null : String(year);
  }

  return null;
}

function getInitialCapital(symbol: string): number {
  return symbol.toUpperCase().endsWith('JPY') ? JPY_INITIAL_CAPITAL : DEFAULT_INITIAL_CAPITAL;
}

function toUtcStartOfDay(value: string | number | Date): number {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0);
}

function toUtcEndOfDay(value: string | number | Date): number {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 0);
}

function toUtcStartOfMonth(value: number): number {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0);
}

function toUtcEndOfMonth(value: number): number {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 0);
}

function shiftUtcMonth(value: number, months: number): number {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 0, 0, 0);
}

function formatIsoDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function formatCompactDate(value: number): string {
  return formatIsoDate(value).replace(/-/g, '_');
}

function formatMonthKey(value: number): string {
  return new Date(value).toISOString().slice(0, 7);
}

function buildTimeRange(startMs: number, endMs: number): JsonObject {
  return {
    startTimeMs: startMs,
    endTimeMs: endMs,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString()
  };
}

function buildValidationTableName(symbol: string, token: string): string {
  return `backtest_results_validation_${symbol.toLowerCase()}_${token}`;
}

function buildExactValidationTableName(symbol: string, token: string, limit: number, outPrefix: string): string {
  const digest = `${outPrefix}:${symbol}:${token}:${limit}`
    .split('')
    .reduce((accumulator, char) => ((accumulator * 31) + char.charCodeAt(0)) >>> 0, 7)
    .toString(16)
    .padStart(8, '0')
    .slice(0, 8);

  return `backtest_results_top${limit}_${symbol.toLowerCase()}_${token}_${digest}`;
}

function buildSnapshotFileName(outPrefix: string, limit: number): string {
  return outPrefix.endsWith(`top${limit}`)
    ? `${outPrefix}.generated.json`
    : `${outPrefix}_top${limit}.generated.json`;
}

function buildValidationDefinitions(trainConfig: JsonObject, profile: string, customRange: JsonObject): readonly ValidationDefinition[] {
  const trainingStartSource = trainConfig?.timeRange?.startIso || trainConfig?.timeRange?.startTimeMs;
  const trainingEndSource = trainConfig?.timeRange?.endIso || trainConfig?.timeRange?.endTimeMs;
  if (!trainingStartSource || !trainingEndSource) {
    throw new Error('training timeRange is incomplete');
  }

  if (profile === 'custom-range') {
    const startIso = String(customRange?.startIso || '').trim();
    const endIso = String(customRange?.endIso || '').trim();
    if (!startIso || !endIso) {
      throw new Error('custom-range requires validationPlan.customRange');
    }
    const startMs = toUtcStartOfDay(startIso);
    const endMs = toUtcEndOfDay(endIso);
    const executionStartMs = shiftUtcMonth(toUtcStartOfMonth(startMs), -1);
    return [{
      suffix: `custom_${formatCompactDate(startMs)}_to_${formatCompactDate(endMs)}_validation`,
      label: `custom ${formatIsoDate(startMs)} -> ${formatIsoDate(endMs)}`,
      shortLabel: 'custom-range',
      tableToken: `custom_${formatCompactDate(startMs)}_${formatCompactDate(endMs)}`,
      descriptionLabel: `自定义验证 ${formatIsoDate(startMs)} -> ${formatIsoDate(endMs)}`,
      evaluationTimeRange: buildTimeRange(startMs, endMs),
      executionTimeRange: buildTimeRange(executionStartMs, endMs)
    }];
  }

  const rollingStartMs = toUtcStartOfDay(trainingStartSource);
  const rollingEndMs = toUtcEndOfDay(trainingEndSource);
  const definitions: ValidationDefinition[] = [];
  let cursorMs = toUtcStartOfMonth(rollingStartMs);

  while (cursorMs <= rollingEndMs) {
    const cursorDate = new Date(cursorMs);
    const monthToken = `${cursorDate.getUTCFullYear()}_${String(cursorDate.getUTCMonth() + 1).padStart(2, '0')}`;
    const segmentStartMs = Math.max(rollingStartMs, cursorMs);
    const segmentEndMs = Math.min(rollingEndMs, toUtcEndOfMonth(cursorMs));
    if (segmentStartMs <= segmentEndMs) {
      const executionStartMs = shiftUtcMonth(toUtcStartOfMonth(segmentStartMs), -1);
      definitions.push({
        suffix: `rolling_${monthToken}_validation`,
        label: `rolling ${formatIsoDate(segmentStartMs)} -> ${formatIsoDate(segmentEndMs)}`,
        shortLabel: 'rolling-window',
        tableToken: `rolling_${monthToken}`,
        descriptionLabel: `训练期 Rolling 验证 ${formatIsoDate(segmentStartMs)} -> ${formatIsoDate(segmentEndMs)}`,
        evaluationTimeRange: buildTimeRange(segmentStartMs, segmentEndMs),
        executionTimeRange: buildTimeRange(executionStartMs, segmentEndMs)
      });
    }
    cursorMs = shiftUtcMonth(cursorMs, 1);
  }

  if (!definitions.length) {
    throw new Error('rolling validation window is empty');
  }

  return definitions;
}

function buildTrainStrategies(trainConfig: JsonObject): readonly RuntimeStrategy[] {
  const strategyTypes = Array.isArray(trainConfig?.strategy?.types)
    ? trainConfig.strategy.types
    : ['rsi_macd'];
  const parameters = trainConfig?.strategy?.parameters || {};
  const feeModel = validateFeeModelConfig(
    trainConfig?.executor?.options?.feeModel,
    `config.executor.options.feeModel (${String(trainConfig?.name || 'training')})`
  );
  const venueCode = String(feeModel.venueCode || '').trim();

  return generateStrategyCombinations({ types: strategyTypes, parameters }).map((strategy) => ({
    ...strategy,
    name: venueCode ? `${venueCode}-${strategy.name}` : strategy.name,
    parameters: venueCode
      ? {
          ...strategy.parameters,
          venueCode
        }
      : strategy.parameters
  }));
}

async function loadEarliestKlineTime(connection: QueryableConnection, symbol: string, intervalType: string): Promise<number> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT MIN(open_time) AS min_open_time
     FROM klines
     WHERE symbol = ?
       AND interval_type IN (?, '1m', '1min')`,
    [symbol, intervalType]
  );

  const minOpenTime = Number(rows[0]?.['min_open_time'] ?? Number.NaN);
  if (!Number.isFinite(minOpenTime)) {
    throw new Error(`no klines found for symbol=${symbol} interval=${intervalType}`);
  }
  return minOpenTime;
}

async function loadKlines(
  connection: QueryableConnection,
  symbol: string,
  intervalType: string,
  startTimeMs: number,
  endTimeMs: number
): Promise<readonly RollingKlineRow[]> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT open_time,
            CAST((bid_open + ask_open) / 2 AS CHAR) AS open,
            CAST((bid_high + ask_high) / 2 AS CHAR) AS high,
            CAST((bid_low + ask_low) / 2 AS CHAR) AS low,
            CAST((bid_close + ask_close) / 2 AS CHAR) AS close,
            bid_open, bid_high, bid_low, bid_close,
            ask_open, ask_high, ask_low, ask_close,
            symbol, interval_type
     FROM klines
     WHERE symbol = ?
       AND interval_type IN (?, '1m', '1min')
       AND open_time BETWEEN ? AND ?
     ORDER BY open_time ASC`,
    [symbol, intervalType, startTimeMs, endTimeMs]
  );
  return rows as unknown as readonly RollingKlineRow[];
}

function filterKlinesByRange(
  klines: readonly RollingKlineRow[],
  startTimeMs: number,
  endTimeMs: number
): readonly RollingKlineRow[] {
  return klines.filter((row) => {
    const openTime = Number(row.open_time);
    return Number.isFinite(openTime) && openTime >= startTimeMs && openTime <= endTimeMs;
  });
}

function buildPeriodStrategyPnlMap(
  trades: readonly OosTrade[],
  getKey: (timestampMs: number) => string
): Map<string, Map<string, number>> {
  const periodMap = new Map<string, Map<string, number>>();
  for (const trade of trades) {
    const key = getKey(trade.exitTime);
    const strategyMap = periodMap.get(key) ?? new Map<string, number>();
    strategyMap.set(trade.strategyName, round((strategyMap.get(trade.strategyName) ?? 0) + trade.pnl, 2));
    periodMap.set(key, strategyMap);
  }
  return periodMap;
}

function buildDailyStrategyPnlMap(trades: readonly OosTrade[]): ReadonlyMap<string, ReadonlyMap<string, number>> {
  return buildPeriodStrategyPnlMap(trades, getJstDayKey);
}

function buildWeeklyStrategyPnlMap(trades: readonly OosTrade[]): ReadonlyMap<string, ReadonlyMap<string, number>> {
  return buildPeriodStrategyPnlMap(trades, getIsoWeekKey);
}

async function rankStrategiesForWindow(
  strategies: readonly RuntimeStrategy[],
  klines: readonly RollingKlineRow[],
  executorOptions: JsonObject,
  topN: number,
  label: string
): Promise<readonly RankedStrategy[]> {
  if (!klines.length) {
    throw new Error(`learning window ${label} has no klines`);
  }

  const ranked: RankedStrategy[] = [];
  let processed = 0;

  for (const strategy of strategies) {
    const executor = new StrategyExecutor(strategy as any, klines as any, executorOptions);
    const result = await executor.execute();
    const totalTrades = Number(result?.stats?.totalTrades || 0);
    if (totalTrades > 0) {
      ranked.push({
        rank: 0,
        name: strategy.name,
        type: strategy.type,
        parameters: strategy.parameters,
        totalTrades,
        totalPnl: Number(result?.stats?.totalPnl || 0),
        returnPct: Number(result?.stats?.returnPct || 0),
        score: Number(result?.stats?.score || 0)
      });
    }

    processed += 1;
    if (processed % 64 === 0 || processed === strategies.length) {
      console.log(`[rolling-learn] ${label}: ranked ${processed}/${strategies.length} candidates`);
    }
  }

  return ranked
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.returnPct !== left.returnPct) return right.returnPct - left.returnPct;
      if (right.totalPnl !== left.totalPnl) return right.totalPnl - left.totalPnl;
      return left.name.localeCompare(right.name);
    })
    .slice(0, topN)
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }));
}

async function simulateValidationWindow(
  strategies: readonly RankedStrategy[],
  executionKlines: readonly RollingKlineRow[],
  executorOptions: JsonObject,
  evaluationRange: JsonObject,
  symbol: string
): Promise<{
  readonly trades: readonly OosTrade[];
  readonly strategyMonthlyPnls: ReadonlyMap<string, number>;
}> {
  const startTimeMs = Number(evaluationRange.startTimeMs);
  const endTimeMs = Number(evaluationRange.endTimeMs);
  const initialCapital = getInitialCapital(symbol);
  const strategyMonthlyPnls = new Map<string, number>();
  const trades: OosTrade[] = [];

  for (const strategy of strategies) {
    const executor = new StrategyExecutor(strategy as any, executionKlines as any, executorOptions);
    const result = await executor.execute();
    const filteredTrades = (result.trades || []).filter((trade) => {
      const exitTime = Number(trade.exit_time);
      return Number.isFinite(exitTime) && exitTime >= startTimeMs && exitTime <= endTimeMs;
    });
    const totalPnl = round(filteredTrades.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0), 2);
    strategyMonthlyPnls.set(strategy.name, totalPnl);
    void initialCapital;

    for (const trade of filteredTrades) {
      trades.push({
        strategyName: strategy.name,
        exitTime: Number(trade.exit_time),
        pnl: round(Number(trade.pnl || 0), 2)
      });
    }
  }

  return {
    trades,
    strategyMonthlyPnls
  };
}

function toShortLabel(parameters: JsonObject): string {
  const rsi = parameters?.rsi && typeof parameters.rsi === 'object' ? parameters.rsi as JsonObject : {};
  const risk = parameters?.risk && typeof parameters.risk === 'object' ? parameters.risk as JsonObject : {};
  const atr = parameters?.atr && typeof parameters.atr === 'object' ? parameters.atr as JsonObject : {};
  return `OS${String(rsi.oversold ?? '-')}`
    + `/OB${String(rsi.overbought ?? '-')}`
    + `/H${String(risk.maxHoldMinutes ?? '-')}`
    + `/SL${String(atr.slMultiplier ?? '-')}`
    + `/TP${String(atr.tpMultiplier ?? '-')}`;
}

function buildStrategyCatalog(strategies: readonly RankedStrategy[]): Record<string, JsonObject> {
  return strategies.reduce((accumulator, strategy, index) => {
    const key = `rank${index + 1}`;
    accumulator[key] = {
      strategyName: strategy.name,
      shortLabel: toShortLabel(strategy.parameters),
      role: index === 0 ? 'default-fallback' : 'candidate'
    };
    return accumulator;
  }, {} as Record<string, JsonObject>);
}

function buildFeatureBucket(_sourceMonth: string, feature: PeriodFeature): string {
  return feature.featureBucket;
}

function rankPoolByPeriodPnl(
  strategies: readonly RankedStrategy[],
  strategyMap: ReadonlyMap<string, number>
): readonly { readonly strategyName: string; readonly pnl: number }[] {
  return strategies
    .map((strategy) => ({
      strategyName: strategy.name,
      pnl: round(Number(strategyMap.get(strategy.name) ?? 0), 2)
    }))
    .sort((left, right) => {
      if (right.pnl !== left.pnl) return right.pnl - left.pnl;
      return left.strategyName.localeCompare(right.strategyName);
    });
}

function buildStrategyAggregateRows(aggregates: ReadonlyMap<string, StrategyAggregate>): readonly RankedStrategy[] {
  return Array.from(aggregates.values())
    .sort((left, right) => {
      if (right.totalScore !== left.totalScore) return right.totalScore - left.totalScore;
      if (right.totalPnl !== left.totalPnl) return right.totalPnl - left.totalPnl;
      return left.name.localeCompare(right.name);
    })
    .map((item, index) => ({
      rank: index + 1,
      name: item.name,
      type: item.type,
      parameters: item.parameters,
      totalTrades: item.totalTrades,
      totalPnl: round(item.totalPnl, 2),
      returnPct: 0,
      score: round(item.totalScore / Math.max(item.scoreCount, 1), 4)
    }));
}

function summarizeRuleSamples(
  samples: readonly RuleSample[]
): {
  readonly actionType: RollingRouterAction;
  readonly averageRisk: number;
  readonly dominantStrategyName: string | null;
} {
  let stopCount = 0;
  let reduceCount = 0;
  let riskAccumulator = 0;
  const strategyScores = new Map<string, { pnl: number; count: number }>();

  for (const sample of samples) {
    if (sample.actionType === 'stop') stopCount += 1;
    if (sample.actionType === 'reduce') reduceCount += 1;
    riskAccumulator += sample.riskValue;
    if (sample.selectedStrategyName) {
      const current = strategyScores.get(sample.selectedStrategyName) ?? { pnl: 0, count: 0 };
      strategyScores.set(sample.selectedStrategyName, {
        pnl: current.pnl + sample.avgPnl,
        count: current.count + 1
      });
    }
  }

  const actionType: RollingRouterAction = stopCount >= Math.ceil(samples.length / 2)
    ? 'stop'
    : reduceCount >= Math.ceil(samples.length / 2)
      ? 'reduce'
      : 'trade';

  const dominantStrategyName = Array.from(strategyScores.entries())
    .sort((left, right) => {
      if (right[1].pnl !== left[1].pnl) return right[1].pnl - left[1].pnl;
      if (right[1].count !== left[1].count) return right[1].count - left[1].count;
      return left[0].localeCompare(right[0]);
    })[0]?.[0] ?? null;

  return {
    actionType,
    averageRisk: round(riskAccumulator / Math.max(samples.length, 1), 4),
    dominantStrategyName
  };
}

function buildRuleAction(
  layer: RouterLayer,
  summary: ReturnType<typeof summarizeRuleSamples>,
  strategyKeyMap: ReadonlyMap<string, string>,
  featureEngineering: ReturnType<typeof getDecisionFeatureEngineeringConfig>
): RouterRule['action'] {
  const normalized = summarizeAggregateAction({
    layer,
    stopShare: summary.actionType === 'stop' ? 1 : 0,
    reduceShare: summary.actionType === 'reduce' ? 1 : 0,
    averageRisk: summary.averageRisk
  }, featureEngineering.routerDecision);
  const strategyKey = summary.dominantStrategyName
    ? strategyKeyMap.get(summary.dominantStrategyName) ?? null
    : null;

  return {
    type: normalized.actionType,
    ...(layer === 'monthly_guard' || layer === 'weekly_guard'
      ? { riskCap: normalized.actionType === 'stop' ? 0 : normalized.averageRisk }
      : normalized.actionType === 'reduce'
        ? { riskMultiplier: normalized.averageRisk }
        : {}),
    ...(strategyKey && normalized.actionType !== 'stop' ? { strategyKey } : {})
  };
}

function aggregateRulesByBucket(
  layer: RouterLayer,
  samples: readonly RuleSample[],
  strategyKeyMap: ReadonlyMap<string, string>,
  featureEngineering: ReturnType<typeof getDecisionFeatureEngineeringConfig>
): readonly RouterRule[] {
  const bucketMap = new Map<string, RuleSample[]>();
  for (const sample of samples) {
    const items = bucketMap.get(sample.feature.featureBucket) ?? [];
    items.push(sample);
    bucketMap.set(sample.feature.featureBucket, items);
  }

  let priority = 1;
  return Array.from(bucketMap.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([featureBucket, bucketSamples]) => {
      const summary = summarizeRuleSamples(bucketSamples);
      return {
        id: `${layer}_${featureBucket.replace(/[^a-zA-Z0-9]+/g, '_')}`,
        layer,
        priority: priority++,
        when: {
          featureBucket: [featureBucket]
        },
        action: buildRuleAction(layer, summary, strategyKeyMap, featureEngineering),
        rationale: `${layer} learned from ${bucketSamples.length} history-only rolling OOS samples`
      } satisfies RouterRule;
    });
}

function buildWeeklySamples(
  snapshots: readonly MonthlyEvaluationSnapshot[],
  fullKlines: readonly RollingKlineRow[],
  featureEngineering: ReturnType<typeof getDecisionFeatureEngineeringConfig>
): readonly RuleSample[] {
  const weeklySamples: RuleSample[] = [];

  for (const snapshot of snapshots) {
    const rangeStart = Number(snapshot.definition.evaluationTimeRange.startTimeMs);
    const rangeEnd = Number(snapshot.definition.evaluationTimeRange.endTimeMs);
    const monthKlines = filterKlinesByRange(fullKlines, rangeStart, rangeEnd);
    const weeklyFeatures = buildPeriodFeatures(
      monthKlines,
      getIsoWeekKey,
      detectWeeklyFeatureBucket,
      {
        openingWindowCount: featureEngineering.openingWindowMinutes,
        volBaselineLookback: featureEngineering.volBaselineLookbackPeriods
      }
    );
    const weeklyPnlMap = snapshot.strategyWeekPnlMap;
    const monthFeature = snapshot.monthFeature;

    for (const weekFeature of weeklyFeatures) {
      const ranked = rankPoolByPeriodPnl(snapshot.explicitStrategies, weeklyPnlMap.get(weekFeature.key) ?? new Map<string, number>());
      const best = ranked[0] ?? null;
      const poolHealth = buildPoolHealthMetrics(ranked.map((item) => item.pnl));
      const enrichedFeature: PeriodFeature = {
        ...weekFeature,
        positiveStrategyRatio: poolHealth.positiveStrategyRatio,
        bestVsMedianGap: poolHealth.bestVsMedianGap,
        monthlyWeeklyAlignment: computeAlignmentScore(monthFeature, weekFeature)
      };
      const action = choosePeriodAction(best?.pnl ?? 0, featureEngineering.routerDecision);
      weeklySamples.push({
        periodKey: weekFeature.key,
        feature: enrichedFeature,
        selectedStrategyName: best?.strategyName ?? snapshot.monthlyWinnerName,
        actionType: action.type,
        riskValue: action.risk,
        avgPnl: best?.pnl ?? 0
      });
    }
  }

  return weeklySamples;
}

function buildDailySamples(
  snapshots: readonly MonthlyEvaluationSnapshot[],
  fullKlines: readonly RollingKlineRow[],
  featureEngineering: ReturnType<typeof getDecisionFeatureEngineeringConfig>
): readonly RuleSample[] {
  const dailySamples: RuleSample[] = [];

  for (const snapshot of snapshots) {
    const rangeStart = Number(snapshot.definition.evaluationTimeRange.startTimeMs);
    const rangeEnd = Number(snapshot.definition.evaluationTimeRange.endTimeMs);
    const executionStart = Number(snapshot.definition.executionTimeRange.startTimeMs);
    const executionKlines = filterKlinesByRange(fullKlines, executionStart, rangeEnd);
    const dailyOpeningFeatures = buildOpeningWindowPeriodFeatures(
      executionKlines,
      getJstDayKey,
      detectDailyFeatureBucket,
      {
        openingWindowCount: featureEngineering.openingWindowMinutes,
        volBaselineLookback: featureEngineering.volBaselineLookbackPeriods
      }
    );
    const weeklyFeatures = buildPeriodFeatures(
      executionKlines,
      getIsoWeekKey,
      detectWeeklyFeatureBucket,
      {
        openingWindowCount: featureEngineering.openingWindowMinutes,
        volBaselineLookback: featureEngineering.volBaselineLookbackPeriods
      }
    );
    const weekFeatureMap = new Map(weeklyFeatures.map((feature) => [feature.key, feature] as const));
    const weeklyPnlMap = snapshot.strategyWeekPnlMap;
    const dailyPnlMap = snapshot.strategyDayPnlMap;

    for (const dayFeature of dailyOpeningFeatures) {
      const dayStartMs = Date.parse(`${dayFeature.key}T00:00:00.000Z`) - JST_OFFSET_MS;
      const dayEndMs = dayStartMs + (24 * 60 * 60 * 1000) - 1;
      if (dayEndMs < rangeStart || dayStartMs > rangeEnd) {
        continue;
      }
      const weekKey = getIsoWeekKey(dayStartMs);
      const weekFeature = weekFeatureMap.get(weekKey) ?? null;
      const weekRanked = rankPoolByPeriodPnl(snapshot.explicitStrategies, weeklyPnlMap.get(weekKey) ?? new Map<string, number>());
      const dayRanked = rankPoolByPeriodPnl(snapshot.explicitStrategies, dailyPnlMap.get(dayFeature.key) ?? new Map<string, number>());
      const bestDay = dayRanked[0] ?? null;
      const weekBase = weekRanked[0] ?? null;
      const poolHealth = buildPoolHealthMetrics(dayRanked.map((item) => item.pnl));
      const enrichedFeature: PeriodFeature = {
        ...dayFeature,
        positiveStrategyRatio: poolHealth.positiveStrategyRatio,
        bestVsMedianGap: poolHealth.bestVsMedianGap,
        weeklyDailyAlignment: computeAlignmentScore(weekFeature, dayFeature)
      };
      const decision = decideDailyAction({
        bestPnl: bestDay?.pnl ?? 0,
        weekBasePnl: weekBase?.pnl ?? 0,
        bestStrategyName: bestDay?.strategyName ?? null,
        weekBaseStrategyName: weekBase?.strategyName ?? null,
        monthPrimaryStrategyName: snapshot.monthlyWinnerName
      }, featureEngineering.routerDecision);

      dailySamples.push({
        periodKey: dayFeature.key,
        feature: enrichedFeature,
        selectedStrategyName: decision.selectedStrategyName,
        actionType: decision.actionType,
        riskValue: decision.riskMultiplier,
        avgPnl: bestDay?.pnl ?? 0
      });
    }
  }

  return dailySamples;
}

function buildLossRecheckRules(
  snapshots: readonly MonthlyEvaluationSnapshot[],
  fullKlines: readonly RollingKlineRow[],
  featureEngineering: ReturnType<typeof getDecisionFeatureEngineeringConfig>,
  strategyKeyMap: ReadonlyMap<string, string>
): readonly RouterRule[] {
  const samples: LossRuleSample[] = [];

  for (const snapshot of snapshots) {
    const rangeStart = Number(snapshot.definition.evaluationTimeRange.startTimeMs);
    const rangeEnd = Number(snapshot.definition.evaluationTimeRange.endTimeMs);
    const executionStart = Number(snapshot.definition.executionTimeRange.startTimeMs);
    const executionKlines = filterKlinesByRange(fullKlines, executionStart, rangeEnd);
    const dailyFeatures = buildPeriodFeatures(
      executionKlines,
      getJstDayKey,
      detectDailyFeatureBucket,
      {
        openingWindowCount: featureEngineering.openingWindowMinutes,
        volBaselineLookback: featureEngineering.volBaselineLookbackPeriods
      }
    );
    const dailyOpeningFeatures = buildOpeningWindowPeriodFeatures(
      executionKlines,
      getJstDayKey,
      detectDailyFeatureBucket,
      {
        openingWindowCount: featureEngineering.openingWindowMinutes,
        volBaselineLookback: featureEngineering.volBaselineLookbackPeriods
      }
    );
    const weeklyFeatures = buildPeriodFeatures(
      executionKlines,
      getIsoWeekKey,
      detectWeeklyFeatureBucket,
      {
        openingWindowCount: featureEngineering.openingWindowMinutes,
        volBaselineLookback: featureEngineering.volBaselineLookbackPeriods
      }
    );
    const completeDayMap = new Map(dailyFeatures.map((feature) => [feature.key, feature] as const));
    const weekFeatureMap = new Map(weeklyFeatures.map((feature) => [feature.key, feature] as const));
    const weeklyPnlMap = snapshot.strategyWeekPnlMap;
    const dailyPnlMap = snapshot.strategyDayPnlMap;
    let previousDayFeature: PeriodFeature | null = null;
    let previousDayRoutedPnl = 0;
    let consecutiveLossDays = 0;

    for (const dayFeature of dailyOpeningFeatures) {
      const dayStartMs = Date.parse(`${dayFeature.key}T00:00:00.000Z`) - JST_OFFSET_MS;
      const dayEndMs = dayStartMs + (24 * 60 * 60 * 1000) - 1;
      if (dayEndMs < rangeStart || dayStartMs > rangeEnd) {
        continue;
      }

      const weekKey = getIsoWeekKey(dayStartMs);
      const weekFeature = weekFeatureMap.get(weekKey) ?? null;
      const weekRanked = rankPoolByPeriodPnl(snapshot.explicitStrategies, weeklyPnlMap.get(weekKey) ?? new Map<string, number>());
      const dayRanked = rankPoolByPeriodPnl(snapshot.explicitStrategies, dailyPnlMap.get(dayFeature.key) ?? new Map<string, number>());
      const bestDay = dayRanked[0] ?? null;
      const weekBase = weekRanked[0] ?? null;
      const poolHealth = buildPoolHealthMetrics(dayRanked.map((item) => item.pnl));
      const enrichedFeature: PeriodFeature = {
        ...dayFeature,
        positiveStrategyRatio: poolHealth.positiveStrategyRatio,
        bestVsMedianGap: poolHealth.bestVsMedianGap,
        weeklyDailyAlignment: computeAlignmentScore(weekFeature, dayFeature)
      };
      const weekAction = choosePeriodAction(weekBase?.pnl ?? 0, featureEngineering.routerDecision);
      const dayDecision = decideDailyAction({
        bestPnl: bestDay?.pnl ?? 0,
        weekBasePnl: weekBase?.pnl ?? 0,
        bestStrategyName: bestDay?.strategyName ?? null,
        weekBaseStrategyName: weekBase?.strategyName ?? null,
        monthPrimaryStrategyName: snapshot.monthlyWinnerName
      }, featureEngineering.routerDecision);

      const stopTriggered = snapshot.monthlyActionType === 'stop'
        || weekAction.type === 'stop'
        || dayDecision.actionType === 'stop';
      const selectedStrategyName = stopTriggered
        ? null
        : (dayDecision.selectedStrategyName ?? weekBase?.strategyName ?? snapshot.monthlyWinnerName);
      const selectedStrategyPnl = selectedStrategyName
        ? round(Number((dailyPnlMap.get(dayFeature.key) ?? new Map<string, number>()).get(selectedStrategyName) ?? 0), 2)
        : 0;

      if (previousDayRoutedPnl < 0) {
        const lossActionType: RollingRouterAction = selectedStrategyPnl <= featureEngineering.routerDecision.lossRecheckAction.stopAtOrBelowCurrentPnl
          ? 'stop'
          : selectedStrategyPnl <= featureEngineering.routerDecision.lossRecheckAction.reduceAtOrBelowCurrentPnl
            ? 'reduce'
            : 'trade';
        const riskValue = lossActionType === 'stop'
          ? 0
          : lossActionType === 'reduce'
            ? featureEngineering.routerDecision.lossRecheckAction.reduceRisk
            : featureEngineering.routerDecision.lossRecheckAction.tradeRisk;

        samples.push({
          periodKey: dayFeature.key,
          feature: enrichedFeature,
          selectedStrategyName,
          actionType: lossActionType,
          riskValue,
          avgPnl: selectedStrategyPnl,
          previousDayFeatureBucket: previousDayFeature?.featureBucket ?? null,
          consecutiveLossDaysBefore: consecutiveLossDays
        });
      }

      const effectiveRisk = stopTriggered
        ? 0
        : round(snapshot.monthlyRiskCap * weekAction.risk * dayDecision.riskMultiplier, 4);
      const routedPnl = round(selectedStrategyPnl * effectiveRisk, 2);
      previousDayFeature = completeDayMap.get(dayFeature.key) ?? enrichedFeature;
      previousDayRoutedPnl = routedPnl;
      consecutiveLossDays = routedPnl < 0 ? consecutiveLossDays + 1 : 0;
    }
  }

  const bucketMap = new Map<string, LossRuleSample[]>();
  for (const sample of samples) {
    const previousBucket = sample.previousDayFeatureBucket || 'unknown';
    const streakKey = sample.consecutiveLossDaysBefore >= 2 ? 'streak2p' : 'streak1';
    const key = `${sample.feature.featureBucket}__${previousBucket}__${streakKey}`;
    const items = bucketMap.get(key) ?? [];
    items.push(sample);
    bucketMap.set(key, items);
  }

  let priority = 1;
  return Array.from(bucketMap.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([, bucketSamples]) => {
      const summary = summarizeRuleSamples(bucketSamples);
      const first = bucketSamples[0];
      const when: JsonObject = {
        featureBucket: [first?.feature.featureBucket ?? 'range-mid-vol'],
        previousDayRoutedPnl: { lt: 0 }
      };
      if (first?.previousDayFeatureBucket) {
        when.previousDayFeatureBucket = [first.previousDayFeatureBucket];
      }
      when.consecutiveLossDays = first && first.consecutiveLossDaysBefore >= 2
        ? { gte: 2 }
        : { lte: 1 };

      return {
        id: `loss_recheck_${String(first?.feature.featureBucket || 'fallback').replace(/[^a-zA-Z0-9]+/g, '_')}_${String(first?.previousDayFeatureBucket || 'unknown').replace(/[^a-zA-Z0-9]+/g, '_')}_${first && first.consecutiveLossDaysBefore >= 2 ? 'gte2' : 'lte1'}`,
        layer: 'loss_recheck',
        priority: priority++,
        when,
        action: buildRuleAction('loss_recheck', summary, strategyKeyMap, featureEngineering),
        rationale: `loss_recheck learned from ${bucketSamples.length} history-only rolling loss feedback samples`
      } satisfies RouterRule;
    });
}

async function buildHistoryOnlyRollingState(
  connection: QueryableConnection,
  trainConfig: JsonObject,
  args: Args
): Promise<{
  readonly fullKlines: readonly RollingKlineRow[];
  readonly snapshots: readonly MonthlyEvaluationSnapshot[];
  readonly unionStrategies: readonly RankedStrategy[];
  readonly strategyCatalog: Record<string, JsonObject>;
  readonly defaultStrategyKey: string | null;
  readonly routerRules: readonly RouterRule[];
  readonly rollingPlanRules: {
    readonly monthlyGuard: readonly RouterRule[];
    readonly weeklyGuard: readonly RouterRule[];
    readonly dailyRouter: readonly RouterRule[];
    readonly lossRecheck: readonly RouterRule[];
  };
}> {
  const intervalType = String(trainConfig?.market?.intervalType || '1min');
  const dataStartMs = await loadEarliestKlineTime(connection, args.symbol, intervalType);
  const configEndMs = Number(trainConfig?.timeRange?.endTimeMs ?? Date.parse(String(trainConfig?.timeRange?.endIso || '')));
  if (!Number.isFinite(configEndMs)) {
    throw new Error('training config end time is missing');
  }

  const fullKlines = await loadKlines(connection, args.symbol, intervalType, dataStartMs, configEndMs);
  const validationDefinitions = buildValidationDefinitions(
    trainConfig,
    args.profile,
    trainConfig?.validationPlan?.customRange && typeof trainConfig.validationPlan.customRange === 'object'
      ? trainConfig.validationPlan.customRange
      : {}
  );
  const runtimeStrategies = buildTrainStrategies(trainConfig);
  const featureEngineering = getDecisionFeatureEngineeringConfig(trainConfig.featureEngineering);
  const strategyAggregates = new Map<string, StrategyAggregate>();
  const snapshots: MonthlyEvaluationSnapshot[] = [];

  console.log(`[rolling-learn] generated ${runtimeStrategies.length} candidate strategies for history-only monthly learning`);

  for (const definition of validationDefinitions) {
    const validationStartMs = Number(definition.evaluationTimeRange.startTimeMs);
    const validationEndMs = Number(definition.evaluationTimeRange.endTimeMs);
    const executionStartMs = Number(definition.executionTimeRange.startTimeMs);
    const trainingWindowEndMs = validationStartMs - 60_000;
    const preferredStartMs = shiftUtcMonth(toUtcStartOfMonth(validationStartMs), -ROLLING_LOOKBACK_MONTHS);
    const trainingWindowStartMs = Math.max(dataStartMs, preferredStartMs);
    const trainingKlines = filterKlinesByRange(fullKlines, trainingWindowStartMs, trainingWindowEndMs);
    const executionKlines = filterKlinesByRange(fullKlines, executionStartMs, validationEndMs);
    const rankedStrategies = await rankStrategiesForWindow(
      runtimeStrategies,
      trainingKlines,
      trainConfig.executor?.options || {},
      args.limit,
      `${definition.label} learning`
    );
    if (!rankedStrategies.length) {
      throw new Error(`no valid strategies learned for ${definition.label}`);
    }

    const validationMonthKlines = filterKlinesByRange(fullKlines, validationStartMs, validationEndMs);
    const monthFeature = buildPeriodFeatures(
      validationMonthKlines,
      getJstMonthKey,
      detectMonthlyFeatureBucket,
      {
        openingWindowCount: featureEngineering.openingWindowMinutes,
        volBaselineLookback: featureEngineering.volBaselineLookbackPeriods
      }
    )[0];
    if (!monthFeature) {
      throw new Error(`unable to compute month feature for ${definition.label}`);
    }

    const simulated = await simulateValidationWindow(
      rankedStrategies,
      executionKlines,
      trainConfig.executor?.options || {},
      definition.evaluationTimeRange,
      args.symbol
    );

    const monthlyTopStrategies = rankedStrategies
      .map((strategy) => ({
        rank: strategy.rank,
        strategyName: strategy.name,
        totalPnl: round(Number(simulated.strategyMonthlyPnls.get(strategy.name) ?? 0), 2),
        score: strategy.score
      }))
      .sort((left, right) => {
        if (right.totalPnl !== left.totalPnl) return right.totalPnl - left.totalPnl;
        if (right.score !== left.score) return right.score - left.score;
        return left.strategyName.localeCompare(right.strategyName);
      });

    const monthlyWinner = monthlyTopStrategies[0] ?? null;
    const monthlyAction = choosePeriodAction(monthlyWinner?.totalPnl ?? 0, featureEngineering.routerDecision);
    const sourceMonth = formatMonthKey(toUtcStartOfMonth(trainingWindowEndMs));
    const featureBucket = buildFeatureBucket(sourceMonth, monthFeature);
    const enrichedMonthFeature: PeriodFeature = {
      ...monthFeature,
      featureBucket,
      positiveStrategyRatio: buildPoolHealthMetrics(monthlyTopStrategies.map((item) => item.totalPnl)).positiveStrategyRatio,
      bestVsMedianGap: buildPoolHealthMetrics(monthlyTopStrategies.map((item) => item.totalPnl)).bestVsMedianGap
    };

    for (const strategy of rankedStrategies) {
      const aggregate = strategyAggregates.get(strategy.name) ?? {
        name: strategy.name,
        type: strategy.type,
        parameters: strategy.parameters,
        totalTrades: 0,
        totalPnl: 0,
        totalScore: 0,
        scoreCount: 0
      };
      aggregate.totalTrades += strategy.totalTrades;
      aggregate.totalPnl += Number(simulated.strategyMonthlyPnls.get(strategy.name) ?? 0);
      aggregate.totalScore += strategy.score;
      aggregate.scoreCount += 1;
      strategyAggregates.set(strategy.name, aggregate);
    }

    snapshots.push({
      definition,
      validationMonth: formatMonthKey(validationStartMs),
      trainingWindow: buildTimeRange(trainingWindowStartMs, trainingWindowEndMs),
      sourceMonth,
      monthFeature: enrichedMonthFeature,
      explicitStrategies: rankedStrategies,
      monthlyTopStrategies,
      monthlyWinnerName: monthlyWinner?.strategyName ?? null,
      monthlyWinnerPnl: monthlyWinner?.totalPnl ?? 0,
      monthlyActionType: monthlyAction.type,
      monthlyRiskCap: monthlyAction.risk,
      oosTrades: simulated.trades,
      strategyDayPnlMap: buildDailyStrategyPnlMap(simulated.trades),
      strategyWeekPnlMap: buildWeeklyStrategyPnlMap(simulated.trades)
    });
  }

  const unionStrategies = buildStrategyAggregateRows(strategyAggregates);
  const strategyCatalog = buildStrategyCatalog(unionStrategies);
  const strategyKeyMap = new Map(
    Object.entries(strategyCatalog).map(([key, value]) => [String(value.strategyName), key] as const)
  );
  const defaultStrategyKey = unionStrategies[0] ? 'rank1' : null;

  const monthlySamples: RuleSample[] = snapshots.map((snapshot) => ({
    periodKey: snapshot.validationMonth,
    feature: snapshot.monthFeature,
    selectedStrategyName: snapshot.monthlyWinnerName,
    actionType: snapshot.monthlyActionType,
    riskValue: snapshot.monthlyRiskCap,
    avgPnl: snapshot.monthlyWinnerPnl
  }));
  const weeklySamples = buildWeeklySamples(snapshots, fullKlines, featureEngineering);
  const dailySamples = buildDailySamples(snapshots, fullKlines, featureEngineering);

  const monthlyGuardRules = aggregateRulesByBucket('monthly_guard', monthlySamples, strategyKeyMap, featureEngineering);
  const weeklyGuardRules = aggregateRulesByBucket('weekly_guard', weeklySamples, strategyKeyMap, featureEngineering);
  const dailyRouterRules = aggregateRulesByBucket('daily_router', dailySamples, strategyKeyMap, featureEngineering);
  const lossRecheckRules = buildLossRecheckRules(snapshots, fullKlines, featureEngineering, strategyKeyMap);

  return {
    fullKlines,
    snapshots,
    unionStrategies,
    strategyCatalog,
    defaultStrategyKey,
    routerRules: [...monthlyGuardRules, ...weeklyGuardRules, ...dailyRouterRules, ...lossRecheckRules],
    rollingPlanRules: {
      monthlyGuard: monthlyGuardRules,
      weeklyGuard: weeklyGuardRules,
      dailyRouter: dailyRouterRules,
      lossRecheck: lossRecheckRules
    }
  };
}

function buildArtifacts(
  args: Args,
  trainConfig: JsonObject,
  rollingState: Awaited<ReturnType<typeof buildHistoryOnlyRollingState>>
): GeneratedArtifactsResult {
  const trainId = String(trainConfig.trainId || trainConfig.trainingMeta?.trainId || '').trim();
  const trainConfigRef = resolveTrainConfigRef(args.trainConfig, args.trainConfigRef);
  const trainingYear = getYearFromConfig(trainConfig, path.basename(args.trainConfig)) || 'run';

  const validationConfigs = rollingState.snapshots.map((snapshot) => ({
    configKey: `configs/validation/${args.outPrefix}_${snapshot.definition.suffix}.json`,
    configType: 'validation',
    content: {
      ...(trainId ? { trainId } : {}),
      name: `${args.symbol}_ROLLING_${String(snapshot.definition.shortLabel).toUpperCase().replace(/-/g, '_')}_FROM_${trainingYear}_VALIDATION`,
      description: `${args.symbol} ${snapshot.definition.descriptionLabel} - 基于 history-only rolling learning`,
      timeRange: snapshot.definition.executionTimeRange,
      market: {
        symbol: args.symbol,
        intervalType: trainConfig.market.intervalType
      },
      database: {
        tableName: args.exact
          ? buildExactValidationTableName(args.symbol, String(snapshot.definition.tableToken), args.limit, `${args.outPrefix}_${snapshot.definition.suffix}`)
          : buildValidationTableName(args.symbol, String(snapshot.definition.tableToken)),
        resetTableBeforeRun: true
      },
      strategy: {
        explicitStrategies: snapshot.explicitStrategies.map((strategy) => ({
          rank: strategy.rank,
          name: strategy.name,
          type: strategy.type,
          parameters: strategy.parameters
        }))
      },
      featureEngineering: trainConfig.featureEngineering,
      executor: trainConfig.executor,
      output: {
        topN: args.limit,
        strategyNamePrefix: `${args.strategyPrefix}${String(snapshot.definition.shortLabel).toUpperCase()}-`,
        descriptionPrefix: `${args.descriptionPrefix} ${snapshot.definition.descriptionLabel}`
      },
      trainConfig: trainConfigRef,
      trainingMeta: trainId ? { trainId } : undefined,
      validationProfile: args.profile,
      validationTarget: {
        label: snapshot.definition.label,
        cutoffDate: String(snapshot.definition.evaluationTimeRange.endIso).slice(0, 10),
        startIso: snapshot.definition.evaluationTimeRange.startIso,
        endIso: snapshot.definition.evaluationTimeRange.endIso,
        startTimeMs: snapshot.definition.evaluationTimeRange.startTimeMs,
        endTimeMs: snapshot.definition.evaluationTimeRange.endTimeMs,
        evaluationTimeRange: snapshot.definition.evaluationTimeRange,
        executionTimeRange: snapshot.definition.executionTimeRange
      },
      rollingSource: {
        mode: 'history-only',
        lookbackMonths: ROLLING_LOOKBACK_MONTHS,
        trainingWindow: snapshot.trainingWindow,
        sourceMonth: snapshot.sourceMonth,
        featureBucket: snapshot.monthFeature.featureBucket,
        candidateCount: snapshot.explicitStrategies.length
      },
      rollingPlan: {
        monthlyPools: rollingState.snapshots.map((item) => ({
          month: item.validationMonth,
          sourceMonth: item.sourceMonth,
          featureBucket: item.monthFeature.featureBucket,
          selectedStrategyName: item.monthlyWinnerName,
          actionType: item.monthlyActionType,
          riskCap: item.monthlyRiskCap,
          currentBestPnl: item.monthlyWinnerPnl,
          trainingWindow: item.trainingWindow,
          topStrategies: item.explicitStrategies.map((strategy) => ({
            rank: strategy.rank,
            strategyName: strategy.name,
            totalPnl: strategy.totalPnl,
            score: strategy.score
          }))
        })),
        rules: {
          monthlyGuard: rollingState.rollingPlanRules.monthlyGuard,
          weeklyGuard: rollingState.rollingPlanRules.weeklyGuard,
          dailyRouter: rollingState.rollingPlanRules.dailyRouter,
          lossRecheck: rollingState.rollingPlanRules.lossRecheck
        }
      }
    }
  }));

  const snapshotConfigKey = `configs/top-strategies/${buildSnapshotFileName(args.outPrefix, args.limit)}`;
  const snapshotContent = {
    ...(trainId ? { trainId } : {}),
    artifactType: 'rolling-strategy-package',
    learningMode: 'history-only',
    lookbackMonths: ROLLING_LOOKBACK_MONTHS,
    name: `${args.symbol}_ROLLING_PACKAGE_FROM_${trainingYear}`,
    description: `${args.symbol} history-only rolling candidate pools + router learning package`,
    generatedAt: new Date().toISOString(),
    limit: args.limit,
    exact: args.exact,
    symbol: args.symbol,
    market: {
      symbol: args.symbol,
      intervalType: trainConfig.market.intervalType
    },
    executor: trainConfig.executor,
    featureEngineering: trainConfig.featureEngineering,
    strategy: {
      explicitStrategies: rollingState.unionStrategies.map((strategy, index) => ({
        rank: index + 1,
        name: strategy.name,
        type: strategy.type,
        parameters: strategy.parameters
      }))
    },
    output: {
      topN: args.limit,
      persistTopStrategies: false,
      persistTrades: false,
      strategyNamePrefix: `${args.strategyPrefix}ROLLING-`,
      descriptionPrefix: `${args.descriptionPrefix} rolling strategy package`
    },
    trainingContext: {
      ...(trainId ? { trainId } : {}),
      trainingYear,
      timeRange: trainConfig.timeRange,
      learningMode: 'history-only',
      lookbackMonths: ROLLING_LOOKBACK_MONTHS
    },
    validationTargets: rollingState.snapshots.map((snapshot) => ({
      label: snapshot.definition.label,
      startIso: snapshot.definition.evaluationTimeRange.startIso,
      endIso: snapshot.definition.evaluationTimeRange.endIso,
      trainingWindow: snapshot.trainingWindow
    })),
    validationProfile: args.profile,
    strategies: rollingState.unionStrategies.map((strategy, index) => ({
      rank: index + 1,
      strategyName: strategy.name,
      strategyType: strategy.type,
      parameters: strategy.parameters
    })),
    rollingPlan: {
      monthlyPools: rollingState.snapshots.map((snapshot) => ({
        month: snapshot.validationMonth,
        sourceMonth: snapshot.sourceMonth,
        featureBucket: snapshot.monthFeature.featureBucket,
        selectedStrategyName: snapshot.monthlyWinnerName,
        actionType: snapshot.monthlyActionType,
        riskCap: snapshot.monthlyRiskCap,
        currentBestPnl: snapshot.monthlyWinnerPnl,
        trainingWindow: snapshot.trainingWindow,
        topStrategies: snapshot.explicitStrategies.map((strategy) => ({
          rank: strategy.rank,
          strategyName: strategy.name,
          totalPnl: strategy.totalPnl,
          score: strategy.score
        }))
      })),
      rules: {
        monthlyGuard: rollingState.rollingPlanRules.monthlyGuard,
        weeklyGuard: rollingState.rollingPlanRules.weeklyGuard,
        dailyRouter: rollingState.rollingPlanRules.dailyRouter,
        lossRecheck: rollingState.rollingPlanRules.lossRecheck
      }
    },
    rollingRouter: {
      strategyCatalog: rollingState.strategyCatalog,
      defaultStrategyKey: rollingState.defaultStrategyKey,
      rules: rollingState.routerRules
    }
  };

  return {
    validationConfigs,
    snapshot: {
      configKey: snapshotConfigKey,
      configType: 'top-strategies',
      content: snapshotContent
    }
  };
}

export async function runGenerateValidationArtifacts(
  args: Args,
  options: {
    readonly connection?: QueryableConnection;
    readonly trainRoot?: string;
    readonly trainConfig?: JsonObject;
  } = {}
): Promise<GeneratedArtifactsResult> {
  const trainRoot = options.trainRoot ?? path.resolve(__dirname, '..', '..');
  const trainConfigPath = path.resolve(args.trainConfig);
  const trainConfig = options.trainConfig ?? readJson(trainConfigPath);
  const ownsConnection = !options.connection;
  const connection = options.connection ?? await createMysqlConnectionWithFallback(mysql, {
    defaults: {
      host: '127.0.0.1'
    }
  });

  try {
    const rollingState = await buildHistoryOnlyRollingState(connection, trainConfig, args);
    const artifacts = buildArtifacts(args, trainConfig, rollingState);

    if (args.outputMode === 'files') {
      for (const item of artifacts.validationConfigs) {
        writeJson(path.resolve(trainRoot, item.configKey), item.content);
      }
      writeJson(path.resolve(trainRoot, artifacts.snapshot.configKey), artifacts.snapshot.content);
    }

    return artifacts;
  } finally {
    if (ownsConnection) {
      await connection.end();
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const artifacts = await runGenerateValidationArtifacts(args);
  if (args.outputMode === 'json') {
    process.stdout.write(`${JSON.stringify(artifacts)}\n`);
  }
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
