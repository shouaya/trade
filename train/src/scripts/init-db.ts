/**
 * 初始化数据库脚本
 * 创建除 klines 外的所有必要表
 */

import {
  BACKTEST_RESULTS_TABLE,
  TABLES,
  STRATEGIES_DDL,
  TASKS_DDL,
  TRADES_DDL,
  ensureBacktestResultsSchema,
  ensureFeatureMemorySchema,
  ensureTrainDataTraceSchema,
  ensureTrainConfigsSchema,
  ensureTrainArtifactsSchema,
  ensureTrainGoalTrackingSchema,
  ensureTrainRunRequestsSchema
} from '@money/database';
import db from '../configs/database';
import type * as mysql from 'mysql2/promise';

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

async function tableExists(tableName: string): Promise<boolean> {
  const [tables] = await db.query<mysql.RowDataPacket[]>(
    `SHOW TABLES LIKE ?`,
    [tableName]
  );
  return tables.length > 0;
}

async function createBacktestResultsTable(): Promise<void> {
  console.log('📊 创建 backtest_results 表...');
  await ensureBacktestResultsSchema(db, BACKTEST_RESULTS_TABLE);

  console.log('✅ backtest_results 表创建成功');
}

async function createStrategiesTable(): Promise<void> {
  console.log('📊 创建 strategies 表...');
  await db.query(STRATEGIES_DDL);
  await ensureTrainDataTraceSchema(db);

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
  await ensureTrainDataTraceSchema(db);

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
  await ensureTrainDataTraceSchema(db);
  console.log('✅ tasks 表创建成功');
}

async function createTrainConfigsTable(): Promise<void> {
  console.log('📊 创建 train_configs 表...');
  await ensureTrainConfigsSchema(db);
  console.log('✅ train_configs 表创建成功');
}

async function createTrainRunRequestsTable(): Promise<void> {
  console.log('📊 创建 train_run_requests 表...');
  await ensureTrainRunRequestsSchema(db);
  console.log('✅ train_run_requests 表创建成功');
}

async function createTrainGoalTrackingTable(): Promise<void> {
  console.log('📊 创建 train_goal_tracking 表...');
  await ensureTrainGoalTrackingSchema(db);
  console.log('✅ train_goal_tracking 表创建成功');
}

async function createTrainArtifactsTable(): Promise<void> {
  console.log('📊 创建 train_artifacts 表...');
  await ensureTrainArtifactsSchema(db);
  console.log('✅ train_artifacts 表创建成功');
}

async function createFeatureMemoryTables(): Promise<void> {
  console.log('📊 创建 feature-memory 表...');
  await ensureFeatureMemorySchema(db);
  console.log('✅ feature-memory 表创建成功');
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
    await createTrainConfigsTable();
    await createTrainRunRequestsTable();
    await createTrainGoalTrackingTable();
    await createTrainArtifactsTable();
    await createFeatureMemoryTables();

    console.log('');
    console.log('='.repeat(80));
    console.log('📊 检查所有表状态');
    console.log('='.repeat(80));
    console.log('');

    // 检查所有表
    const tables = [
      'klines',
      'backtest_results',
      'strategies',
      'trades',
      'tasks',
      'train_configs',
      'train_goal_tracking',
      'training_config_details',
      'validation_config_details',
      'snapshot_config_details',
      'rolling_pool_details',
      'rolling_rule_details',
      'router_config_details',
      'policy_config_details',
      'generic_config_details',
      'train_run_requests',
      'train_artifacts',
      TABLES.TRAIN_RUNS,
      TABLES.MARKET_WINDOWS,
      TABLES.FEATURE_MEMORIES,
      TABLES.FEATURE_MATCHES,
      TABLES.STRATEGY_DEFINITIONS,
      TABLES.STRATEGY_PARAMETER_SETS,
      TABLES.STRATEGY_LIBRARY_MEMBERS,
      TABLES.FEATURE_CANDIDATE_POOLS,
      TABLES.FEATURE_CANDIDATE_POOL_ITEMS,
      TABLES.WINDOW_STRATEGY_EVALUATIONS,
      TABLES.WINDOW_BEST_ACTIONS,
      TABLES.UNKNOWN_FEATURE_EVENTS,
      TABLES.FEATURE_WRITEBACKS,
      TABLES.ANALYSIS_ARTIFACTS,
      TABLES.FEATURE_EMBEDDINGS
    ];
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
      console.log('  2. 如需初始化样例配置，执行 npm run seed:configs');
      console.log('  3. 通过 UI 或 API 创建训练配置并开始回测');
      console.log('');
    } else {
      console.log('📝 可以开始使用:');
      console.log('  1. 通过 UI 或 API 把 training config 保存到 train_configs');
      console.log('  2. 如需导入样例配置，执行 npm run seed:configs');
      console.log('  3. 在 UI 中直接运行 train / validation；仅在需要离线文件时再导出');
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
