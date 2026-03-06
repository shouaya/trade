#!/usr/bin/env node

/**
 * 长跑训练回归测试
 *
 * 用法:
 *   node dist/scripts/training-regression.js <snapshot-json>
 *   node dist/scripts/training-regression.js <snapshot-json> --update
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type * as mysql from 'mysql2/promise';
import db from '../configs/database';

interface RegressionSnapshot {
  readonly caseName: string;
  readonly configPath: string;
  readonly topN: number;
  readonly expectedStrategies: readonly RegressionStrategy[];
}

interface RegressionStrategy {
  readonly rank: number;
  readonly strategyName: string;
  readonly strategyType: string;
  readonly performance: {
    readonly totalTrades: number;
    readonly winRate: number;
    readonly totalPnl: number;
    readonly avgPnl: number;
    readonly sharpeRatio: number;
    readonly profitFactor: number;
    readonly maxDrawdown: number;
    readonly score: number;
  };
  readonly parameters: {
    readonly rsi: {
      readonly period: number;
      readonly oversold?: number;
      readonly overbought?: number;
    };
    readonly risk: {
      readonly maxPositions: number;
      readonly lotSize: number;
      readonly maxHoldMinutes: number | null;
    };
    readonly atr?: {
      readonly slMultiplier: number;
      readonly tpMultiplier: number;
    };
    readonly tradingSchedule?: string;
    readonly tradingTimeRestriction?: {
      readonly enabled: boolean;
      readonly utcExcludeStart?: string;
      readonly utcExcludeEnd?: string;
    } | null;
  };
  readonly executor: {
    readonly version: string;
    readonly options: Record<string, unknown>;
  };
}

function resolveProjectPath(relativeOrAbsolutePath: string): string {
  return path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.resolve(__dirname, '..', '..', relativeOrAbsolutePath);
}

function parseArgs(argv: readonly string[]): { readonly snapshotPath: string; readonly update: boolean } {
  const args = argv.slice(2);
  const snapshotPath = args.find(arg => !arg.startsWith('--'));

  if (!snapshotPath) {
    throw new Error('usage: node dist/scripts/training-regression.js <snapshot-json> [--update]');
  }

  return {
    snapshotPath,
    update: args.includes('--update')
  };
}

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function roundNumber(value: unknown, digits: number): number {
  return Number(Number(value).toFixed(digits));
}

function normalizeParameters(raw: unknown): RegressionStrategy['parameters'] {
  const parameters = typeof raw === 'string'
    ? JSON.parse(raw) as Record<string, any>
    : raw as Record<string, any>;

  return {
    rsi: {
      period: Number(parameters['rsi']?.['period']),
      ...(parameters['rsi']?.['oversold'] !== undefined ? { oversold: Number(parameters['rsi']['oversold']) } : {}),
      ...(parameters['rsi']?.['overbought'] !== undefined ? { overbought: Number(parameters['rsi']['overbought']) } : {})
    },
    risk: {
      maxPositions: Number(parameters['risk']?.['maxPositions']),
      lotSize: Number(parameters['risk']?.['lotSize']),
      maxHoldMinutes: parameters['risk']?.['maxHoldMinutes'] === null
        ? null
        : Number(parameters['risk']?.['maxHoldMinutes'])
    },
    ...(parameters['atr'] ? {
      atr: {
        slMultiplier: Number(parameters['atr']['slMultiplier']),
        tpMultiplier: Number(parameters['atr']['tpMultiplier'])
      }
    } : {}),
    ...(parameters['tradingSchedule'] ? {
      tradingSchedule: String(parameters['tradingSchedule'])
    } : {}),
    ...(parameters['tradingTimeRestriction'] !== undefined ? {
      tradingTimeRestriction: parameters['tradingTimeRestriction']
        ? {
            enabled: Boolean(parameters['tradingTimeRestriction']['enabled']),
            ...(parameters['tradingTimeRestriction']['utcExcludeStart'] ? {
              utcExcludeStart: String(parameters['tradingTimeRestriction']['utcExcludeStart'])
            } : {}),
            ...(parameters['tradingTimeRestriction']['utcExcludeEnd'] ? {
              utcExcludeEnd: String(parameters['tradingTimeRestriction']['utcExcludeEnd'])
            } : {})
          }
        : null
    } : {})
  };
}

function normalizeStrategyRow(row: Record<string, unknown>, rank: number): RegressionStrategy {
  const executorOptions = typeof row['executor_options'] === 'string'
    ? JSON.parse(String(row['executor_options'])) as Record<string, unknown>
    : row['executor_options'] as Record<string, unknown>;

  return {
    rank,
    strategyName: String(row['strategy_name']),
    strategyType: String(row['strategy_type']),
    performance: {
      totalTrades: Number(row['total_trades']),
      winRate: roundNumber(row['win_rate'], 4),
      totalPnl: roundNumber(row['total_pnl'], 2),
      avgPnl: roundNumber(row['avg_pnl'], 2),
      sharpeRatio: roundNumber(row['sharpe_ratio'], 4),
      profitFactor: roundNumber(row['profit_factor'], 4),
      maxDrawdown: roundNumber(row['max_drawdown'], 4),
      score: roundNumber(row['score'], 4)
    },
    parameters: normalizeParameters(row['parameters']),
    executor: {
      version: String(row['executor_version']),
      options: executorOptions
    }
  };
}

async function loadActualStrategies(tableName: string, topN: number): Promise<readonly RegressionStrategy[]> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT
      strategy_name,
      strategy_type,
      total_trades,
      win_rate,
      total_pnl,
      avg_pnl,
      sharpe_ratio,
      profit_factor,
      max_drawdown,
      score,
      parameters,
      executor_version,
      executor_options
     FROM ${tableName}
     WHERE total_trades > 0
     ORDER BY total_pnl DESC, score DESC, strategy_name ASC
     LIMIT ?`,
    [topN]
  );

  return rows.map((row, index) => normalizeStrategyRow(row as unknown as Record<string, unknown>, index + 1));
}

function createRegressionConfig(snapshot: RegressionSnapshot, snapshotFullPath: string): { readonly tempConfigPath: string; readonly tempTableName: string } {
  const sourceConfigPath = resolveProjectPath(snapshot.configPath);
  const sourceConfig = loadJson<Record<string, any>>(sourceConfigPath);
  const tempTableName = `${String(sourceConfig['database']?.['tableName'])}_regression_snapshot`;
  const tempConfig = {
    ...sourceConfig,
    database: {
      ...sourceConfig['database'],
      tableName: tempTableName,
      resetTableBeforeRun: true
    },
    output: {
      ...sourceConfig['output'],
      topN: snapshot.topN,
      strategyNamePrefix: `REGRESSION_${snapshot.caseName}_`,
      descriptionPrefix: `Regression ${snapshot.caseName}`,
      persistTopStrategies: false,
      persistTrades: false
    }
  };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trade-train-regression-'));
  const tempConfigPath = path.join(tempDir, path.basename(snapshotFullPath).replace('.json', '.runtime.json'));
  fs.writeFileSync(tempConfigPath, JSON.stringify(tempConfig, null, 2) + '\n', 'utf8');

  return { tempConfigPath, tempTableName };
}

function runNodeScript(scriptName: string, args: readonly string[] = []): void {
  const scriptPath = path.resolve(__dirname, scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    throw new Error(`${scriptName} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

async function cleanupArtifacts(tempConfigPath: string, tempTableName: string): Promise<void> {
  try {
    await db.query(`DROP TABLE IF EXISTS ${tempTableName}`);
  } finally {
    const tempDir = path.dirname(tempConfigPath);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { snapshotPath, update } = parseArgs(process.argv);
  const snapshotFullPath = resolveProjectPath(snapshotPath);
  const snapshot = loadJson<RegressionSnapshot>(snapshotFullPath);
  const { tempConfigPath, tempTableName } = createRegressionConfig(snapshot, snapshotFullPath);

  try {
    runNodeScript('init-db.js');
    runNodeScript('train.js', [tempConfigPath]);

    const actualSnapshot: RegressionSnapshot = {
      caseName: snapshot.caseName,
      configPath: snapshot.configPath,
      topN: snapshot.topN,
      expectedStrategies: await loadActualStrategies(tempTableName, snapshot.topN)
    };

    if (update) {
      fs.writeFileSync(snapshotFullPath, JSON.stringify(actualSnapshot, null, 2) + '\n', 'utf8');
      console.log(`\n✅ 回归快照已更新: ${snapshotFullPath}`);
      return;
    }

    assert.deepStrictEqual(actualSnapshot, snapshot);
    console.log(`\n✅ 训练回归通过: ${snapshot.caseName}`);
  } finally {
    await cleanupArtifacts(tempConfigPath, tempTableName);
    await db.end();
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : '';
  console.error(`\n❌ 训练回归失败: ${message}`);
  if (stack) {
    console.error(stack);
  }
  process.exit(1);
});
