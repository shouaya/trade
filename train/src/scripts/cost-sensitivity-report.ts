#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import type * as mysql from 'mysql2/promise';
import db from '../configs/database';
import { StrategyExecutor } from '../services/strategy-executor';
import { validateFeeModelConfig } from '../services/fee-model';
import { generateStrategyCombinations } from '../services/strategy-parameter-generator';
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

const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '../../reports/cost-sensitivity');

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

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

async function loadKlines(config: ConfigFile): Promise<readonly KlineData[]> {
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
      config.timeRange.startTimeMs,
      config.timeRange.endTimeMs
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

function buildMarkdown(
  configPath: string,
  config: ConfigFile,
  strategies: readonly Strategy[],
  scenarioResults: readonly StrategyScenarioResult[],
  stressMultiplier: number
): string {
  const lines: string[] = [];
  lines.push(`# ${config.market.symbol} Cost Sensitivity Report`);
  lines.push('');
  lines.push(`- Config: \`${configPath}\``);
  lines.push(`- Validation / training name: \`${config.name}\``);
  lines.push(`- Period: \`${new Date(config.timeRange.startTimeMs).toISOString()}\` -> \`${new Date(config.timeRange.endTimeMs).toISOString()}\``);
  lines.push(`- Strategies tested: \`${strategies.length}\``);
  lines.push(`- Stress multiplier: \`${stressMultiplier}\``);
  const feeModel = validateFeeModelConfig(config.executor?.options?.feeModel, 'config.executor.options.feeModel');
  lines.push(`- Fee venue: \`${feeModel.venueCode}\``);
  lines.push(`- Product: \`${feeModel.market ?? 'unknown'}\`${feeModel.productCode ? ` / \`${feeModel.productCode}\`` : ''}`);
  lines.push(`- Commission rate: \`${feeModel.commissionRate}\``);
  if (feeModel.dailyLeverageRate !== undefined) {
    lines.push(`- Daily leverage rate metadata: \`${feeModel.dailyLeverageRate}\``);
  }
  if (feeModel.liquidationFeeRate !== undefined) {
    lines.push(`- Liquidation fee metadata: \`${feeModel.liquidationFeeRate}\``);
  }
  lines.push('');
  lines.push('## Scenario Definitions');
  lines.push('');
  lines.push('- `No Cost`: fee off, slippage off');
  lines.push('- `Base Fee`: fee on, slippage off');
  lines.push('- `Fee + Base Slippage`: fee on, default slippage model');
  lines.push('- `Fee + Extreme Slippage`: fee on, stressed slippage model');
  lines.push('');
  lines.push('## Strategy Summary');
  lines.push('');
  lines.push('| Strategy | No Cost PnL | Base Fee PnL | Fee+Base Slip PnL | Fee+Extreme Slip PnL | Drag vs No Cost | Extreme DD |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');

  for (const result of scenarioResults) {
    const map = new Map(result.scenarios.map((row) => [row.scenario, row] as const));
    const noCost = map.get('no_cost');
    const extreme = map.get('fee_extreme_slippage');
    const baseSlip = map.get('fee_base_slippage');
    const feeOnly = map.get('base_fee');
    const drag = noCost && extreme ? round(noCost.totalPnl - extreme.totalPnl) : 0;
    lines.push(`| ${result.strategyLabel} | ${noCost?.totalPnl ?? 0} | ${feeOnly?.totalPnl ?? 0} | ${baseSlip?.totalPnl ?? 0} | ${extreme?.totalPnl ?? 0} | ${drag} | ${extreme?.maxDrawdown ?? 0} |`);
  }

  for (const result of scenarioResults) {
    lines.push('');
    lines.push(`## ${result.strategyLabel}`);
    lines.push('');
    lines.push('| Scenario | Total PnL | Return % | Max DD | Profit Factor | Trades | Commission | Gross PnL |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const row of result.scenarios) {
      lines.push(`| ${row.label} | ${row.totalPnl} | ${row.returnPct} | ${row.maxDrawdown} | ${row.profitFactor} | ${row.totalTrades} | ${row.totalCommission} | ${row.grossPnl} |`);
    }
  }

  lines.push('');
  lines.push('## Reading Guide');
  lines.push('');
  lines.push('- If `Fee + Base Slippage` already flips the strategy negative, the raw edge is probably too thin.');
  lines.push('- If `Fee + Extreme Slippage` sharply increases drawdown, execution fragility is high.');
  lines.push('- If only `No Cost` looks attractive, the result should not be treated as deployable evidence.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const resolvedConfigPath = resolveConfigPath(args.config);
  const config = loadJson<ConfigFile>(resolvedConfigPath);
  const strategies = selectStrategies(config, args);
  const klines = await loadKlines(config);
  const feeModel = pickFeeModel(config, args.commissionRate);
  const scenarioDefs = buildScenarioOptions(config.executor?.options ?? {}, feeModel, args.stressMultiplier);

  const scenarioResults: StrategyScenarioResult[] = [];
  for (const strategy of strategies) {
    console.log(`\n[cost-sensitivity] strategy: ${strategy.name}`);
    const scenarios: StrategyScenarioStats[] = [];

    for (const scenario of scenarioDefs) {
      console.log(`  - scenario: ${scenario.label}`);
      const executor = new StrategyExecutor(strategy, klines, scenario.options);
      const result = await executor.execute();
      scenarios.push(toScenarioStats(scenario.name, scenario.label, result));
    }

    scenarioResults.push({
      strategyName: strategy.name,
      strategyLabel: strategy.name.replace(/^.*-/, ''),
      scenarios
    });
  }

  const baseName = path.basename(resolvedConfigPath, path.extname(resolvedConfigPath));
  const suffix = args.strategyName ? `_${args.strategyName.replace(/[^A-Za-z0-9_-]/g, '_')}` : '';
  const outputDir = args.outputDir ? path.resolve(args.outputDir) : DEFAULT_OUTPUT_DIR;
  ensureDir(outputDir);
  const jsonPath = path.join(outputDir, `${baseName}${suffix}.json`);
  const mdPath = path.join(outputDir, `${baseName}${suffix}.md`);

  const payload = {
    generatedAt: new Date().toISOString(),
    trainId: String(config.trainId || config.trainingMeta?.trainId || '').trim() || null,
    configPath: resolvedConfigPath,
    configName: config.name,
    symbol: config.market.symbol,
    intervalType: config.market.intervalType,
    period: config.timeRange,
    stressMultiplier: args.stressMultiplier,
    strategyCount: strategies.length,
    scenarioResults
  };

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.writeFileSync(mdPath, buildMarkdown(resolvedConfigPath, config, strategies, scenarioResults, args.stressMultiplier), 'utf8');

  console.log(`Cost sensitivity JSON written: ${jsonPath}`);
  console.log(`Cost sensitivity report written: ${mdPath}`);
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
