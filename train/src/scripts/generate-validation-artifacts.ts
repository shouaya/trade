#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as mysql from 'mysql2/promise';
import {
  BACKTEST_RESULTS_TABLE,
  createMysqlConnectionWithFallback,
} from '@money/database';
import {
  buildRollingArtifactPackage,
  type RollingKlineRow,
  type RollingStrategyResultRow,
  type RollingTradeRow,
} from '../services/rolling-artifact-builder';
import { loadTrainEnv } from '../utils/train-env';

loadTrainEnv(dotenv);

interface Args {
  readonly trainConfig: string;
  readonly trainConfigRef: string | undefined;
  readonly symbol: string;
  readonly sourceTable: string;
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

export interface GeneratedArtifactItem {
  readonly configKey: string;
  readonly configType: string;
  readonly content: JsonObject;
}

export interface GeneratedArtifactsResult {
  readonly validationConfigs: readonly GeneratedArtifactItem[];
  readonly snapshot: GeneratedArtifactItem;
}

type JsonObject = any;

function parseArgs(argv: readonly string[]): Args {
  const parsed: any = {};
  for (const arg of argv.slice(2)) {
    const index = arg.indexOf('=');
    if (index === -1) continue;
    parsed[arg.slice(0, index).replace(/^--/, '')] = arg.slice(index + 1);
  }

  const limit = Number(parsed.limit || '10');
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`invalid --limit=${parsed.limit}`);
  }

  return {
    trainConfig: required(parsed.trainConfig, 'trainConfig'),
    trainConfigRef: parsed.trainConfigRef,
    symbol: required(parsed.symbol, 'symbol').toUpperCase(),
    sourceTable: required(parsed.sourceTable, 'sourceTable'),
    outPrefix: required(parsed.outPrefix, 'outPrefix'),
    strategyPrefix: required(parsed.strategyPrefix, 'strategyPrefix'),
    descriptionPrefix: required(parsed.descriptionPrefix, 'descriptionPrefix'),
    limit,
    exact: String(parsed.exact || 'false').toLowerCase() === 'true',
    profile: normalizeValidationProfile(parsed.profile || 'rolling-window'),
    outputMode: String(parsed.outputMode || 'files').trim().toLowerCase() === 'json' ? 'json' : 'files'
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

function formatIsoDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function formatCompactDate(value: number): string {
  return formatIsoDate(value).replace(/-/g, '_');
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
  const digest = crypto
    .createHash('md5')
    .update(`${outPrefix}:${symbol}:${token}:${limit}`)
    .digest('hex')
    .slice(0, 8);

  return `backtest_results_top${limit}_${symbol.toLowerCase()}_${token}_${digest}`;
}

function buildSnapshotFileName(outPrefix: string, limit: number): string {
  return outPrefix.endsWith(`top${limit}`)
    ? `${outPrefix}.generated.json`
    : `${outPrefix}_top${limit}.generated.json`;
}

function buildValidationDefinitions(trainConfig: JsonObject, profile: string, customRange: JsonObject): readonly JsonObject[] {
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
    return [{
      suffix: `custom_${formatCompactDate(startMs)}_to_${formatCompactDate(endMs)}_validation`,
      label: `custom ${formatIsoDate(startMs)} -> ${formatIsoDate(endMs)}`,
      shortLabel: 'custom-range',
      tableToken: `custom_${formatCompactDate(startMs)}_${formatCompactDate(endMs)}`,
      descriptionLabel: `自定义验证 ${formatIsoDate(startMs)} -> ${formatIsoDate(endMs)}`,
      timeRange: buildTimeRange(startMs, endMs)
    }];
  }

  const rollingStartMs = toUtcStartOfDay(trainingStartSource);
  const rollingEndMs = toUtcEndOfDay(trainingEndSource);
  const definitions: JsonObject[] = [];
  let cursorMs = toUtcStartOfMonth(rollingStartMs);

  while (cursorMs <= rollingEndMs) {
    const cursorDate = new Date(cursorMs);
    const monthToken = `${cursorDate.getUTCFullYear()}_${String(cursorDate.getUTCMonth() + 1).padStart(2, '0')}`;
    const segmentStartMs = Math.max(rollingStartMs, cursorMs);
    const segmentEndMs = Math.min(rollingEndMs, toUtcEndOfMonth(cursorMs));
    if (segmentStartMs <= segmentEndMs) {
      definitions.push({
        suffix: `rolling_${monthToken}_validation`,
        label: `rolling ${formatIsoDate(segmentStartMs)} -> ${formatIsoDate(segmentEndMs)}`,
        shortLabel: 'rolling-window',
        tableToken: `rolling_${monthToken}`,
        descriptionLabel: `训练期 Rolling 验证 ${formatIsoDate(segmentStartMs)} -> ${formatIsoDate(segmentEndMs)}`,
        timeRange: buildTimeRange(segmentStartMs, segmentEndMs)
      });
    }
    cursorMs = Date.UTC(cursorDate.getUTCFullYear(), cursorDate.getUTCMonth() + 1, 1, 0, 0, 0);
  }

  if (!definitions.length) {
    throw new Error('rolling validation window is empty');
  }

  return definitions;
}

