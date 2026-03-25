#!/usr/bin/env node

import {
  TABLES
} from '@money/database';
import type * as mysql from 'mysql2/promise';
import db from '../configs/database';

type Queryable = mysql.Pool | mysql.Connection | {
  readonly query: <T = unknown>(sql: string, params?: readonly unknown[]) => Promise<[T, unknown]>;
  readonly end?: () => Promise<void>;
};

interface ClearDbOptions {
  readonly includeKlines: boolean;
  readonly dryRun: boolean;
}

interface ClearPlan {
  readonly preservedTables: readonly string[];
  readonly targetTables: readonly string[];
  readonly missingKnownTables: readonly string[];
  readonly unknownTables: readonly string[];
}

const PRESERVED_BY_DEFAULT: readonly string[] = Object.freeze([
  TABLES.KLINES
]);

const KNOWN_CLEAR_ORDER: readonly string[] = Object.freeze([
  TABLES.FEATURE_CANDIDATE_POOL_ITEMS,
  TABLES.FEATURE_CANDIDATE_POOLS,
  TABLES.FEATURE_EMBEDDINGS,
  TABLES.FEATURE_MATCHES,
  TABLES.FEATURE_WRITEBACKS,
  TABLES.UNKNOWN_FEATURE_EVENTS,
  TABLES.WINDOW_BEST_ACTIONS,
  TABLES.WINDOW_STRATEGY_EVALUATIONS,
  TABLES.STRATEGY_LIBRARY_MEMBERS,
  TABLES.STRATEGY_PARAMETER_SETS,
  TABLES.STRATEGY_DEFINITIONS,
  TABLES.FEATURE_MEMORIES,
  TABLES.MARKET_WINDOWS,
  TABLES.TRAIN_RUNS,
  TABLES.ANALYSIS_ARTIFACTS,
  TABLES.TRAIN_ARTIFACTS,
  TABLES.TRAIN_GOAL_TRACKING,
  TABLES.TRAIN_RUN_REQUESTS,
  TABLES.ROLLING_RULE_DETAILS,
  TABLES.ROLLING_POOL_DETAILS,
  TABLES.ROUTER_CONFIG_DETAILS,
  TABLES.POLICY_CONFIG_DETAILS,
  TABLES.SNAPSHOT_CONFIG_DETAILS,
  TABLES.VALIDATION_CONFIG_DETAILS,
  TABLES.TRAINING_CONFIG_DETAILS,
  TABLES.GENERIC_CONFIG_DETAILS,
  TABLES.TRAIN_CONFIGS,
  TABLES.BACKTEST_RESULTS,
  TABLES.TRADES,
  TABLES.STRATEGIES,
  TABLES.TASKS
]);

