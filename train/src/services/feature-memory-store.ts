import { createHash } from 'crypto';
import {
  ANALYSIS_ARTIFACTS_TABLE,
  FEATURE_CANDIDATE_POOLS_TABLE,
  FEATURE_CANDIDATE_POOL_ITEMS_TABLE,
  FEATURE_MATCHES_TABLE,
  FEATURE_MEMORIES_TABLE,
  FEATURE_WRITEBACKS_TABLE,
  MARKET_WINDOWS_TABLE,
  STRATEGY_DEFINITIONS_TABLE,
  STRATEGY_LIBRARY_MEMBERS_TABLE,
  STRATEGY_PARAMETER_SETS_TABLE,
  TRAIN_RUNS_TABLE,
  UNKNOWN_FEATURE_EVENTS_TABLE,
  WINDOW_BEST_ACTIONS_TABLE,
  WINDOW_STRATEGY_EVALUATIONS_TABLE,
  ensureFeatureMemorySchema
} from '@money/database';
import type * as mysql from 'mysql2/promise';
import type { PeriodFeature } from './rolling-features';

const FEATURE_VERSION = 'rolling-feature-memory-v1';
const FEATURE_SCHEMA_VERSION = 'period-feature-v1';
const STRATEGY_SPACE_VERSION = 'feature-memory-rolling-v1';

type JsonValue = unknown;

export interface FeatureMemoryRankedStrategy {
  readonly rank: number;
  readonly name: string;
  readonly type: string;
  readonly parameters: JsonValue;
  readonly totalTrades: number;
  readonly totalPnl: number;
  readonly returnPct: number;
  readonly score: number;
  readonly evaluationRole?: string;
}

export interface FeatureMemoryActionSample {
  readonly periodKey: string;
  readonly feature: PeriodFeature;
  readonly selectedStrategyName: string | null;
  readonly actionType: string;
  readonly riskValue: number;
  readonly avgPnl: number;
}

export interface FeatureMemoryMonthlySnapshot {
  readonly validationMonth: string;
  readonly trainingWindow: {
    readonly startTimeMs: number;
    readonly endTimeMs: number;
  };
  readonly monthFeature: PeriodFeature;
  readonly explicitStrategies: readonly FeatureMemoryRankedStrategy[];
  readonly monthlyWinnerName: string | null;
  readonly monthlyWinnerPnl: number;
  readonly monthlyActionType: string;
  readonly monthlyRiskCap: number;
  readonly poolStatus?: string;
  readonly selectionSource?: string;
  readonly unknownReasonCode?: string | null;
  readonly matches?: readonly {
    readonly matchedPeriodKey: string;
    readonly similarityScore: number;
    readonly confidenceScore: number;
    readonly featureBucket?: string | null;
    readonly reusedStrategies?: readonly string[];
  }[];
}

export interface SaveRollingFeatureMemoryInput {
  readonly runKey: string;
  readonly trainId?: string | null;
  readonly symbol: string;
  readonly intervalType: string;
  readonly trainConfigKey?: string | null;
  readonly trainConfigName?: string | null;
  readonly strategyCatalog: readonly FeatureMemoryRankedStrategy[];
  readonly monthlySnapshots: readonly FeatureMemoryMonthlySnapshot[];
  readonly weeklySamples: readonly FeatureMemoryActionSample[];
  readonly dailySamples: readonly FeatureMemoryActionSample[];
  readonly routerRules: readonly JsonValue[];
  readonly artifactPayload: JsonValue;
}

type QueryableDb = mysql.Pool | mysql.Connection | {
  readonly query: <T = unknown>(sql: string, params?: readonly unknown[]) => Promise<[T, unknown]>;
};

interface StoredStrategyRef {
  readonly parameterSetId: number;
}

function normalizeString(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function stableHash(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 12);
}

function resolveStrategyVersions(strategyType: string): {
  readonly entry: string;
  readonly exit: string;
  readonly risk: string;
} {
  if (strategyType === 'rsi_macd') {
    return {
      entry: 'rsi-macd-v1',
      exit: 'atr-tp-v1',
      risk: 'atr-risk-v1'
    };
  }

  return {
    entry: `${strategyType}-entry-v1`,
    exit: `${strategyType}-exit-v1`,
    risk: `${strategyType}-risk-v1`
  };
}

