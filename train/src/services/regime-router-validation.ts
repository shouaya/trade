import * as fs from 'fs';
import * as path from 'path';
import type * as mysql from 'mysql2/promise';
import db from '../configs/database';
import { loadRouterPolicyCatalogByRouterConfig, type RouterPolicyCatalog } from './router-policy-catalog';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const JPY_INITIAL_CAPITAL = 1_000_000;
const DEFAULT_INITIAL_CAPITAL = 10_000;

type RouterLayer = 'monthly_guard' | 'weekly_guard' | 'daily_router' | 'loss_recheck';
type RouterActionType = 'trade' | 'reduce' | 'stop';

interface ValidationConfig {
  readonly name: string;
  readonly description?: string;
  readonly timeRange: {
    readonly startTimeMs: number;
    readonly endTimeMs: number;
    readonly startIso?: string;
    readonly endIso?: string;
  };
  readonly market: {
    readonly symbol: string;
    readonly intervalType: string;
  };
  readonly strategy: {
    readonly explicitStrategies: readonly ValidationStrategy[];
  };
}

interface ValidationStrategy {
  readonly rank?: number;
  readonly name: string;
  readonly type: string;
  readonly parameters: {
    readonly atr?: {
      readonly slMultiplier?: number;
      readonly tpMultiplier?: number;
    };
    readonly rsi: {
      readonly oversold?: number;
      readonly overbought?: number;
    };
    readonly risk: {
      readonly maxHoldMinutes?: number | null;
    };
  };
}

interface RouterConfig {
  readonly symbol: string;
  readonly routerVersion: string;
  readonly policyCatalogPath?: string;
  readonly executionModel: {
    readonly precedence: readonly string[];
    readonly defaultFallback: {
      readonly action: 'reduce' | 'trade';
      readonly riskMultiplier: number;
      readonly strategyKey: string;
    };
  };
  readonly strategyCatalog: Record<string, RouterStrategyRef>;
  readonly rules: readonly RouterRule[];
}

interface RouterStrategyRef {
  readonly strategyName: string;
  readonly shortLabel: string;
  readonly role?: string;
}

interface NumericCondition {
  readonly gte?: number;
  readonly gt?: number;
  readonly lte?: number;
  readonly lt?: number;
}

interface RouterCondition {
  readonly featureBucket?: readonly string[];
  readonly realizedVolPct?: NumericCondition;
  readonly absReturnPct?: NumericCondition;
  readonly avgRangePct?: NumericCondition;
  readonly upMinuteRatio?: NumericCondition;
  readonly previousDayFeatureBucket?: readonly string[];
  readonly previousDayRoutedPnl?: NumericCondition;
  readonly consecutiveLossDays?: NumericCondition;
  readonly anyOf?: readonly RouterCondition[];
}

interface RouterRule {
  readonly id: string;
  readonly layer: RouterLayer;
  readonly priority: number;
  readonly when: RouterCondition;
  readonly action: {
    readonly type: RouterActionType;
    readonly riskCap?: number;
    readonly riskMultiplier?: number;
    readonly strategyKey?: string;
  };
  readonly rationale?: string;
}

interface TradeRow extends mysql.RowDataPacket {
  readonly strategy_name: string;
  readonly exit_time: number | string;
  readonly pnl: number | string;
}

interface KlineRow extends mysql.RowDataPacket {
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
}

interface PeriodFeature {
  readonly key: string;
  readonly minutes: number;
  readonly realizedVolPct: number;
  readonly avgAbsReturnPct: number;
  readonly avgRangePct: number;
  readonly maxAbsReturnPct: number;
  readonly maxRangePct: number;
  readonly returnPct: number;
  readonly upMinuteRatio: number;
  readonly featureBucket: string;
}

interface RouterState {
  readonly previousDayFeature: PeriodFeature | null;
  readonly previousDayRoutedPnl: number;
  readonly consecutiveLossDays: number;
}

interface LayerDecision {
  readonly ruleId: string | null;
  readonly actionType: RouterActionType;
  readonly riskCap: number;
  readonly riskMultiplier: number;
  readonly strategyKey: string | null;
}