function escapeIdentifier(value: string): string {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

async function queryDb<T = unknown>(
  queryable: Queryable,
  sql: string,
  params: readonly unknown[] = []
): Promise<[T, unknown]> {
  const query = (queryable as {
    readonly query: (statement: string, values?: readonly unknown[]) => Promise<[T, unknown]>;
  }).query;
  return query.call(queryable, sql, params);
}

function parseArgs(argv: readonly string[]): ClearDbOptions {
  const includeKlines = argv.includes('--include-klines');
  const dryRun = argv.includes('--dry-run');

  return {
    includeKlines,
    dryRun
  };
}

async function closeDbQuietly(queryable: Queryable): Promise<void> {
  try {
    if (typeof queryable.end === 'function') {
      await queryable.end();
    }
  } catch {
    // Ignore pool-close errors during shutdown.
  }
}

async function loadAllTables(queryable: Queryable): Promise<readonly string[]> {
  const [rows] = await queryDb<mysql.RowDataPacket[]>(queryable, 'SHOW TABLES');
  return rows
    .map((row: mysql.RowDataPacket) => {
      const firstValue = Object.values(row)[0];
      return String(firstValue || '').trim();
    })
    .filter(Boolean)
    .sort((left: string, right: string) => left.localeCompare(right));
}

export function buildClearPlan(existingTables: readonly string[], options: ClearDbOptions): ClearPlan {
  const preservedSet = new Set<string>(options.includeKlines ? [] : [...PRESERVED_BY_DEFAULT]);
  const existingSet = new Set<string>(existingTables);
  const orderedKnownTables = options.includeKlines
    ? [TABLES.KLINES, ...KNOWN_CLEAR_ORDER]
    : [...KNOWN_CLEAR_ORDER];
  const knownSet = new Set<string>([...PRESERVED_BY_DEFAULT, ...KNOWN_CLEAR_ORDER]);

  const preservedTables = existingTables.filter((tableName) => preservedSet.has(tableName));
  const targetTables = orderedKnownTables.filter((tableName) => existingSet.has(tableName) && !preservedSet.has(tableName));
  const missingKnownTables = KNOWN_CLEAR_ORDER.filter((tableName) => !existingSet.has(tableName) && !preservedSet.has(tableName));
  const unknownTables = existingTables.filter((tableName) => !knownSet.has(tableName) && !preservedSet.has(tableName));

  return {
    preservedTables,
    targetTables,
    missingKnownTables,
    unknownTables
  };
}

async function countRows(queryable: Queryable, tableName: string): Promise<number | null> {
  try {
    const [rows] = await queryDb<mysql.RowDataPacket[]>(
      queryable,
      `SELECT COUNT(*) AS row_count FROM ${escapeIdentifier(tableName)}`
    );
    return Number(rows[0]?.['row_count'] || 0);
  } catch {
    return null;
  }
}

function printPlan(plan: ClearPlan, options: ClearDbOptions): void {
  console.log('='.repeat(80));
  console.log(options.includeKlines ? '🧨 开始清理数据库（包含 klines）' : '🧹 开始清理数据库（保留 klines）');
  console.log('='.repeat(80));
  console.log('');

  console.log(`模式: ${options.dryRun ? 'dry-run' : 'execute'}`);
  console.log(`保留表: ${plan.preservedTables.length > 0 ? plan.preservedTables.join(', ') : '(无)'}`);
  console.log(`目标表数: ${plan.targetTables.length}`);

  if (plan.unknownTables.length > 0) {
    console.log(`未纳入清理白名单的表: ${plan.unknownTables.join(', ')}`);
  }

  if (plan.missingKnownTables.length > 0) {
    console.log(`当前库中不存在的已知表: ${plan.missingKnownTables.join(', ')}`);
  }

  console.log('');
}

export async function clearDatabase(queryable: Queryable, options: ClearDbOptions): Promise<void> {
  const allTables = await loadAllTables(queryable);
  const plan = buildClearPlan(allTables, options);

  printPlan(plan, options);

  if (!plan.targetTables.length) {
    console.log('没有需要清理的表。');
    return;
  }

  for (const tableName of plan.targetTables) {
    const rowCount = await countRows(queryable, tableName);
    const rowCountLabel = rowCount == null ? 'rows=?' : `rows=${rowCount.toLocaleString()}`;
    console.log(`${options.dryRun ? '📝' : '🗑️ '} ${options.dryRun ? 'would truncate' : 'truncate'} ${tableName} (${rowCountLabel})`);
  }

  if (options.dryRun) {
    console.log('');
    console.log('✅ dry-run 完成，未执行任何清理。');
    return;
  }

  console.log('');
  await queryDb(queryable, 'SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const tableName of plan.targetTables) {
      await queryDb(queryable, `TRUNCATE TABLE ${escapeIdentifier(tableName)}`);
    }
  } finally {
    await queryDb(queryable, 'SET FOREIGN_KEY_CHECKS = 1');
  }

  console.log('✅ 数据库清理完成。');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  try {
    await clearDatabase(db, options);
    await closeDbQuietly(db);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';
    console.error('\n❌ 数据库清理失败:', message);
    if (stack) {
      console.error(stack);
    }
    await closeDbQuietly(db);
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