function buildWindowKey(symbol: string, intervalType: string, windowType: string, periodKey: string): string {
  return `${symbol}:${intervalType}:${windowType}:${periodKey}`;
}

function toJstStartMs(dateToken: string): number {
  return Date.parse(`${dateToken}T00:00:00+09:00`);
}

function resolveMonthWindow(periodKey: string): { readonly startMs: number; readonly endMs: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!match) {
    throw new Error(`invalid monthly period key: ${periodKey}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const startMs = Date.parse(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01T00:00:00+09:00`);
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endMs = Date.parse(`${String(nextMonthYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+09:00`) - 1;
  return { startMs, endMs };
}

function resolveIsoWeekMondayDate(periodKey: string): string {
  const match = /^(\d{4})-W(\d{2})$/.exec(periodKey);
  if (!match) {
    throw new Error(`invalid weekly period key: ${periodKey}`);
  }
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4.getTime() - ((jan4Day - 1) * 86400000) + ((week - 1) * 7 * 86400000));
  return monday.toISOString().slice(0, 10);
}

function resolveWindowRange(windowType: string, periodKey: string): {
  readonly startMs: number;
  readonly endMs: number;
} {
  if (windowType === 'monthly') {
    return resolveMonthWindow(periodKey);
  }
  if (windowType === 'daily' || windowType === 'opening') {
    const startMs = toJstStartMs(periodKey);
    return {
      startMs,
      endMs: startMs + (24 * 60 * 60 * 1000) - 1
    };
  }
  if (windowType === 'weekly') {
    const monday = resolveIsoWeekMondayDate(periodKey);
    const startMs = toJstStartMs(monday);
    return {
      startMs,
      endMs: startMs + (7 * 24 * 60 * 60 * 1000) - 1
    };
  }

  throw new Error(`unsupported window type: ${windowType}`);
}

function buildFeatureVector(feature: PeriodFeature): Record<string, number> {
  return {
    minutes: normalizeNumber(feature.minutes),
    realizedVolPct: normalizeNumber(feature.realizedVolPct),
    avgAbsReturnPct: normalizeNumber(feature.avgAbsReturnPct),
    avgRangePct: normalizeNumber(feature.avgRangePct),
    maxAbsReturnPct: normalizeNumber(feature.maxAbsReturnPct),
    maxRangePct: normalizeNumber(feature.maxRangePct),
    returnPct: normalizeNumber(feature.returnPct),
    upMinuteRatio: normalizeNumber(feature.upMinuteRatio),
    trendEfficiency: normalizeNumber(feature.trendEfficiency),
    volExpansionRatio: normalizeNumber(feature.volExpansionRatio),
    openingImpulse: normalizeNumber(feature.openingImpulse),
    reversalStrength: normalizeNumber(feature.reversalStrength),
    positiveStrategyRatio: normalizeNumber(feature.positiveStrategyRatio),
    bestVsMedianGap: normalizeNumber(feature.bestVsMedianGap),
    monthlyWeeklyAlignment: normalizeNumber(feature.monthlyWeeklyAlignment),
    weeklyDailyAlignment: normalizeNumber(feature.weeklyDailyAlignment)
  };
}

function buildFeatureSummary(feature: PeriodFeature): Record<string, unknown> {
  return {
    periodKey: feature.key,
    featureBucket: feature.featureBucket,
    minutes: feature.minutes,
    returnPct: feature.returnPct,
    realizedVolPct: feature.realizedVolPct,
    trendEfficiency: feature.trendEfficiency,
    openingImpulse: feature.openingImpulse,
    reversalStrength: feature.reversalStrength
  };
}

async function upsertId(
  db: QueryableDb,
  sql: string,
  params: readonly unknown[]
): Promise<number> {
  const [result] = await queryDb<mysql.ResultSetHeader>(db, sql, params);
  return normalizeNumber((result as mysql.ResultSetHeader).insertId);
}

