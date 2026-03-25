#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import type * as mysql from 'mysql2/promise';
import db from '../configs/database';
import { saveTrainArtifact } from '../services/train-artifact-store';
import { StrategyExecutor } from '../services/strategy-executor';
import { validateFeeModelConfig } from '../services/fee-model';
import { generateStrategyCombinations } from '../services/strategy-parameter-generator';
import {
  narrowBacktestResultToEvaluationRange,
  resolveEvaluationTimeRange,
  resolveExecutionTimeRange,
  type TimeRangeLike
} from '../services/validation-range';
import { resolveSymbolSpecFromSymbol } from '../services/simulator-core';
import type {
  Strategy,
  KlineData,
  ExecutorOptions,
  StrategyType,
  StrategyParameters,
  ParameterSpace,
  TimeRestriction,
  FeeModelConfig,
  BacktestResult
} from '../types';

interface CliArgs {
  readonly config: string;
  readonly strategyName?: string;
  readonly limit?: number;
  readonly outputDir?: string;
  readonly stressMultiplier: number;
  readonly commissionRate?: number;
}

interface ConfigFile {
  readonly trainId?: string;
  readonly trainingMeta?: {
    readonly trainId?: string;
  };
  readonly name: string;
  readonly description?: string;
  readonly timeRange: {
    readonly startTimeMs: number;
    readonly endTimeMs: number;
  };
  readonly market: {
    readonly symbol: string;
    readonly intervalType: string;
  };
  readonly strategy: {
    readonly types?: readonly StrategyType[];
    readonly parameters?: Partial<ParameterSpace> & {
      readonly tradingSchedule?: string;
      readonly tradingTimeRestriction?: TimeRestriction | null;
    };
    readonly explicitStrategies?: readonly {
      readonly name: string;
      readonly type: StrategyType;
      readonly parameters: StrategyParameters;
    }[];
  };
  readonly executor?: {
    readonly options?: ExecutorOptions & {
      readonly feeModel?: FeeModelConfig;
    };
  };
  readonly output?: {
    readonly topN?: number;
  };
  readonly validationTarget?: {
    readonly evaluationTimeRange?: TimeRangeLike;
    readonly executionTimeRange?: TimeRangeLike;
    readonly startTimeMs?: number;
    readonly endTimeMs?: number;
    readonly startIso?: string;
    readonly endIso?: string;
  };
}

interface StrategyScenarioStats {
  readonly scenario: string;
  readonly label: string;
  readonly totalPnl: number;
  readonly returnPct: number;
  readonly maxDrawdown: number;
  readonly profitFactor: number;
  readonly totalTrades: number;
  readonly totalCommission: number;
  readonly grossPnl: number;
}

interface StrategyScenarioResult {
  readonly strategyName: string;
  readonly strategyLabel: string;
  readonly scenarios: readonly StrategyScenarioStats[];
}

const TRAIN_ROOT = path.resolve(__dirname, '..', '..');

function parseArgs(argv: readonly string[]): CliArgs {
  const args = argv.slice(2);
  let config = '';
  let strategyName: string | undefined;
  let limit: number | undefined;
  let outputDir: string | undefined;
  let stressMultiplier = 2;
  let commissionRate: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg.startsWith('--config=')) {
      config = arg.slice('--config='.length);
      continue;
    }
    if (arg === '--config') {
      config = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--strategy=')) {
      strategyName = arg.slice('--strategy='.length);
      continue;
    }
    if (arg === '--strategy') {
      strategyName = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      limit = Number(arg.slice('--limit='.length));
      continue;
    }
    if (arg === '--limit') {
      limit = Number(args[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (arg.startsWith('--outputDir=')) {
      outputDir = arg.slice('--outputDir='.length);
      continue;
    }
    if (arg === '--outputDir') {
      outputDir = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--stressMultiplier=')) {
      stressMultiplier = Number(arg.slice('--stressMultiplier='.length));
      continue;
    }
    if (arg === '--stressMultiplier') {
      stressMultiplier = Number(args[index + 1] ?? '2');
      index += 1;
      continue;
    }
    if (arg.startsWith('--commissionRate=')) {
      commissionRate = Number(arg.slice('--commissionRate='.length));
      continue;
    }
    if (arg === '--commissionRate') {
      commissionRate = Number(args[index + 1] ?? '');
      index += 1;
    }
  }

  if (!config) {
    throw new Error('missing --config');
  }
  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error('limit must be > 0');
  }
  if (!Number.isFinite(stressMultiplier) || stressMultiplier < 1) {
    throw new Error('stressMultiplier must be >= 1');
  }
  if (commissionRate !== undefined && (!Number.isFinite(commissionRate) || commissionRate < 0)) {
    throw new Error('commissionRate must be >= 0');
  }

  return {
    config,
    ...(strategyName ? { strategyName } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(outputDir ? { outputDir } : {}),
    stressMultiplier,
    ...(commissionRate !== undefined ? { commissionRate } : {})
  };
}

function resolveConfigPath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(__dirname, '..', '..', filePath);
}

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function buildStrategyLabel(strategyName: string): string {
  const tokens = String(strategyName || '').split('-').filter(Boolean);
  if (tokens.length <= 6) {
    return strategyName;
  }

  return tokens.slice(-6).join('-');
}