interface ComparisonMetrics {
  readonly name: string;
  readonly label: string;
  readonly totalPnl: number;
  readonly returnPct: number;
  readonly maxDrawdown: number;
  readonly maxDrawdownPct: number;
  readonly positiveDays: number;
  readonly negativeDays: number;
  readonly tradedDays: number;
  readonly positiveWeeks: number;
  readonly negativeWeeks: number;
  readonly finalEquity: number;
}

interface DailyRouteRow {
  readonly day: string;
  readonly month: string;
  readonly week: string;
  readonly featureBucket: string;
  readonly dayReturnPct: number;
  readonly realizedVolPct: number;
  readonly avgRangePct: number;
  readonly upMinuteRatio: number;
  readonly monthRuleId: string | null;
  readonly weekRuleId: string | null;
  readonly dayRuleId: string | null;
  readonly lossRuleId: string | null;
  readonly selectedStrategyKey: string | null;
  readonly selectedStrategyName: string | null;
  readonly selectedStrategyLabel: string | null;
  readonly effectiveRiskMultiplier: number;
  readonly previousDayRoutedPnl: number;
  readonly consecutiveLossDaysBefore: number;
  readonly rawStrategyPnl: number;
  readonly routedPnl: number;
  readonly baselineDefaultPnl: number;
  readonly baselineRank1Pnl: number;
  readonly baselineTop10EqualWeightPnl: number;
  readonly oracleBestOfDayPnl: number;
}

export interface RouterValidationRunOptions {
  readonly validationConfigPath: string;
  readonly routerConfigPath: string;
  readonly tradeCreatedAt?: string;
}

export interface RouterValidationReport {
  readonly symbol: string;
  readonly validationName: string;
  readonly routerVersion: string;
  readonly tradeCreatedAt: string;
  readonly policyCatalog: RouterPolicyCatalog | null;
  readonly period: {
    readonly startTimeMs: number;
    readonly endTimeMs: number;
  };
  readonly comparison: {
    readonly router: ComparisonMetrics;
    readonly defaultStrategy: ComparisonMetrics;
    readonly rank1Strategy: ComparisonMetrics;
    readonly top10EqualWeight: ComparisonMetrics;
    readonly oracleBestOfDay: ComparisonMetrics;
  };
  readonly dailyRoutes: readonly DailyRouteRow[];
}

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
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

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function resolveConfigPath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(__dirname, '..', '..', filePath);
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

function extractPrice(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function choosePrice(row: KlineRow, field: 'open' | 'high' | 'low' | 'close'): number | null {
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
  klines: readonly KlineRow[],
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
        maxAbsReturnPct: 0,
        maxRangePct: 0,
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
    period.maxAbsReturnPct = Math.max(period.maxAbsReturnPct, absReturnPct);
    period.maxRangePct = Math.max(period.maxRangePct, rangePct);
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
        minutes: period.count,
        realizedVolPct: round(realizedVolPct, 2),
        avgAbsReturnPct: round(period.sumAbsReturnPct / period.count, 4),
        avgRangePct: round(period.sumRangePct / period.count, 4),
        maxAbsReturnPct: round(period.maxAbsReturnPct, 4),
        maxRangePct: round(period.maxRangePct, 4),
        returnPct: round(returnPct, 2),
        upMinuteRatio: round((period.upMinutes / period.count) * 100, 2),
        featureBucket: detectBucket(returnPct, realizedVolPct)
      };
    });
}

function isNumericConditionMatched(condition: NumericCondition | undefined, value: number): boolean {
  if (!condition) return true;
  if (condition.gte !== undefined && value < condition.gte) return false;
  if (condition.gt !== undefined && value <= condition.gt) return false;
  if (condition.lte !== undefined && value > condition.lte) return false;
  if (condition.lt !== undefined && value >= condition.lt) return false;
  return true;
}