async function queryDb<T = unknown>(
  db: QueryableDb,
  sql: string,
  params: readonly unknown[] = []
): Promise<[T, unknown]> {
  const query = (db as {
    readonly query: (statement: string, values?: readonly unknown[]) => Promise<[T, unknown]>;
  }).query;
  return query.call(db, sql, params);
}

async function upsertTrainRun(
  db: QueryableDb,
  input: SaveRollingFeatureMemoryInput
): Promise<number> {
  return upsertId(
    db,
    `INSERT INTO ${TRAIN_RUNS_TABLE}
      (
        run_key,
        symbol,
        interval_type,
        mode,
        status,
        feature_version,
        strategy_space_version,
        requested_window_type,
        started_at,
        completed_at,
        notes_json
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       status = VALUES(status),
       completed_at = CURRENT_TIMESTAMP,
       notes_json = VALUES(notes_json),
       updated_at = CURRENT_TIMESTAMP`,
    [
      input.runKey,
      input.symbol,
      input.intervalType,
      'rolling',
      'completed',
      FEATURE_VERSION,
      STRATEGY_SPACE_VERSION,
      'monthly',
      JSON.stringify({
        trainId: normalizeString(input.trainId),
        trainConfigKey: normalizeString(input.trainConfigKey),
        trainConfigName: normalizeString(input.trainConfigName)
      })
    ]
  );
}

async function upsertMarketWindow(
  db: QueryableDb,
  input: {
    readonly symbol: string;
    readonly intervalType: string;
    readonly windowType: string;
    readonly periodKey: string;
  }
): Promise<number> {
  const range = resolveWindowRange(input.windowType, input.periodKey);
  return upsertId(
    db,
    `INSERT INTO ${MARKET_WINDOWS_TABLE}
      (
        symbol,
        interval_type,
        window_type,
        window_key,
        window_start_ms,
        window_end_ms,
        is_complete
      )
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       window_end_ms = VALUES(window_end_ms),
       is_complete = VALUES(is_complete),
       updated_at = CURRENT_TIMESTAMP`,
    [
      input.symbol,
      input.intervalType,
      input.windowType,
      buildWindowKey(input.symbol, input.intervalType, input.windowType, input.periodKey),
      range.startMs,
      range.endMs
    ]
  );
}

async function upsertFeatureMemory(
  db: QueryableDb,
  input: {
    readonly windowId: number;
    readonly symbol: string;
    readonly feature: PeriodFeature;
    readonly sourceType: string;
  }
): Promise<number> {
  return upsertId(
    db,
    `INSERT INTO ${FEATURE_MEMORIES_TABLE}
      (
        window_id,
        symbol,
        feature_version,
        feature_schema_version,
        feature_bucket,
        feature_vector_json,
        feature_summary_json,
        confidence_seed,
        quality_score,
        source_type
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       feature_bucket = VALUES(feature_bucket),
       feature_vector_json = VALUES(feature_vector_json),
       feature_summary_json = VALUES(feature_summary_json),
       confidence_seed = VALUES(confidence_seed),
       quality_score = VALUES(quality_score),
       source_type = VALUES(source_type),
       updated_at = CURRENT_TIMESTAMP`,
    [
      input.windowId,
      input.symbol,
      FEATURE_VERSION,
      FEATURE_SCHEMA_VERSION,
      input.feature.featureBucket,
      JSON.stringify(buildFeatureVector(input.feature)),
      JSON.stringify(buildFeatureSummary(input.feature)),
      normalizeNumber(input.feature.positiveStrategyRatio, 0) / 100,
      Math.max(0, normalizeNumber(input.feature.trendEfficiency, 0)),
      input.sourceType
    ]
  );
}

async function upsertStrategyDefinition(
  db: QueryableDb,
  strategy: FeatureMemoryRankedStrategy
): Promise<number> {
  const versions = resolveStrategyVersions(strategy.type);
  return upsertId(
    db,
    `INSERT INTO ${STRATEGY_DEFINITIONS_TABLE}
      (
        strategy_key,
        strategy_family,
        strategy_type,
        entry_logic_version,
        exit_logic_version,
        risk_logic_version,
        description,
        is_active
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       strategy_family = VALUES(strategy_family),
       strategy_type = VALUES(strategy_type),
       description = VALUES(description),
       updated_at = CURRENT_TIMESTAMP`,
    [
      strategy.name,
      strategy.type,
      strategy.type,
      versions.entry,
      versions.exit,
      versions.risk,
      `learned strategy ${strategy.name}`
    ]
  );
}