async function loadKlines(config: ConfigFile): Promise<readonly KlineData[]> {
  const executionRange = resolveExecutionTimeRange(config);
  const [klines] = await db.query<mysql.RowDataPacket[]>(
    `SELECT
       id,
       open_time,
       CAST((bid_open + ask_open) / 2 AS CHAR) AS open,
       CAST((bid_high + ask_high) / 2 AS CHAR) AS high,
       CAST((bid_low + ask_low) / 2 AS CHAR) AS low,
       CAST((bid_close + ask_close) / 2 AS CHAR) AS close,
       CAST(bid_open AS CHAR) AS bid_open,
       CAST(bid_high AS CHAR) AS bid_high,
       CAST(bid_low AS CHAR) AS bid_low,
       CAST(bid_close AS CHAR) AS bid_close,
       CAST(ask_open AS CHAR) AS ask_open,
       CAST(ask_high AS CHAR) AS ask_high,
       CAST(ask_low AS CHAR) AS ask_low,
       CAST(ask_close AS CHAR) AS ask_close,
       CAST(volume AS CHAR) AS volume,
       symbol,
       interval_type
     FROM klines
     WHERE symbol = ?
       AND interval_type = ?
       AND open_time >= ?
       AND open_time <= ?
     ORDER BY open_time ASC`,
    [
      config.market.symbol,
      config.market.intervalType,
      executionRange.startTimeMs,
      executionRange.endTimeMs
    ]
  );

  if (!klines.length) {
    throw new Error('no klines found for requested config range');
  }

  return klines as KlineData[];
}

function selectStrategies(config: ConfigFile, args: CliArgs): readonly Strategy[] {
  if (config.strategy.explicitStrategies?.length) {
    const explicit = config.strategy.explicitStrategies.map((strategy, index) => ({
      id: index + 1,
      name: strategy.name,
      type: strategy.type,
      parameters: strategy.parameters
    }));

    if (args.strategyName) {
      const matched = explicit.find((strategy) => strategy.name === args.strategyName);
      if (!matched) {
        throw new Error(`strategy not found in explicitStrategies: ${args.strategyName}`);
      }
      return [matched];
    }

    return args.limit ? explicit.slice(0, args.limit) : explicit;
  }

  const generated = generateStrategyCombinations({
    types: config.strategy.types ?? null,
    parameters: config.strategy.parameters ?? null,
    limit: args.limit ?? null
  });

  if (args.strategyName) {
    const matched = generated.find((strategy) => strategy.name === args.strategyName);
    if (!matched) {
      throw new Error(`generated strategy not found: ${args.strategyName}`);
    }
    return [matched];
  }

  if (!args.limit && generated.length > 20) {
    throw new Error('generated strategy set is too large; please pass --limit or --strategy');
  }

  return generated;
}

function pickFeeModel(config: ConfigFile, overrideRate: number | undefined): FeeModelConfig {
  const existing = validateFeeModelConfig(config.executor?.options?.feeModel, 'config.executor.options.feeModel');
  if (overrideRate !== undefined) {
    return validateFeeModelConfig({
      ...existing,
      venueCode: existing?.venueCode ?? 'CUSTOM',
      commissionRate: overrideRate,
      basis: existing?.basis ?? 'notional',
      chargeOnEntry: existing?.chargeOnEntry,
      chargeOnExit: existing?.chargeOnExit
    }, 'config.executor.options.feeModel');
  }

  return validateFeeModelConfig({
    ...existing,
    venueCode: existing.venueCode,
    commissionRate: existing.commissionRate,
    basis: existing.basis ?? 'notional',
    chargeOnEntry: existing.chargeOnEntry,
    chargeOnExit: existing.chargeOnExit
  }, 'config.executor.options.feeModel');
}