function isConditionMatched(condition: RouterCondition, feature: PeriodFeature, state: RouterState | null = null): boolean {
  if (condition.featureBucket && !condition.featureBucket.includes(feature.featureBucket)) {
    return false;
  }
  if (!isNumericConditionMatched(condition.realizedVolPct, feature.realizedVolPct)) {
    return false;
  }
  if (!isNumericConditionMatched(condition.absReturnPct, Math.abs(feature.returnPct))) {
    return false;
  }
  if (!isNumericConditionMatched(condition.avgRangePct, feature.avgRangePct)) {
    return false;
  }
  if (!isNumericConditionMatched(condition.upMinuteRatio, feature.upMinuteRatio)) {
    return false;
  }
  if (condition.previousDayFeatureBucket) {
    const previousBucket = state?.previousDayFeature?.featureBucket;
    if (!previousBucket || !condition.previousDayFeatureBucket.includes(previousBucket)) {
      return false;
    }
  }
  if (condition.previousDayRoutedPnl && !isNumericConditionMatched(condition.previousDayRoutedPnl, state?.previousDayRoutedPnl ?? 0)) {
    return false;
  }
  if (condition.consecutiveLossDays && !isNumericConditionMatched(condition.consecutiveLossDays, state?.consecutiveLossDays ?? 0)) {
    return false;
  }
  if (condition.anyOf && condition.anyOf.length > 0) {
    return condition.anyOf.some((child) => isConditionMatched(child, feature, state));
  }
  return true;
}

function decideLayer(
  router: RouterConfig,
  layer: RouterLayer,
  feature: PeriodFeature | null,
  state: RouterState | null = null
): LayerDecision {
  if (!feature) {
    return {
      ruleId: null,
      actionType: 'trade',
      riskCap: 1,
      riskMultiplier: 1,
      strategyKey: null
    };
  }

  const matchedRule = [...router.rules]
    .filter((rule) => rule.layer === layer)
    .sort((left, right) => left.priority - right.priority)
    .find((rule) => isConditionMatched(rule.when, feature, state));

  if (!matchedRule) {
    return {
      ruleId: null,
      actionType: 'trade',
      riskCap: 1,
      riskMultiplier: 1,
      strategyKey: null
    };
  }

  return {
    ruleId: matchedRule.id,
    actionType: matchedRule.action.type,
    riskCap: matchedRule.action.riskCap ?? 1,
    riskMultiplier: matchedRule.action.riskMultiplier ?? 1,
    strategyKey: matchedRule.action.strategyKey ?? null
  };
}