async function upsertStrategyParameterSet(
  db: QueryableDb,
  strategyDefinitionId: number,
  runId: number,
  strategy: FeatureMemoryRankedStrategy
): Promise<number> {
  return upsertId(
    db,
    `INSERT INTO ${STRATEGY_PARAMETER_SETS_TABLE}
      (
        strategy_definition_id,
        parameter_key,
        parameters_json,
        source_type,
        status,
        discovered_run_id
      )
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       parameters_json = VALUES(parameters_json),
       status = VALUES(status),
       discovered_run_id = VALUES(discovered_run_id),
       updated_at = CURRENT_TIMESTAMP`,
    [
      strategyDefinitionId,
      `param_${stableHash(strategy.parameters)}`,
      JSON.stringify(strategy.parameters ?? null),
      'discovered',
      'active',
      runId
    ]
  );
}

async function upsertStrategyLibraryMember(
  db: QueryableDb,
  input: {
    readonly symbol: string;
    readonly parameterSetId: number;
    readonly sampleCount: number;
    readonly winWindowCount: number;
    readonly loseWindowCount: number;
    readonly promotionScore: number;
    readonly confidenceScore: number;
  }
): Promise<void> {
  await queryDb(
    db,
    `INSERT INTO ${STRATEGY_LIBRARY_MEMBERS_TABLE}
      (
        symbol,
        strategy_parameter_set_id,
        status,
        promotion_score,
        confidence_score,
        sample_count,
        win_window_count,
        lose_window_count
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       promotion_score = VALUES(promotion_score),
       confidence_score = VALUES(confidence_score),
       sample_count = VALUES(sample_count),
       win_window_count = VALUES(win_window_count),
       lose_window_count = VALUES(lose_window_count),
       updated_at = CURRENT_TIMESTAMP`,
    [
      input.symbol,
      input.parameterSetId,
      input.sampleCount > 0 ? 'trusted' : 'candidate',
      input.promotionScore,
      input.confidenceScore,
      input.sampleCount,
      input.winWindowCount,
      input.loseWindowCount
    ]
  );
}

async function upsertCandidatePool(
  db: QueryableDb,
  input: {
    readonly runId: number;
    readonly featureMemoryId: number;
    readonly symbol: string;
    readonly poolStatus: string;
    readonly confidenceScore: number;
    readonly poolSize: number;
  }
): Promise<number> {
  return upsertId(
    db,
    `INSERT INTO ${FEATURE_CANDIDATE_POOLS_TABLE}
      (
        run_id,
        feature_memory_id,
        symbol,
        pool_status,
        confidence_score,
        pool_size
      )
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       pool_status = VALUES(pool_status),
       confidence_score = VALUES(confidence_score),
       pool_size = VALUES(pool_size)`,
    [
      input.runId,
      input.featureMemoryId,
      input.symbol,
      input.poolStatus,
      input.confidenceScore,
      input.poolSize
    ]
  );
}

async function upsertCandidatePoolItem(
  db: QueryableDb,
  input: {
    readonly poolId: number;
    readonly parameterSetId: number;
    readonly rank: number;
    readonly expectedRiskMode: string;
    readonly expectedConfidenceScore: number;
  }
): Promise<void> {
  await queryDb(
    db,
    `INSERT INTO ${FEATURE_CANDIDATE_POOL_ITEMS_TABLE}
      (
        feature_candidate_pool_id,
        strategy_parameter_set_id,
        rank_no,
        selection_reason,
        expected_risk_mode,
        expected_confidence_score
      )
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       selection_reason = VALUES(selection_reason),
       expected_risk_mode = VALUES(expected_risk_mode),
       expected_confidence_score = VALUES(expected_confidence_score)`,
    [
      input.poolId,
      input.parameterSetId,
      input.rank,
      input.rank === 1 ? 'monthly-winner-candidate' : 'rolling-candidate',
      input.expectedRiskMode,
      input.expectedConfidenceScore
    ]
  );
}