function buildScenarioOptions(baseOptions: ExecutorOptions, feeModel: FeeModelConfig, stressMultiplier: number) {
  return [
    {
      name: 'no_cost',
      label: 'No Cost',
      options: {
        ...baseOptions,
        enableSlippage: false
      }
    },
    {
      name: 'base_fee',
      label: 'Base Fee',
      options: {
        ...baseOptions,
        enableSlippage: false,
        feeModel
      }
    },
    {
      name: 'fee_base_slippage',
      label: 'Fee + Base Slippage',
      options: {
        ...baseOptions,
        enableSlippage: true,
        feeModel,
        slippageConfig: {
          normalSlippage: 0.3,
          tokyoSlippage: 10.0,
          highVolatilitySlippage: 10.0,
          volatilityThreshold: 0.5,
          exitMultiplier: 1.2
        }
      }
    },
    {
      name: 'fee_extreme_slippage',
      label: 'Fee + Extreme Slippage',
      options: {
        ...baseOptions,
        enableSlippage: true,
        feeModel,
        slippageConfig: {
          normalSlippage: round(0.3 * stressMultiplier, 4),
          tokyoSlippage: round(10.0 * stressMultiplier, 4),
          highVolatilitySlippage: round(10.0 * stressMultiplier, 4),
          volatilityThreshold: 0.5,
          exitMultiplier: round(1.2 * stressMultiplier, 4)
        }
      }
    }
  ] as const;
}

function toScenarioStats(name: string, label: string, result: BacktestResult): StrategyScenarioStats {
  return {
    scenario: name,
    label,
    totalPnl: round(result.stats.totalPnl),
    returnPct: round(result.stats.returnPct ?? 0, 4),
    maxDrawdown: round(result.stats.maxDrawdown),
    profitFactor: round(result.stats.profitFactor, 4),
    totalTrades: result.stats.totalTrades,
    totalCommission: round(result.stats.totalCommission ?? 0, 4),
    grossPnl: round(result.stats.grossPnl ?? result.stats.totalPnl)
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const resolvedConfigPath = resolveConfigPath(args.config);
  const config = loadJson<ConfigFile>(resolvedConfigPath);
  const strategies = selectStrategies(config, args);
  const klines = await loadKlines(config);
  const evaluationRange = resolveEvaluationTimeRange(config);
  const feeModel = pickFeeModel(config, args.commissionRate);
  const scenarioDefs = buildScenarioOptions(config.executor?.options ?? {}, feeModel, args.stressMultiplier);
  const symbolSpec = resolveSymbolSpecFromSymbol(config.market.symbol, config.executor?.options?.symbolSpec);

  const scenarioResults: StrategyScenarioResult[] = [];
  for (const strategy of strategies) {
    console.log(`\n[cost-sensitivity] strategy: ${strategy.name}`);
    const scenarios: StrategyScenarioStats[] = [];

    for (const scenario of scenarioDefs) {
      console.log(`  - scenario: ${scenario.label}`);
      const executor = new StrategyExecutor(strategy, klines, scenario.options);
      const rawResult = await executor.execute();
      const result = narrowBacktestResultToEvaluationRange(rawResult, evaluationRange, symbolSpec.initialCapital);
      scenarios.push(toScenarioStats(scenario.name, scenario.label, result));
    }

    scenarioResults.push({
      strategyName: strategy.name,
      strategyLabel: buildStrategyLabel(strategy.name),
      scenarios
    });
  }

  const baseName = path.basename(resolvedConfigPath, path.extname(resolvedConfigPath));
  const suffix = args.strategyName ? `_${args.strategyName.replace(/[^A-Za-z0-9_-]/g, '_')}` : '';
  const payload = {
    generatedAt: new Date().toISOString(),
    trainId: String(config.trainId || config.trainingMeta?.trainId || '').trim() || null,
    configPath: resolvedConfigPath,
    configName: config.name,
    symbol: config.market.symbol,
    intervalType: config.market.intervalType,
    period: evaluationRange,
    stressMultiplier: args.stressMultiplier,
    rollingPoolTopN: Number(config.output?.topN || 0) || null,
    strategyCount: strategies.length,
    scenarioResults
  };

  await saveTrainArtifact(db, {
    artifactKey: `cost-sensitivity:${baseName}${suffix}`,
    artifactType: 'cost-sensitivity',
    trainId: String(config.trainId || config.trainingMeta?.trainId || '').trim() || null,
    configKey: resolvedConfigPath.includes('/configs/')
      ? toPosix(path.relative(TRAIN_ROOT, resolvedConfigPath))
      : null,
    symbol: config.market.symbol,
    intervalType: config.market.intervalType,
    periodStartMs: Number(evaluationRange.startTimeMs),
    periodEndMs: Number(evaluationRange.endTimeMs),
    payload,
    metadata: {
      strategyCount: strategies.length,
      stressMultiplier: args.stressMultiplier
    }
  });

  console.log(`Cost sensitivity artifact saved: cost-sensitivity:${baseName}${suffix}`);
  console.log('Structured output is stored in DB; keep files only for AI summary markdown.');
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