async function findLatestRunId(connection: mysql.Connection, resultGroup: string): Promise<string | null> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT run_id
     FROM ${BACKTEST_RESULTS_TABLE}
     WHERE result_group = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [resultGroup]
  );

  return rows[0]?.['run_id'] ? String(rows[0]?.['run_id']) : null;
}

async function loadStrategyRows(connection: mysql.Connection, resultGroup: string, runId: string): Promise<readonly RollingStrategyResultRow[]> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT strategy_name, strategy_type, total_trades, win_rate, total_pnl, score, parameters
     FROM ${BACKTEST_RESULTS_TABLE}
     WHERE result_group = ?
       AND run_id = ?
       AND total_trades > 0
     ORDER BY score DESC, return_pct DESC, total_pnl DESC, strategy_name ASC`,
    [resultGroup, runId]
  );
  return rows as unknown as readonly RollingStrategyResultRow[];
}

async function loadTrainingTrades(
  connection: mysql.Connection,
  trainId: string,
  symbol: string,
  startTimeMs: number,
  endTimeMs: number
): Promise<readonly RollingTradeRow[]> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT strategy_name, exit_time, pnl
     FROM trades
     WHERE train_id = ?
       AND symbol = ?
       AND exit_time BETWEEN ? AND ?
     ORDER BY exit_time ASC, strategy_name ASC`,
    [trainId, symbol, startTimeMs, endTimeMs]
  );
  return rows as unknown as readonly RollingTradeRow[];
}