function computeMetrics(
  name: string,
  label: string,
  pnls: readonly number[],
  initialCapital: number,
  weekKeys: readonly string[]
): ComparisonMetrics {
  let cumulativePnl = 0;
  let peakEquity = initialCapital;
  let maxDrawdown = 0;
  let positiveDays = 0;
  let negativeDays = 0;
  let tradedDays = 0;
  const weeklyPnls = new Map<string, number>();

  for (const [index, pnl] of pnls.entries()) {
    if (pnl > 0) positiveDays += 1;
    if (pnl < 0) negativeDays += 1;
    if (pnl !== 0) tradedDays += 1;

    const weekKey = weekKeys[index];
    if (weekKey) {
      weeklyPnls.set(weekKey, round((weeklyPnls.get(weekKey) ?? 0) + pnl, 2));
    }

    cumulativePnl += pnl;
    const equity = initialCapital + cumulativePnl;
    if (equity > peakEquity) {
      peakEquity = equity;
    }
    const drawdown = peakEquity - equity;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  let positiveWeeks = 0;
  let negativeWeeks = 0;
  for (const pnl of weeklyPnls.values()) {
    if (pnl > 0) positiveWeeks += 1;
    if (pnl < 0) negativeWeeks += 1;
  }

  return {
    name,
    label,
    totalPnl: round(cumulativePnl, 2),
    returnPct: round((cumulativePnl / initialCapital) * 100, 4),
    maxDrawdown: round(maxDrawdown, 2),
    maxDrawdownPct: round((maxDrawdown / initialCapital) * 100, 4),
    positiveDays,
    negativeDays,
    tradedDays,
    positiveWeeks,
    negativeWeeks,
    finalEquity: round(initialCapital + cumulativePnl, 2)
  };
}

function getInitialCapital(symbol: string): number {
  return symbol.toUpperCase().endsWith('JPY') ? JPY_INITIAL_CAPITAL : DEFAULT_INITIAL_CAPITAL;
}

async function findTradeBatch(
  connection: mysql.Pool,
  strategyNames: readonly string[],
  symbol: string,
  startTimeMs: number,
  endTimeMs: number
): Promise<string> {
  const placeholders = strategyNames.map(() => '?').join(', ');
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i:%s') AS created_at
     FROM trades
     WHERE strategy_name IN (${placeholders})
       AND symbol = ?
       AND exit_time BETWEEN ? AND ?`,
    [...strategyNames, symbol, startTimeMs, endTimeMs]
  );

  const createdAt = rows[0]?.['created_at'];
  if (!createdAt) {
    throw new Error('could not detect trade batch from trades table');
  }
  return String(createdAt);
}

async function loadTrades(
  connection: mysql.Pool,
  strategyNames: readonly string[],
  symbol: string,
  startTimeMs: number,
  endTimeMs: number,
  createdAt: string
): Promise<readonly TradeRow[]> {
  const placeholders = strategyNames.map(() => '?').join(', ');
  const [rows] = await connection.query<TradeRow[]>(
    `SELECT strategy_name, exit_time, pnl
     FROM trades
     WHERE created_at = ?
       AND strategy_name IN (${placeholders})
       AND symbol = ?
       AND exit_time BETWEEN ? AND ?
     ORDER BY exit_time ASC, strategy_name ASC`,
    [createdAt, ...strategyNames, symbol, startTimeMs, endTimeMs]
  );
  return rows;
}

async function loadKlines(
  connection: mysql.Pool,
  symbol: string,
  intervalType: string,
  startTimeMs: number,
  endTimeMs: number
): Promise<readonly KlineRow[]> {
  const [rows] = await connection.query<KlineRow[]>(
    `SELECT open_time,
            CAST((bid_open + ask_open) / 2 AS CHAR) AS open,
            CAST((bid_high + ask_high) / 2 AS CHAR) AS high,
            CAST((bid_low + ask_low) / 2 AS CHAR) AS low,
            CAST((bid_close + ask_close) / 2 AS CHAR) AS close,
            bid_open, bid_high, bid_low, bid_close,
            ask_open, ask_high, ask_low, ask_close
     FROM klines
     WHERE symbol = ?
       AND interval_type IN (?, '1m', '1min')
       AND open_time BETWEEN ? AND ?
     ORDER BY open_time ASC`,
    [symbol, intervalType, startTimeMs, endTimeMs]
  );
  return rows;
}

function buildDailyStrategyPnlMap(trades: readonly TradeRow[]): Map<string, Map<string, number>> {
  const byDay = new Map<string, Map<string, number>>();

  for (const row of trades) {
    const day = getJstDayKey(Number(row.exit_time));
    const strategyName = String(row.strategy_name);
    const pnl = Number(row.pnl);
    let strategyMap = byDay.get(day);
    if (!strategyMap) {
      strategyMap = new Map<string, number>();
      byDay.set(day, strategyMap);
    }
    strategyMap.set(strategyName, round((strategyMap.get(strategyName) ?? 0) + pnl, 2));
  }

  return byDay;
}

function toShortLabel(strategy: ValidationStrategy): string {
  return `OS${strategy.parameters.rsi.oversold ?? '-'}`
    + `/OB${strategy.parameters.rsi.overbought ?? '-'}`
    + `/H${strategy.parameters.risk.maxHoldMinutes ?? '-'}`
    + `/SL${strategy.parameters.atr?.slMultiplier ?? '-'}`
    + `/TP${strategy.parameters.atr?.tpMultiplier ?? '-'}`;
}

export async function runRouterValidation(options: RouterValidationRunOptions): Promise<RouterValidationReport> {
  const resolvedValidationConfigPath = resolveConfigPath(options.validationConfigPath);
  const resolvedRouterConfigPath = resolveConfigPath(options.routerConfigPath);
  const validationConfig = loadJson<ValidationConfig>(resolvedValidationConfigPath);
  const routerConfig = loadJson<RouterConfig>(resolvedRouterConfigPath);
  const policyCatalog = loadRouterPolicyCatalogByRouterConfig(resolvedRouterConfigPath, routerConfig);

  if (!validationConfig.strategy.explicitStrategies.length) {
    throw new Error('validation config has no explicit strategies');
  }

  const symbol = validationConfig.market.symbol.toUpperCase();
  const startTimeMs = validationConfig.timeRange.startTimeMs;
  const endTimeMs = validationConfig.timeRange.endTimeMs;
  const strategyNames = validationConfig.strategy.explicitStrategies.map((strategy) => strategy.name);

  const createdAt = options.tradeCreatedAt
    ? options.tradeCreatedAt
    : await findTradeBatch(db, strategyNames, symbol, startTimeMs, endTimeMs);

  const [trades, klines] = await Promise.all([
    loadTrades(db, strategyNames, symbol, startTimeMs, endTimeMs, createdAt),
    loadKlines(db, symbol, validationConfig.market.intervalType, startTimeMs, endTimeMs)
  ]);

  const dailyFeatures = buildPeriodFeatures(klines, getJstDayKey, detectDailyFeatureBucket);
  const weeklyFeatures = buildPeriodFeatures(klines, getIsoWeekKey, detectWeeklyFeatureBucket);
  const monthlyFeatures = buildPeriodFeatures(klines, getJstMonthKey, detectMonthlyFeatureBucket);

  const weeklyMap = new Map(weeklyFeatures.map((item) => [item.key, item] as const));
  const monthlyMap = new Map(monthlyFeatures.map((item) => [item.key, item] as const));
  const tradeMap = buildDailyStrategyPnlMap(trades);

  const defaultStrategyKey = routerConfig.executionModel.defaultFallback.strategyKey;
  const defaultStrategyRef = routerConfig.strategyCatalog[defaultStrategyKey];
  if (!defaultStrategyRef) {
    throw new Error(`router default fallback strategy missing: ${defaultStrategyKey}`);
  }

  const rank1Strategy = validationConfig.strategy.explicitStrategies[0];
  if (!rank1Strategy) {
    throw new Error('validation config rank1 strategy missing');
  }

  const initialCapital = getInitialCapital(symbol);
  const strategyCount = validationConfig.strategy.explicitStrategies.length;

  const routerPnls: number[] = [];
  const defaultPnls: number[] = [];
  const rank1Pnls: number[] = [];
  const equalWeightPnls: number[] = [];
  const oraclePnls: number[] = [];
  const weekKeys: string[] = [];
  const dailyRoutes: DailyRouteRow[] = [];
  let previousDayFeature: PeriodFeature | null = null;
  let previousDayRoutedPnl = 0;
  let consecutiveLossDays = 0;

  for (const dayFeature of dailyFeatures) {
    const month = dayFeature.key.slice(0, 7);
    const week = getIsoWeekKey(Date.parse(`${dayFeature.key}T00:00:00.000Z`) - JST_OFFSET_MS);
    const monthFeature = monthlyMap.get(month) ?? null;
    const weekFeature = weeklyMap.get(week) ?? null;

    const monthDecision = decideLayer(routerConfig, 'monthly_guard', monthFeature);
    const weekDecision = decideLayer(routerConfig, 'weekly_guard', weekFeature);
    const dayDecision = decideLayer(routerConfig, 'daily_router', dayFeature);
    const lossDecision = decideLayer(routerConfig, 'loss_recheck', dayFeature, {
      previousDayFeature,
      previousDayRoutedPnl,
      consecutiveLossDays
    });

    const stopTriggered = monthDecision.actionType === 'stop'
      || weekDecision.actionType === 'stop'
      || dayDecision.actionType === 'stop'
      || lossDecision.actionType === 'stop';

    const selectedStrategyKey = !stopTriggered
      ? (
        lossDecision.strategyKey
        ?? dayDecision.strategyKey
        ?? weekDecision.strategyKey
        ?? monthDecision.strategyKey
        ?? defaultStrategyKey
      )
      : null;
    const selectedStrategyRef = selectedStrategyKey ? routerConfig.strategyCatalog[selectedStrategyKey] : null;

    const hasLayerStrategyOverride = Boolean(lossDecision.strategyKey || dayDecision.strategyKey || weekDecision.strategyKey || monthDecision.strategyKey);
    const dayRiskMultiplier = stopTriggered
      ? 0
      : (
        lossDecision.ruleId
          ? lossDecision.riskMultiplier
          : dayDecision.ruleId
          ? dayDecision.riskMultiplier
          : (hasLayerStrategyOverride ? 1 : routerConfig.executionModel.defaultFallback.riskMultiplier)
      );
    const effectiveRiskMultiplier = stopTriggered
      ? 0
      : round(monthDecision.riskCap * weekDecision.riskCap * dayRiskMultiplier, 4);

    const dailyStrategyPnl = tradeMap.get(dayFeature.key) ?? new Map<string, number>();
    const rawStrategyPnl = selectedStrategyRef ? (dailyStrategyPnl.get(selectedStrategyRef.strategyName) ?? 0) : 0;
    const routedPnl = round(rawStrategyPnl * effectiveRiskMultiplier, 2);
    const defaultPnl = round(dailyStrategyPnl.get(defaultStrategyRef.strategyName) ?? 0, 2);
    const rank1Pnl = round(dailyStrategyPnl.get(rank1Strategy.name) ?? 0, 2);
    const allStrategyPnls = validationConfig.strategy.explicitStrategies.map((strategy) => round(dailyStrategyPnl.get(strategy.name) ?? 0, 2));
    const equalWeightPnl = round(allStrategyPnls.reduce((sum, pnl) => sum + pnl, 0) / strategyCount, 2);
    const oracleBestPnl = round(Math.max(...allStrategyPnls, 0), 2);

    weekKeys.push(week);
    routerPnls.push(routedPnl);
    defaultPnls.push(defaultPnl);
    rank1Pnls.push(rank1Pnl);
    equalWeightPnls.push(equalWeightPnl);
    oraclePnls.push(oracleBestPnl);

    dailyRoutes.push({
      day: dayFeature.key,
      month,
      week,
      featureBucket: dayFeature.featureBucket,
      dayReturnPct: dayFeature.returnPct,
      realizedVolPct: dayFeature.realizedVolPct,
      avgRangePct: dayFeature.avgRangePct,
      upMinuteRatio: dayFeature.upMinuteRatio,
      monthRuleId: monthDecision.ruleId,
      weekRuleId: weekDecision.ruleId,
      dayRuleId: dayDecision.ruleId,
      lossRuleId: lossDecision.ruleId,
      selectedStrategyKey,
      selectedStrategyName: selectedStrategyRef?.strategyName ?? null,
      selectedStrategyLabel: selectedStrategyRef?.shortLabel ?? null,
      effectiveRiskMultiplier,
      previousDayRoutedPnl: round(previousDayRoutedPnl, 2),
      consecutiveLossDaysBefore: consecutiveLossDays,
      rawStrategyPnl: round(rawStrategyPnl, 2),
      routedPnl,
      baselineDefaultPnl: defaultPnl,
      baselineRank1Pnl: rank1Pnl,
      baselineTop10EqualWeightPnl: equalWeightPnl,
      oracleBestOfDayPnl: oracleBestPnl
    });

    previousDayFeature = dayFeature;
    previousDayRoutedPnl = routedPnl;
    consecutiveLossDays = routedPnl < 0 ? consecutiveLossDays + 1 : 0;
  }

  return {
    symbol,
    validationName: validationConfig.name,
    routerVersion: routerConfig.routerVersion,
    tradeCreatedAt: createdAt,
    policyCatalog,
    period: {
      startTimeMs,
      endTimeMs
    },
    comparison: {
      router: computeMetrics('router', 'Router', routerPnls, initialCapital, weekKeys),
      defaultStrategy: computeMetrics('default_strategy', defaultStrategyRef.shortLabel, defaultPnls, initialCapital, weekKeys),
      rank1Strategy: computeMetrics('rank1_strategy', toShortLabel(rank1Strategy), rank1Pnls, initialCapital, weekKeys),
      top10EqualWeight: computeMetrics('top10_equal_weight', 'Top10 Equal Weight', equalWeightPnls, initialCapital, weekKeys),
      oracleBestOfDay: computeMetrics('oracle_best_of_day', 'Oracle Best Of Day', oraclePnls, initialCapital, weekKeys)
    },
    dailyRoutes
  };
}