async function upsertWindowStrategyEvaluation(
  db: QueryableDb,
  input: {
    readonly runId: number;
    readonly windowId: number;
    readonly featureMemoryId: number;
    readonly parameterSetId: number;
    readonly strategy: FeatureMemoryRankedStrategy;
  }
): Promise<void> {
  await queryDb(
    db,
    `INSERT INTO ${WINDOW_STRATEGY_EVALUATIONS_TABLE}
      (
        run_id,
        window_id,
        feature_memory_id,
        strategy_parameter_set_id,
        evaluation_role,
        trade_count,
        total_pnl,
        return_pct,
        score,
        metrics_json
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       trade_count = VALUES(trade_count),
       total_pnl = VALUES(total_pnl),
       return_pct = VALUES(return_pct),
       score = VALUES(score),
       metrics_json = VALUES(metrics_json)`,
    [
      input.runId,
      input.windowId,
      input.featureMemoryId,
      input.parameterSetId,
      normalizeString((input.strategy as { readonly evaluationRole?: string }).evaluationRole) || 'exploration',
      input.strategy.totalTrades,
      input.strategy.totalPnl,
      input.strategy.returnPct,
      input.strategy.score,
      JSON.stringify({
        rank: input.strategy.rank,
        strategyName: input.strategy.name,
        strategyType: input.strategy.type
      })
    ]
  );
}

async function upsertWindowBestAction(
  db: QueryableDb,
  input: {
    readonly runId: number;
    readonly windowId: number;
    readonly featureMemoryId: number;
    readonly parameterSetId: number | null;
    readonly actionType: string;
    readonly riskMultiplier: number;
    readonly confidenceScore: number;
    readonly selectionSource?: string | null;
    readonly rationale: JsonValue;
  }
): Promise<number> {
  return upsertId(
    db,
    `INSERT INTO ${WINDOW_BEST_ACTIONS_TABLE}
      (
        run_id,
        window_id,
        feature_memory_id,
        best_strategy_parameter_set_id,
        action_type,
        risk_multiplier,
        selection_source,
        confidence_score,
        rationale_json
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       best_strategy_parameter_set_id = VALUES(best_strategy_parameter_set_id),
       action_type = VALUES(action_type),
       risk_multiplier = VALUES(risk_multiplier),
       confidence_score = VALUES(confidence_score),
       rationale_json = VALUES(rationale_json)`,
    [
      input.runId,
      input.windowId,
      input.featureMemoryId,
      input.parameterSetId,
      input.actionType,
      input.riskMultiplier,
      normalizeString(input.selectionSource) || 'exploration',
      input.confidenceScore,
      JSON.stringify(input.rationale ?? null)
    ]
  );
}

async function insertFeatureMatch(
  db: QueryableDb,
  input: {
    readonly runId: number;
    readonly targetFeatureMemoryId: number;
    readonly matchedFeatureMemoryId: number;
    readonly rankNo: number;
    readonly similarityScore: number;
    readonly confidenceScore: number;
    readonly matchReason: JsonValue;
    readonly isReused: boolean;
  }
): Promise<void> {
  await queryDb(
    db,
    `INSERT INTO ${FEATURE_MATCHES_TABLE}
      (
        run_id,
        target_feature_memory_id,
        matched_feature_memory_id,
        rank_no,
        distance_metric,
        distance_score,
        similarity_score,
        confidence_score,
        match_reason_json,
        is_reused
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       distance_score = VALUES(distance_score),
       similarity_score = VALUES(similarity_score),
       confidence_score = VALUES(confidence_score),
       match_reason_json = VALUES(match_reason_json),
       is_reused = VALUES(is_reused)`,
    [
      input.runId,
      input.targetFeatureMemoryId,
      input.matchedFeatureMemoryId,
      input.rankNo,
      'cosine',
      1 - input.similarityScore,
      input.similarityScore,
      input.confidenceScore,
      JSON.stringify(input.matchReason ?? null),
      input.isReused ? 1 : 0
    ]
  );
}

