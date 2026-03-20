/**
 * 初始化数据库脚本
 * 创建除 klines 外的所有必要表
 */

import db from '../configs/database';
import type * as mysql from 'mysql2/promise';
import {
  BACKTEST_RESULTS_DDL,
  STRATEGIES_DDL,
  TRADES_DDL,
  TASKS_DDL
} from '../database';

interface TableCheckResult {
  readonly tableName: string;
  readonly exists: boolean;
}

async function closeDbQuietly(): Promise<void> {
  try {
    await db.end();
  } catch {
    // Ignore pool-close errors during shutdown.
  }
}

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const [columns] = await db.query<mysql.RowDataPacket[]>(
    `SHOW COLUMNS FROM ${tableName} LIKE ?`,
    [columnName]
  );
  return columns.length > 0;
}

async function indexExists(tableName: string, indexName: string): Promise<boolean> {
  const [indexes] = await db.query<mysql.RowDataPacket[]>(
    `SHOW INDEX FROM ${tableName} WHERE Key_name = ?`,
    [indexName]
  );
  return indexes.length > 0;
}

async function ensureColumn(tableName: string, columnName: string, ddl: string): Promise<void> {
  if (!await columnExists(tableName, columnName)) {
    await db.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${ddl}`);
  }
}

async function ensureIndex(tableName: string, indexName: string, ddl: string): Promise<void> {
  if (!await indexExists(tableName, indexName)) {
    await db.query(`ALTER TABLE ${tableName} ADD ${ddl}`);
  }
}

async function tableExists(tableName: string): Promise<boolean> {
  const [tables] = await db.query<mysql.RowDataPacket[]>(
    `SHOW TABLES LIKE ?`,
    [tableName]
  );
  return tables.length > 0;
}

async function createBacktestResultsTable(): Promise<void> {
  console.log('📊 创建 backtest_results 表...');
  await db.query(BACKTEST_RESULTS_DDL);

  await ensureColumn('backtest_results', 'result_group', `VARCHAR(255) NOT NULL DEFAULT '' COMMENT '逻辑结果分组，兼容旧 tableName 配置' AFTER id`);
  await ensureColumn('backtest_results', 'run_id', `VARCHAR(64) NOT NULL DEFAULT '' COMMENT '单次训练/验证运行批次ID' AFTER result_group`);
  await ensureColumn('backtest_results', 'config_name', `VARCHAR(255) NULL COMMENT '配置名' AFTER run_id`);
  await ensureColumn('backtest_results', 'mode', `VARCHAR(20) NULL COMMENT 'training / validation' AFTER config_name`);
  await ensureColumn('backtest_results', 'symbol', `VARCHAR(20) NULL COMMENT '交易品种' AFTER mode`);
  await ensureColumn('backtest_results', 'interval_type', `VARCHAR(20) NULL COMMENT 'K线周期' AFTER symbol`);
  await ensureColumn('backtest_results', 'period_start_ms', `BIGINT NULL COMMENT '训练/验证起始时间' AFTER interval_type`);
  await ensureColumn('backtest_results', 'period_end_ms', `BIGINT NULL COMMENT '训练/验证结束时间' AFTER period_start_ms`);
  await ensureColumn('backtest_results', 'executor_version', `VARCHAR(20) NULL AFTER score`);
  await ensureColumn('backtest_results', 'executor_options', `JSON NULL AFTER executor_version`);
  await ensureColumn('backtest_results', 'updated_at', `TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at`);

  await ensureIndex('backtest_results', 'idx_result_group', 'INDEX idx_result_group (result_group)');
  await ensureIndex('backtest_results', 'idx_result_group_run_id', 'INDEX idx_result_group_run_id (result_group, run_id)');
  await ensureIndex('backtest_results', 'idx_symbol_mode', 'INDEX idx_symbol_mode (symbol, mode)');
  await ensureIndex('backtest_results', 'uniq_result_group_run_strategy', 'UNIQUE INDEX uniq_result_group_run_strategy (result_group, run_id, strategy_name)');

  console.log('✅ backtest_results 表创建成功');
}

async function createStrategiesTable(): Promise<void> {
  console.log('📊 创建 strategies 表...');
  await db.query(STRATEGIES_DDL);

  if (!await columnExists('strategies', 'type')) {
    console.log('🔧 补齐 strategies.type 列...');
    await db.query(`ALTER TABLE strategies ADD COLUMN type VARCHAR(50) NULL AFTER parameters`);
  }

  if (!await indexExists('strategies', 'idx_type')) {
    console.log('🔧 补齐 strategies.idx_type 索引...');
    await db.query(`ALTER TABLE strategies ADD INDEX idx_type (type)`);
  }

  if (!await indexExists('strategies', 'idx_is_active')) {
    console.log('🔧 补齐 strategies.idx_is_active 索引...');
    await db.query(`ALTER TABLE strategies ADD INDEX idx_is_active (is_active)`);
  }

  console.log('✅ strategies 表创建成功');
}

async function createTradesTable(): Promise<void> {
  console.log('📊 创建 trades 表...');
  await db.query(TRADES_DDL);

  await db.query('ALTER TABLE trades MODIFY COLUMN entry_price DECIMAL(20, 8) NOT NULL');
  await db.query('ALTER TABLE trades MODIFY COLUMN stop_loss DECIMAL(20, 8) NULL');
  await db.query('ALTER TABLE trades MODIFY COLUMN take_profit DECIMAL(20, 8) NULL');
  await db.query('ALTER TABLE trades MODIFY COLUMN exit_price DECIMAL(20, 8) NOT NULL');

  if (!await columnExists('trades', 'gross_pnl')) {
    console.log('🔧 补齐 trades.gross_pnl 列...');
    await db.query(`ALTER TABLE trades ADD COLUMN gross_pnl DECIMAL(10, 2) NULL AFTER exit_reason`);
  }

  if (!await columnExists('trades', 'commission_fee')) {
    console.log('🔧 补齐 trades.commission_fee 列...');
    await db.query(`ALTER TABLE trades ADD COLUMN commission_fee DECIMAL(10, 4) NULL AFTER gross_pnl`);
  }

  console.log('✅ trades 表创建成功');
}

async function createTasksTable(): Promise<void> {
  console.log('📊 创建 tasks 表...');
  await db.query(TASKS_DDL);
  console.log('✅ tasks 表创建成功');
}

async function main(): Promise<void> {
  console.log('='.repeat(80));
  console.log('🚀 开始初始化数据库');
  console.log('='.repeat(80));
  console.log('');

  try {
    // 检查 klines 表是否存在
    const klinesExists = await tableExists('klines');
    if (!klinesExists) {
      console.log('⚠️  警告: klines 表不存在，请先导入 K 线数据');
      console.log('');
    } else {
      console.log('✅ klines 表已存在（跳过创建）');
      console.log('');
    }

    console.log('🧩 检查并补齐 train 相关表...');

    // 创建/补齐所有表
    await createBacktestResultsTable();
    await createStrategiesTable();
    await createTradesTable();
    await createTasksTable();

    console.log('');
    console.log('='.repeat(80));
    console.log('📊 检查所有表状态');
    console.log('='.repeat(80));
    console.log('');

    // 检查所有表
    const tables = ['klines', 'backtest_results', 'strategies', 'trades', 'tasks'];
    const results: TableCheckResult[] = [];

    for (const tableName of tables) {
      const exists = await tableExists(tableName);
      results.push({ tableName, exists });

      if (exists) {
        // 获取行数
        const [countResult] = await db.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) as count FROM ${tableName}`
        );
        const row = countResult[0];
        const count = row ? (row['count'] as number) : 0;

        console.log(`✅ ${tableName.padEnd(20)} - 存在 (${count.toLocaleString()} 行)`);
      } else {
        console.log(`❌ ${tableName.padEnd(20)} - 不存在`);
      }
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('✅ 数据库初始化完成！');
    console.log('='.repeat(80));
    console.log('');

    // 显示建议
    if (!klinesExists) {
      console.log('📝 下一步操作:');
      console.log('  1. 导入 K 线数据到 klines 表');
      console.log('  2. 运行训练脚本开始回测');
      console.log('');
    } else {
      console.log('📝 可以开始使用:');
      console.log('  npm run train -- configs/training/2025_btcjpy_hf_rsi_macd_tp_atr.json');
      console.log('  npm run validate    # 验证策略');
      console.log('  npm run router:validate # 路由验证');
      console.log('');
    }

    await closeDbQuietly();
    process.exit(0);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';
    console.error('\n❌ 数据库初始化失败:', message);
    console.error(stack);
    await closeDbQuietly();
    process.exit(1);
  }
}

// 运行
main();
