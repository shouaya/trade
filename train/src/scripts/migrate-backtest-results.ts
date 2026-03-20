#!/usr/bin/env node

import db from '../configs/database';
import type * as mysql from 'mysql2/promise';

const BACKTEST_RESULTS_TABLE = 'backtest_results';

interface LegacyTableRow extends mysql.RowDataPacket {
  readonly table_name: string;
}

interface CountRow extends mysql.RowDataPacket {
  readonly count: number;
}

function inferMode(tableName: string): 'training' | 'validation' {
  return tableName.includes('validate') || tableName.includes('validation') ? 'validation' : 'training';
}

function inferSymbol(tableName: string): string | null {
  const upper = tableName.toUpperCase();
  if (upper.includes('BTCJPY')) return 'BTCJPY';
  if (upper.includes('ETHJPY')) return 'ETHJPY';
  if (upper.includes('SOLJPY')) return 'SOLJPY';
  if (upper.includes('USDJPY')) return 'USDJPY';
  return null;
}

async function listLegacyTables(): Promise<readonly string[]> {
  const [rows] = await db.query<LegacyTableRow[]>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name LIKE 'backtest_results\\_%'
       AND table_name <> ?`,
    [BACKTEST_RESULTS_TABLE]
  );

  return rows
    .map((row) => String(row.table_name))
    .sort((left, right) => left.localeCompare(right));
}

async function migrateTable(tableName: string): Promise<void> {
  const resultGroup = tableName;
  const runId = `legacy_${tableName}`;
  const mode = inferMode(tableName);
  const symbol = inferSymbol(tableName);

  const [existingRows] = await db.query<CountRow[]>(
    `SELECT COUNT(*) AS count
     FROM ${BACKTEST_RESULTS_TABLE}
     WHERE result_group = ?
       AND run_id = ?`,
    [resultGroup, runId]
  );

  if (Number(existingRows[0]?.count ?? 0) > 0) {
    console.log(`⏭️  跳过 ${tableName}，统一表中已存在 legacy 批次`);
    return;
  }

  await db.query(
    `INSERT INTO ${BACKTEST_RESULTS_TABLE} (
      result_group, run_id, config_name, mode, symbol,
      strategy_name, strategy_type, parameters,
      total_trades, winning_trades, losing_trades, win_rate,
      gross_pnl, total_commission, total_pnl, return_pct, avg_pnl,
      sharpe_ratio, profit_factor, max_drawdown, max_drawdown_pct,
      gross_profit, gross_loss, avg_win, avg_loss, score,
      executor_version, executor_options, created_at, updated_at
    )
    SELECT
      ? AS result_group,
      ? AS run_id,
      ? AS config_name,
      ? AS mode,
      ? AS symbol,
      strategy_name,
      strategy_type,
      parameters,
      total_trades,
      winning_trades,
      losing_trades,
      win_rate,
      COALESCE(gross_pnl, total_pnl) AS gross_pnl,
      COALESCE(total_commission, 0) AS total_commission,
      total_pnl,
      COALESCE(return_pct, 0) AS return_pct,
      avg_pnl,
      sharpe_ratio,
      profit_factor,
      max_drawdown,
      COALESCE(max_drawdown_pct, 0) AS max_drawdown_pct,
      gross_profit,
      gross_loss,
      avg_win,
      avg_loss,
      score,
      executor_version,
      executor_options,
      created_at,
      COALESCE(updated_at, created_at) AS updated_at
    FROM ${tableName}`,
    [resultGroup, runId, tableName, mode, symbol]
  );

  const [migratedRows] = await db.query<CountRow[]>(`SELECT COUNT(*) AS count FROM ${tableName}`);
  console.log(`✅ 已迁移 ${tableName} -> ${BACKTEST_RESULTS_TABLE} (${Number(migratedRows[0]?.count ?? 0)} 行)`);
}

async function main(): Promise<void> {
  try {
    const legacyTables = await listLegacyTables();
    if (legacyTables.length === 0) {
      console.log('没有发现需要迁移的 legacy backtest_results_* 表。');
      return;
    }

    console.log(`发现 ${legacyTables.length} 张 legacy 结果表，开始迁移到 ${BACKTEST_RESULTS_TABLE}...`);
    for (const tableName of legacyTables) {
      await migrateTable(tableName);
    }
    console.log('✅ legacy backtest results 迁移完成');
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