async function insertUnknownFeatureEvent(
  db: QueryableDb,
  input: {
    readonly runId: number;
    readonly windowId: number;
    readonly featureMemoryId: number;
    readonly reasonCode: string;
    readonly fallbackActionType: string;
    readonly fallbackRiskMultiplier: number;
    readonly details: JsonValue;
  }
): Promise<void> {
  await queryDb(
    db,
    `INSERT INTO ${UNKNOWN_FEATURE_EVENTS_TABLE}
      (
        run_id,
        window_id,
        feature_memory_id,
        reason_code,
        fallback_action_type,
        fallback_risk_multiplier,
        resolved_by_writeback,
        details_json
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       fallback_action_type = VALUES(fallback_action_type),
       fallback_risk_multiplier = VALUES(fallback_risk_multiplier),
       details_json = VALUES(details_json)`,
    [
      input.runId,
      input.windowId,
      input.featureMemoryId,
      input.reasonCode,
      input.fallbackActionType,
      input.fallbackRiskMultiplier,
      1,
      JSON.stringify(input.details ?? null)
    ]
  );
}

async function insertFeatureWriteback(
  db: QueryableDb,
  input: {
    readonly runId: number;
    readonly windowId: number;
    readonly featureMemoryId: number;
    readonly bestActionId: number;
    readonly payload: JsonValue;
  }
): Promise<void> {
  await queryDb(
    db,
    `INSERT INTO ${FEATURE_WRITEBACKS_TABLE}
      (
        run_id,
        window_id,
        feature_memory_id,
        best_action_id,
        writeback_type,
        writeback_payload_json
      )
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.runId,
      input.windowId,
      input.featureMemoryId,
      input.bestActionId,
      'new_memory',
      JSON.stringify(input.payload ?? null)
    ]
  );
}

async function upsertAnalysisArtifact(
  db: QueryableDb,
  input: {
    readonly runId: number;
    readonly symbol: string;
    readonly payload: JsonValue;
  }
): Promise<void> {
  await queryDb(
    db,
    `INSERT INTO ${ANALYSIS_ARTIFACTS_TABLE}
      (
        artifact_key,
        artifact_type,
        run_id,
        symbol,
        payload_json,
        summary_markdown
      )
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       run_id = VALUES(run_id),
       payload_json = VALUES(payload_json),
       summary_markdown = VALUES(summary_markdown),
       updated_at = CURRENT_TIMESTAMP`,
    [
      `rolling-package:${input.symbol}:${stableHash(input.payload)}`,
      'evaluation-report',
      input.runId,
      input.symbol,
      JSON.stringify(input.payload ?? null),
      null
    ]
  );
}

function buildStrategyStats(
  strategies: readonly FeatureMemoryRankedStrategy[],
  snapshots: readonly FeatureMemoryMonthlySnapshot[]
): Map<string, {
  sampleCount: number;
  winWindowCount: number;
  loseWindowCount: number;
  averageScore: number;
  averagePnl: number;
}> {
  const stats = new Map<string, {
    sampleCount: number;
    winWindowCount: number;
    loseWindowCount: number;
    totalScore: number;
    totalPnl: number;
  }>();

  for (const strategy of strategies) {
    stats.set(strategy.name, {
      sampleCount: 0,
      winWindowCount: 0,
      loseWindowCount: 0,
      totalScore: 0,
      totalPnl: 0
    });
  }

  for (const snapshot of snapshots) {
    for (const strategy of snapshot.explicitStrategies) {
      const current = stats.get(strategy.name) ?? {
        sampleCount: 0,
        winWindowCount: 0,
        loseWindowCount: 0,
        totalScore: 0,
        totalPnl: 0
      };
      current.sampleCount += 1;
      current.totalScore += normalizeNumber(strategy.score);
      current.totalPnl += normalizeNumber(strategy.totalPnl);
      if (strategy.totalPnl > 0) {
        current.winWindowCount += 1;
      } else if (strategy.totalPnl < 0) {
        current.loseWindowCount += 1;
      }
      stats.set(strategy.name, current);
    }
  }

  return new Map(
    Array.from(stats.entries()).map(([name, value]) => [name, {
      sampleCount: value.sampleCount,
      winWindowCount: value.winWindowCount,
      loseWindowCount: value.loseWindowCount,
      averageScore: value.sampleCount > 0 ? value.totalScore / value.sampleCount : 0,
      averagePnl: value.sampleCount > 0 ? value.totalPnl / value.sampleCount : 0
    }] as const)
  );
}

export async function saveRollingFeatureMemory(
  db: QueryableDb,
  input: SaveRollingFeatureMemoryInput
): Promise<void> {
  await ensureFeatureMemorySchema(db as any);

  const runId = await upsertTrainRun(db, input);
  const strategyRefs = new Map<string, StoredStrategyRef>();
  const strategyStats = buildStrategyStats(input.strategyCatalog, input.monthlySnapshots);
  const monthlyContext = new Map<string, {
    readonly windowId: number;
    readonly featureMemoryId: number;
  }>();

  for (const strategy of input.strategyCatalog) {
    const definitionId = await upsertStrategyDefinition(db, strategy);
    const parameterSetId = await upsertStrategyParameterSet(db, definitionId, runId, strategy);
    strategyRefs.set(strategy.name, { parameterSetId });

    const stats = strategyStats.get(strategy.name);
    await upsertStrategyLibraryMember(db, {
      symbol: input.symbol,
      parameterSetId,
      sampleCount: stats?.sampleCount ?? 0,
      winWindowCount: stats?.winWindowCount ?? 0,
      loseWindowCount: stats?.loseWindowCount ?? 0,
      promotionScore: normalizeNumber(stats?.averagePnl, 0),
      confidenceScore: Math.max(0, normalizeNumber(stats?.averageScore, 0))
    });
  }

  for (const snapshot of input.monthlySnapshots) {
    const windowId = await upsertMarketWindow(db, {
      symbol: input.symbol,
      intervalType: input.intervalType,
      windowType: 'monthly',
      periodKey: snapshot.validationMonth
    });
    const featureMemoryId = await upsertFeatureMemory(db, {
      windowId,
      symbol: input.symbol,
      feature: snapshot.monthFeature,
      sourceType: 'observed'
    });
    const confidenceScore = Math.max(0, normalizeNumber(snapshot.monthFeature.positiveStrategyRatio, 0) / 100);
    const poolId = await upsertCandidatePool(db, {
      runId,
      featureMemoryId,
      symbol: input.symbol,
      poolStatus: 'explored',
      confidenceScore,
      poolSize: snapshot.explicitStrategies.length
    });

    for (const strategy of snapshot.explicitStrategies) {
      const strategyRef = strategyRefs.get(strategy.name);
      if (!strategyRef) {
        continue;
      }
      await upsertWindowStrategyEvaluation(db, {
        runId,
        windowId,
        featureMemoryId,
        parameterSetId: strategyRef.parameterSetId,
        strategy
      });
      await upsertCandidatePoolItem(db, {
        poolId,
        parameterSetId: strategyRef.parameterSetId,
        rank: strategy.rank,
        expectedRiskMode: snapshot.monthlyActionType === 'stop'
          ? 'stop'
          : snapshot.monthlyActionType === 'reduce'
            ? 'reduce'
            : 'trade',
        expectedConfidenceScore: Math.max(0, normalizeNumber(strategy.score, 0))
      });
    }

    const winnerParameterSetId = snapshot.monthlyWinnerName
      ? strategyRefs.get(snapshot.monthlyWinnerName)?.parameterSetId ?? null
      : null;
    const bestActionId = await upsertWindowBestAction(db, {
      runId,
      windowId,
      featureMemoryId,
      parameterSetId: winnerParameterSetId,
      actionType: snapshot.monthlyActionType,
      riskMultiplier: snapshot.monthlyRiskCap,
      confidenceScore,
      selectionSource: snapshot.selectionSource ?? null,
      rationale: {
        trainingWindow: snapshot.trainingWindow,
        monthlyWinnerName: snapshot.monthlyWinnerName,
        monthlyWinnerPnl: snapshot.monthlyWinnerPnl,
        poolStatus: normalizeString(snapshot.poolStatus),
        matches: snapshot.matches ?? []
      }
    });

    monthlyContext.set(snapshot.validationMonth, {
      windowId,
      featureMemoryId
    });

    await insertFeatureWriteback(db, {
      runId,
      windowId,
      featureMemoryId,
      bestActionId,
      payload: {
        windowType: 'monthly',
        periodKey: snapshot.validationMonth,
        learnedAction: snapshot.monthlyActionType
      }
    });

    if (snapshot.unknownReasonCode) {
      await insertUnknownFeatureEvent(db, {
        runId,
        windowId,
        featureMemoryId,
        reasonCode: snapshot.unknownReasonCode,
        fallbackActionType: snapshot.monthlyActionType,
        fallbackRiskMultiplier: snapshot.monthlyRiskCap,
        details: {
          periodKey: snapshot.validationMonth,
          poolStatus: snapshot.poolStatus,
          matchCount: snapshot.matches?.length ?? 0
        }
      });
    }
  }

  for (const snapshot of input.monthlySnapshots) {
    const targetContext = monthlyContext.get(snapshot.validationMonth);
    if (!targetContext || !Array.isArray(snapshot.matches) || snapshot.matches.length === 0) {
      continue;
    }

    let rankNo = 1;
    for (const match of snapshot.matches) {
      const matchedContext = monthlyContext.get(match.matchedPeriodKey);
      if (!matchedContext) {
        continue;
      }
      await insertFeatureMatch(db, {
        runId,
        targetFeatureMemoryId: targetContext.featureMemoryId,
        matchedFeatureMemoryId: matchedContext.featureMemoryId,
        rankNo,
        similarityScore: normalizeNumber(match.similarityScore, 0),
        confidenceScore: normalizeNumber(match.confidenceScore, 0),
        matchReason: {
          matchedPeriodKey: match.matchedPeriodKey,
          featureBucket: normalizeString(match.featureBucket),
          reusedStrategies: match.reusedStrategies ?? []
        },
        isReused: true
      });
      rankNo += 1;
    }
  }

  for (const sampleGroup of [
    { windowType: 'weekly', sourceType: 'aggregated', samples: input.weeklySamples },
    { windowType: 'daily', sourceType: 'opening-only', samples: input.dailySamples }
  ] as const) {
    for (const sample of sampleGroup.samples) {
      const windowId = await upsertMarketWindow(db, {
        symbol: input.symbol,
        intervalType: input.intervalType,
        windowType: sampleGroup.windowType,
        periodKey: sample.periodKey
      });
      const featureMemoryId = await upsertFeatureMemory(db, {
        windowId,
        symbol: input.symbol,
        feature: sample.feature,
        sourceType: sampleGroup.sourceType
      });
      const parameterSetId = sample.selectedStrategyName
        ? strategyRefs.get(sample.selectedStrategyName)?.parameterSetId ?? null
        : null;
      await upsertWindowBestAction(db, {
        runId,
        windowId,
        featureMemoryId,
        parameterSetId,
        actionType: sample.actionType,
        riskMultiplier: sample.riskValue,
        confidenceScore: Math.max(0, normalizeNumber(sample.feature.positiveStrategyRatio, 0) / 100),
        selectionSource: 'exploration',
        rationale: {
          periodKey: sample.periodKey,
          selectedStrategyName: sample.selectedStrategyName,
          avgPnl: sample.avgPnl,
          sourceWindowType: sampleGroup.windowType
        }
      });
    }
  }

  await upsertAnalysisArtifact(db, {
    runId,
    symbol: input.symbol,
    payload: {
      trainId: normalizeString(input.trainId),
      trainConfigKey: normalizeString(input.trainConfigKey),
      monthlyWindowCount: input.monthlySnapshots.length,
      weeklySampleCount: input.weeklySamples.length,
      dailySampleCount: input.dailySamples.length,
      routerRuleCount: input.routerRules.length,
      artifact: input.artifactPayload
    }
  });
}