async function loadKlines(
  connection: mysql.Connection,
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
            ask_open, ask_high, ask_low, ask_close
     FROM klines
     WHERE symbol = ?
       AND interval_type IN (?, '1m', '1min')
       AND open_time BETWEEN ? AND ?
     ORDER BY open_time ASC`,
    [symbol, intervalType, startTimeMs, endTimeMs]
  );
  return rows as unknown as readonly RollingKlineRow[];
}

function buildArtifacts(args: Args, trainConfig: JsonObject, rollingPackage: ReturnType<typeof buildRollingArtifactPackage>, sourceRunId: string) {
  const trainId = String(trainConfig.trainId || trainConfig.trainingMeta?.trainId || '').trim();
  const trainConfigRef = resolveTrainConfigRef(args.trainConfig, args.trainConfigRef);
  const trainingYear = getYearFromConfig(trainConfig, path.basename(args.trainConfig)) || 'run';
  const validationDefinitions = buildValidationDefinitions(
    trainConfig,
    args.profile,
    trainConfig.validationPlan?.customRange && typeof trainConfig.validationPlan.customRange === 'object'
      ? trainConfig.validationPlan.customRange
      : {}
  );

  const validationConfigs = validationDefinitions.map((definition) => ({
    configKey: `configs/validation/${args.outPrefix}_${definition.suffix}.json`,
    configType: 'validation',
    content: {
      ...(trainId ? { trainId } : {}),
      name: `${args.symbol}_ROLLING_${String(definition.shortLabel).toUpperCase().replace(/-/g, '_')}_FROM_${trainingYear}_VALIDATION`,
      description: `${args.symbol} ${definition.descriptionLabel} - 基于 ${trainingYear} rolling candidate pool / mapping`,
      timeRange: definition.timeRange,
      market: {
        symbol: args.symbol,
        intervalType: trainConfig.market.intervalType
      },
      database: {
        tableName: args.exact
          ? buildExactValidationTableName(args.symbol, String(definition.tableToken), args.limit, `${args.outPrefix}_${definition.suffix}`)
          : buildValidationTableName(args.symbol, String(definition.tableToken)),
        resetTableBeforeRun: true
      },
      strategy: {
        explicitStrategies: rollingPackage.explicitStrategies
      },
      featureEngineering: trainConfig.featureEngineering,
      executor: trainConfig.executor,
      output: {
        topN: args.limit,
        strategyNamePrefix: `${args.strategyPrefix}${String(definition.shortLabel).toUpperCase()}-`,
        descriptionPrefix: `${args.descriptionPrefix} ${definition.descriptionLabel}`
      },
      sourceTable: args.sourceTable,
      trainConfig: trainConfigRef,
      trainingMeta: trainId
        ? {
            trainId
          }
        : undefined,
      validationProfile: args.profile,
      validationTarget: {
        label: definition.label,
        cutoffDate: String(definition.timeRange.endIso).slice(0, 10),
        startIso: definition.timeRange.startIso,
        endIso: definition.timeRange.endIso
      }
    }
  }));

  const snapshotConfigKey = `configs/top-strategies/${buildSnapshotFileName(args.outPrefix, args.limit)}`;
  const snapshotContent = {
    ...(trainId ? { trainId } : {}),
    artifactType: 'rolling-strategy-package',
    name: `${args.symbol}_ROLLING_PACKAGE_FROM_${trainingYear}`,
    description: `${args.symbol} rolling candidate pools + month/week/day mapping - 基于 ${trainingYear} training`,
    generatedAt: new Date().toISOString(),
    sourceTable: args.sourceTable,
    sourcePhysicalTable: BACKTEST_RESULTS_TABLE,
    sourceRunId,
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
      explicitStrategies: rollingPackage.explicitStrategies
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
      resultGroup: args.sourceTable
    },
    validationTargets: validationDefinitions.map((definition) => ({
      label: definition.label,
      startIso: definition.timeRange.startIso,
      endIso: definition.timeRange.endIso
    })),
    validationProfile: args.profile,
    strategies: rollingPackage.explicitStrategies.map((strategy, index) => ({
      rank: index + 1,
      strategyName: strategy.name,
      strategyType: strategy.type,
      parameters: strategy.parameters
    })),
    rollingPlan: {
      monthlyPools: rollingPackage.monthlyPools,
      rules: {
        monthlyGuard: rollingPackage.monthlyRules,
        weeklyGuard: rollingPackage.weeklyRules,
        dailyRouter: rollingPackage.dailyRules,
        lossRecheck: rollingPackage.lossRules
      }
    },
    rollingRouter: {
      strategyCatalog: rollingPackage.strategyCatalog,
      defaultStrategyKey: rollingPackage.defaultStrategyKey,
      rules: rollingPackage.routerRules
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
    const sourceRunId = await findLatestRunId(connection, args.sourceTable);
    if (!sourceRunId) {
      throw new Error(`no run found in logical result group ${args.sourceTable}`);
    }

    const strategyRows = await loadStrategyRows(connection, args.sourceTable, sourceRunId);
    if (!strategyRows.length) {
      throw new Error(`no strategy rows found in logical result group ${args.sourceTable}`);
    }

    const trainId = String(trainConfig.trainId || trainConfig.trainingMeta?.trainId || '').trim();
    if (!trainId) {
      throw new Error('trainId is required for rolling artifact generation');
    }

    const startTimeMs = Number(trainConfig.timeRange?.startTimeMs);
    const endTimeMs = Number(trainConfig.timeRange?.endTimeMs);
    const intervalType = String(trainConfig.market?.intervalType || '1min');
    const [trades, klines] = await Promise.all([
      loadTrainingTrades(connection, trainId, args.symbol, startTimeMs, endTimeMs),
      loadKlines(connection, args.symbol, intervalType, startTimeMs, endTimeMs)
    ]);

    if (!trades.length) {
      throw new Error(`no training trades found for train_id=${trainId}`);
    }
    if (!klines.length) {
      throw new Error(`no klines found for symbol=${args.symbol} interval=${intervalType}`);
    }

    const rollingPackage = buildRollingArtifactPackage({
      topN: args.limit,
      strategyRows,
      trades,
      klines,
      featureEngineering: trainConfig.featureEngineering
    });
    const artifacts = buildArtifacts(args, trainConfig, rollingPackage, sourceRunId) as GeneratedArtifactsResult;

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
