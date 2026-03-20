#!/usr/bin/env node
/**
 * 通用训练脚本
 *
 * 使用方法:
 *   node scripts/train.js <config-file>
 *   node scripts/train.js configs/training/2025_btcjpy_hf_rsi_macd_tp_atr.json
 *
 * 功能:
 * 1. 根据配置文件生成策略组合
 * 2. 使用指定版本的执行器运行回测
 * 3. 保存所有策略结果和交易记录
 * 4. 查询并保存Top N策略
 */

import * as path from 'path';
import * as fs from 'fs';
import { randomBytes } from 'crypto';
import db from '../configs/database';
import { TaskManager } from '../services/task-manager';
import { StrategyExecutor } from '../services/strategy-executor';
import { generateStrategyCombinations } from '../services/strategy-parameter-generator';
import { loadRouterPolicyCatalogFromRefs, summarizePolicyCatalog } from '../services/router-policy-catalog';
import type * as mysql from 'mysql2/promise';
import type {
  Strategy,
  KlineData,
  BacktestResult,
  ExecutorOptions,
  BacktestStats,
  TradeRecord,
  StrategyParameters,
  StrategyType,
  ParameterSpace,
  TimeRestriction
} from '../types';

// Helper function to create task manager instance
async function createTaskManager(): Promise<TaskManager> {
  const connection = await db.getConnection();
  return new TaskManager(connection);
}

// 常量
const PROGRESS_INTERVAL_MS = 10000;
const TRADE_BATCH_SIZE = 1000;
const BACKTEST_RESULTS_TABLE = 'backtest_results';

interface TrainingConfig {
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
  readonly database: {
    readonly tableName: string;
    readonly resetTableBeforeRun?: boolean;
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
  readonly executor: {
    readonly version: string;
    readonly options: ExecutorOptions;
  };
  readonly regimeRouting?: {
    readonly routerConfigPath?: string;
    readonly policyCatalogPath?: string;
  };
  readonly output: {
    readonly topN?: number;
    readonly strategyNamePrefix?: string;
    readonly descriptionPrefix?: string;
    readonly persistTopStrategies?: boolean;
    readonly persistTrades?: boolean;
  };
}

async function resultColumnExists(tableName: string, columnName: string): Promise<boolean> {
  const [columns] = await db.query<mysql.RowDataPacket[]>(
    `SHOW COLUMNS FROM ${tableName} LIKE ?`,
    [columnName]
  );
  return columns.length > 0;
}

async function resultIndexExists(tableName: string, indexName: string): Promise<boolean> {
  const [indexes] = await db.query<mysql.RowDataPacket[]>(
    `SHOW INDEX FROM ${tableName} WHERE Key_name = ?`,
    [indexName]
  );
  return indexes.length > 0;
}

async function modifyColumnIfExists(tableName: string, columnName: string, ddl: string): Promise<void> {
  if (await resultColumnExists(tableName, columnName)) {
    await db.query(`ALTER TABLE ${tableName} MODIFY COLUMN ${columnName} ${ddl}`);
  }
}

async function ensureColumn(tableName: string, columnName: string, ddl: string): Promise<void> {
  if (!await resultColumnExists(tableName, columnName)) {
    await db.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${ddl}`);
  }
}

async function ensureIndex(tableName: string, indexName: string, ddl: string): Promise<void> {
  if (!await resultIndexExists(tableName, indexName)) {
    await db.query(`ALTER TABLE ${tableName} ADD ${ddl}`);
  }
}

interface StrategyResult {
  readonly strategy_name: string;
  readonly strategy_type: string;
  readonly total_trades: number;
  readonly winning_trades: number;
  readonly losing_trades: number;
  readonly win_rate: number;
  readonly total_pnl: number;
  readonly return_pct: number;
  readonly avg_pnl: number;
  readonly sharpe_ratio: number;
  readonly profit_factor: number;
  readonly max_drawdown: number;
  readonly max_drawdown_pct: number;
  readonly gross_profit: number;
  readonly gross_loss: number;
  readonly avg_win: number;
  readonly avg_loss: number;
  readonly score: number;
  readonly parameters: StrategyParameters | string;
}

interface TypeCount {
  [key: string]: number;
}

/**
 * 加载配置文件
 */
function resolveConfigPath(configPath: string): string {
  return path.isAbsolute(configPath)
    ? configPath
    : path.resolve(__dirname, '..', '..', configPath);
}

function loadConfig(configPath: string): TrainingConfig {
  // __dirname 在编译后指向 dist/scripts/
  // 配置文件在项目根目录的 configs/ 下，需要回退两级
  const fullPath = resolveConfigPath(configPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`配置文件不存在: ${fullPath}`);
  }

  const config = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as TrainingConfig;

  // 验证必需字段
  const required: readonly (keyof TrainingConfig)[] = ['name', 'timeRange', 'market', 'database', 'strategy', 'executor'];
  for (const field of required) {
    if (!config[field]) {
      throw new Error(`配置文件缺少必需字段: ${field}`);
    }
  }

  return config;
}

/**
 * 生成策略组合
 */
function generateStrategies(config: TrainingConfig): readonly Strategy[] {
  if (config.strategy.explicitStrategies?.length) {
    const strategies = config.strategy.explicitStrategies.map((strategy, index) => ({
      id: index + 1,
      name: strategy.name,
      type: strategy.type,
      parameters: strategy.parameters
    }));

    console.log(`\n✅ 加载了 ${strategies.length} 个显式策略\n`);

    const typeCount: TypeCount = {};
    strategies.forEach(s => {
      typeCount[s.type] = (typeCount[s.type] ?? 0) + 1;
    });

    console.log('策略类型分布:');
    Object.entries(typeCount).forEach(([type, count]) => {
      console.log(`   - ${type}: ${count}个`);
    });

    return strategies;
  }

  const strategyTypes = config.strategy.types ?? (['rsi_macd'] as const);
  const parameters = config.strategy.parameters ?? {};
  const venueCode = config.executor.options.feeModel?.venueCode?.trim();

  const strategies = generateStrategyCombinations({ types: strategyTypes, parameters }).map(strategy => ({
    ...strategy,
    name: venueCode ? `${venueCode}-${strategy.name}` : strategy.name,
    parameters: venueCode
      ? {
        ...strategy.parameters,
        venueCode
      }
      : strategy.parameters
  }));

  console.log(`\n✅ 生成了 ${strategies.length} 个策略组合\n`);

  // 显示策略类型统计
  const typeCount: TypeCount = {};
  strategies.forEach(s => {
    typeCount[s.type] = (typeCount[s.type] ?? 0) + 1;
  });

  console.log('策略类型分布:');
  Object.entries(typeCount).forEach(([type, count]) => {
    console.log(`   - ${type}: ${count}个`);
  });

  return strategies;
}

/**
 * 确保结果表存在
 */
function resolveResultGroup(config: TrainingConfig): string {
  return config.database.tableName.trim();
}

function resolveRunMode(config: TrainingConfig): 'training' | 'validation' {
  return config.strategy.explicitStrategies?.length ? 'validation' : 'training';
}

function createRunId(config: TrainingConfig): string {
  const mode = resolveRunMode(config);
  return `${mode}_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

async function ensureBacktestTable(): Promise<void> {
  console.log(`\n📋 创建/检查结果表: ${BACKTEST_RESULTS_TABLE}`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ${BACKTEST_RESULTS_TABLE} (
      id INT AUTO_INCREMENT PRIMARY KEY,
      result_group VARCHAR(255) NOT NULL,
      run_id VARCHAR(64) NOT NULL,
      config_name VARCHAR(255) NULL,
      mode VARCHAR(20) NULL,
      symbol VARCHAR(20) NULL,
      interval_type VARCHAR(20) NULL,
      period_start_ms BIGINT NULL,
      period_end_ms BIGINT NULL,
      strategy_name VARCHAR(255),
      strategy_type VARCHAR(50),
      total_trades INT,
      winning_trades INT,
      losing_trades INT,
      win_rate DECIMAL(5,4),
      gross_pnl DECIMAL(12,2),
      total_commission DECIMAL(12,4),
      total_pnl DECIMAL(12,2),
      return_pct DECIMAL(12,4),
      avg_pnl DECIMAL(12,2),
      sharpe_ratio DECIMAL(10,4),
      profit_factor DECIMAL(10,4),
      max_drawdown DECIMAL(15,2),
      max_drawdown_pct DECIMAL(10,4),
      gross_profit DECIMAL(12,2),
      gross_loss DECIMAL(12,2),
      avg_win DECIMAL(12,2),
      avg_loss DECIMAL(12,2),
      score DECIMAL(12,4),
      parameters JSON,
      executor_version VARCHAR(20),
      executor_options JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_result_group (result_group),
      INDEX idx_result_group_run_id (result_group, run_id),
      INDEX idx_symbol_mode (symbol, mode),
      INDEX idx_strategy_type (strategy_type),
      INDEX idx_total_pnl (total_pnl),
      INDEX idx_score (score),
      INDEX idx_created_at (created_at),
      UNIQUE KEY uniq_result_group_run_strategy (result_group, run_id, strategy_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await ensureColumn(BACKTEST_RESULTS_TABLE, 'result_group', `VARCHAR(255) NOT NULL DEFAULT '' AFTER id`);
  await ensureColumn(BACKTEST_RESULTS_TABLE, 'run_id', `VARCHAR(64) NOT NULL DEFAULT '' AFTER result_group`);
  await ensureColumn(BACKTEST_RESULTS_TABLE, 'config_name', `VARCHAR(255) NULL AFTER run_id`);
  await ensureColumn(BACKTEST_RESULTS_TABLE, 'mode', `VARCHAR(20) NULL AFTER config_name`);
  await ensureColumn(BACKTEST_RESULTS_TABLE, 'symbol', `VARCHAR(20) NULL AFTER mode`);
  await ensureColumn(BACKTEST_RESULTS_TABLE, 'interval_type', `VARCHAR(20) NULL AFTER symbol`);
  await ensureColumn(BACKTEST_RESULTS_TABLE, 'period_start_ms', `BIGINT NULL AFTER interval_type`);
  await ensureColumn(BACKTEST_RESULTS_TABLE, 'period_end_ms', `BIGINT NULL AFTER period_start_ms`);
  await ensureColumn(BACKTEST_RESULTS_TABLE, 'gross_pnl', `DECIMAL(12,2) NULL AFTER win_rate`);
  await ensureColumn(BACKTEST_RESULTS_TABLE, 'total_commission', `DECIMAL(12,4) NULL AFTER gross_pnl`);
  await ensureColumn(BACKTEST_RESULTS_TABLE, 'return_pct', `DECIMAL(12,4) NULL AFTER total_pnl`);
  await ensureColumn(BACKTEST_RESULTS_TABLE, 'max_drawdown_pct', `DECIMAL(10,4) NULL AFTER max_drawdown`);
  await ensureColumn(BACKTEST_RESULTS_TABLE, 'updated_at', `TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at`);

  await modifyColumnIfExists(BACKTEST_RESULTS_TABLE, 'max_drawdown', 'DECIMAL(15,2) NULL');
  await modifyColumnIfExists(BACKTEST_RESULTS_TABLE, 'return_pct', 'DECIMAL(12,4) NULL');
  await modifyColumnIfExists(BACKTEST_RESULTS_TABLE, 'max_drawdown_pct', 'DECIMAL(10,4) NULL');
  await ensureIndex(BACKTEST_RESULTS_TABLE, 'idx_result_group', 'INDEX idx_result_group (result_group)');
  await ensureIndex(BACKTEST_RESULTS_TABLE, 'idx_result_group_run_id', 'INDEX idx_result_group_run_id (result_group, run_id)');
  await ensureIndex(BACKTEST_RESULTS_TABLE, 'idx_symbol_mode', 'INDEX idx_symbol_mode (symbol, mode)');
  await ensureIndex(BACKTEST_RESULTS_TABLE, 'uniq_result_group_run_strategy', 'UNIQUE INDEX uniq_result_group_run_strategy (result_group, run_id, strategy_name)');

  console.log('✅ 结果表准备完成');
}

async function resetBacktestTable(resultGroup: string): Promise<void> {
  console.log(`\n🧹 清空逻辑结果分组: ${resultGroup}`);
  await db.query(`DELETE FROM ${BACKTEST_RESULTS_TABLE} WHERE result_group = ?`, [resultGroup]);
  console.log('✅ 逻辑结果分组已清空');
}

async function findLatestRunId(resultGroup: string): Promise<string | null> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT run_id
     FROM ${BACKTEST_RESULTS_TABLE}
     WHERE result_group = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [resultGroup]
  );

  const runId = rows[0]?.['run_id'];
  return runId ? String(runId) : null;
}

/**
 * 加载K线数据
 */
async function loadKlines(config: TrainingConfig): Promise<readonly KlineData[]> {
  const { symbol, intervalType } = config.market;
  const { startTimeMs, endTimeMs } = config.timeRange;

  console.log(`\n📊 加载K线数据...`);
  console.log(`   - 品种: ${symbol}`);
  console.log(`   - 周期: ${intervalType}`);
  console.log(`   - 时间: ${new Date(startTimeMs).toISOString()} - ${new Date(endTimeMs).toISOString()}`);

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
    [symbol, intervalType, startTimeMs, endTimeMs]
  );

  console.log(`✅ 加载完成，共 ${klines.length} 条K线数据`);

  if (klines.length === 0) {
    throw new Error('没有找到K线数据！');
  }

  return klines as KlineData[];
}

/**
 * 批量保存交易记录
 */
async function saveTrades(trades: readonly TradeRecord[], tradeBatchCreatedAt: string): Promise<void> {
  if (!trades || trades.length === 0) return;

  const values = trades.map(t => [
    t.direction,
    t.entry_time,
    sanitizeNumber(t.entry_price),
    t.entry_index ?? 0,
    sanitizeNumber(t.entry_rsi ?? null),
    sanitizeNumber(t.entry_macd ?? null),
    sanitizeNumber(t.entry_macd_signal ?? null),
    sanitizeNumber(t.entry_macd_histogram ?? null),
    sanitizeNumber(t.lot_size ?? 1.0),
    sanitizeNumber(t.hold_minutes ?? 0),
    sanitizeNumber(t.stop_loss ?? null),
    sanitizeNumber(t.take_profit ?? null),
    t.exit_time,
    sanitizeNumber(t.exit_price),
    sanitizeNumber(t.exit_rsi ?? null),
    sanitizeNumber(t.exit_macd ?? null),
    sanitizeNumber(t.exit_macd_signal ?? null),
    sanitizeNumber(t.exit_macd_histogram ?? null),
    t.exit_reason,
    sanitizeNumber(t.gross_pnl ?? t.pnl),
    sanitizeNumber(t.commission_fee ?? 0),
    sanitizeNumber(t.pnl),
    sanitizeNumber(t.pips ?? null),
    sanitizeNumber(t.percent ?? null),
    sanitizeNumber(t.actual_hold_minutes ?? t.hold_minutes ?? 0),
    t.strategy_name,
    t.symbol ?? 'USDJPY',
    null, // notes
    tradeBatchCreatedAt
  ]);

  await db.query(
    `INSERT INTO trades (
      direction, entry_time, entry_price, entry_index,
      entry_rsi, entry_macd, entry_macd_signal, entry_macd_histogram,
      lot_size, hold_minutes, stop_loss, take_profit,
      exit_time, exit_price, exit_rsi, exit_macd,
      exit_macd_signal, exit_macd_histogram,
      exit_reason, gross_pnl, commission_fee, pnl, pips, percent,
      actual_hold_minutes, strategy_name, symbol, notes, created_at
    ) VALUES ?`,
    [values]
  );
}

/**
 * 计算策略评分
 */
function calculateScore(stats: BacktestStats): number {
  return stats?.score ?? 0;
}

/**
 * 辅助函数：将NaN和Infinity转换为null，同时处理非数字类型
 */
function sanitizeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  // 如果是对象或数组，返回null
  if (typeof value === 'object') return null;

  // 尝试转换为数字
  const num = Number(value);

  // 如果转换失败或不是有限数，返回null
  if (isNaN(num) || !isFinite(num)) return null;

  return num;
}

/**
 * 保存策略结果
 */
async function saveStrategyResult(
  config: TrainingConfig,
  resultGroup: string,
  runId: string,
  strategy: Strategy,
  result: BacktestResult,
  executorVersion: string,
  executorOptions: ExecutorOptions
): Promise<void> {
  const stats = result.stats;
  const score = calculateScore(stats);

  // 计算winning/losing trades
  const winningTrades = result.trades ? result.trades.filter(t => t.pnl > 0).length : 0;
  const losingTrades = result.trades ? result.trades.filter(t => t.pnl <= 0).length : 0;

  // 计算gross profit/loss
  const grossProfit = sanitizeNumber(
    (stats.avgWin ?? 0) * winningTrades
  );
  const grossLoss = sanitizeNumber(
    (stats.avgLoss ?? 0) * losingTrades
  );

  await db.query(
    `INSERT INTO ${BACKTEST_RESULTS_TABLE}
     (result_group, run_id, config_name, mode, symbol, interval_type, period_start_ms, period_end_ms,
      strategy_name, strategy_type, total_trades, winning_trades, losing_trades,
      win_rate, gross_pnl, total_commission, total_pnl, return_pct, avg_pnl, sharpe_ratio, profit_factor, max_drawdown, max_drawdown_pct,
     gross_profit, gross_loss, avg_win, avg_loss, score, parameters,
      executor_version, executor_options)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       strategy_type = VALUES(strategy_type),
       total_trades = VALUES(total_trades),
       winning_trades = VALUES(winning_trades),
       losing_trades = VALUES(losing_trades),
       win_rate = VALUES(win_rate),
       gross_pnl = VALUES(gross_pnl),
       total_commission = VALUES(total_commission),
       total_pnl = VALUES(total_pnl),
       return_pct = VALUES(return_pct),
       avg_pnl = VALUES(avg_pnl),
       sharpe_ratio = VALUES(sharpe_ratio),
       profit_factor = VALUES(profit_factor),
       max_drawdown = VALUES(max_drawdown),
       max_drawdown_pct = VALUES(max_drawdown_pct),
       gross_profit = VALUES(gross_profit),
       gross_loss = VALUES(gross_loss),
       avg_win = VALUES(avg_win),
       avg_loss = VALUES(avg_loss),
       score = VALUES(score),
       parameters = VALUES(parameters),
       executor_version = VALUES(executor_version),
       executor_options = VALUES(executor_options),
       updated_at = CURRENT_TIMESTAMP`,
    [
      resultGroup,
      runId,
      config.name,
      resolveRunMode(config),
      config.market.symbol,
      config.market.intervalType,
      config.timeRange.startTimeMs,
      config.timeRange.endTimeMs,
      strategy.name,
      strategy.type,
      stats.totalTrades,
      winningTrades,
      losingTrades,
      sanitizeNumber(stats.winRate),
      sanitizeNumber(stats.grossPnl ?? stats.totalPnl),
      sanitizeNumber(stats.totalCommission ?? 0),
      sanitizeNumber(stats.totalPnl),
      sanitizeNumber(stats.returnPct ?? 0),
      sanitizeNumber(stats.avgPnl),
      sanitizeNumber(stats.sharpeRatio),
      sanitizeNumber(stats.profitFactor),
      sanitizeNumber(stats.maxDrawdown),
      sanitizeNumber(stats.maxDrawdownPct ?? 0),
      grossProfit,
      grossLoss,
      sanitizeNumber(stats.avgWin ?? 0),
      sanitizeNumber(stats.avgLoss ?? 0),
      sanitizeNumber(score),
      JSON.stringify(strategy.parameters),
      executorVersion,
      JSON.stringify(executorOptions)
    ]
  );
}

/**
 * 显示进度
 */
function displayProgress(
  current: number,
  total: number,
  validCount: number,
  totalTrades: number,
  startTime: number
): void {
  const percent = ((current / total) * 100).toFixed(1);
  const elapsed = (Date.now() - startTime) / 1000 / 60;
  const speed = current / elapsed;
  const remaining = (total - current) / speed;

  console.log(`\n📊 进度: ${current}/${total} (${percent}%) | 有效: ${validCount} | 交易数: ${totalTrades} |`);
  console.log(`     已用: ${elapsed.toFixed(1)}分 | 剩余: ${remaining.toFixed(1)}分 | 速度: ${(60/speed).toFixed(2)}秒/策略`);
}

function createTradeBatchCreatedAt(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * 执行训练
 */
async function runTraining(
  config: TrainingConfig,
  strategies: readonly Strategy[],
  klines: readonly KlineData[],
  executorOptions: ExecutorOptions,
  runId: string
): Promise<void> {
  const resultGroup = resolveResultGroup(config);
  const executorVersion = config.executor.version;
  const persistTrades = config.output.persistTrades ?? true;

  console.log(`\n🚀 开始执行 ${strategies.length} 个策略回测...\n`);

  const startTime = Date.now();
  const tradeBatchCreatedAt = createTradeBatchCreatedAt();
  let validCount = 0;
  let totalTrades = 0;
  let lastProgressTime = Date.now();
  let allTrades: TradeRecord[] = [];

  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    if (!strategy) continue;

    try {
      const executor = new StrategyExecutor(strategy, klines, executorOptions);
      const result = await executor.execute();

      if (result && result.trades && result.trades.length > 0) {
        validCount++;
        totalTrades += result.trades.length;

        // 添加策略名称
        const tradesWithName = result.trades.map(t => ({
          ...t,
          strategy_name: strategy.name
        }));
        allTrades = allTrades.concat(tradesWithName);

        // 批量保存交易
        if (persistTrades && allTrades.length >= TRADE_BATCH_SIZE) {
          await saveTrades(allTrades, tradeBatchCreatedAt);
          allTrades = [];
        }

        // 保存策略结果
        await saveStrategyResult(config, resultGroup, runId, strategy, result, executorVersion, executorOptions);
      }

      // 显示进度
      if (Date.now() - lastProgressTime >= PROGRESS_INTERVAL_MS) {
        displayProgress(i + 1, strategies.length, validCount, totalTrades, startTime);
        lastProgressTime = Date.now();
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ 策略 #${i + 1} 失败: ${errorMessage}`);
    }
  }

  // 保存剩余交易
  if (persistTrades && allTrades.length > 0) {
    await saveTrades(allTrades, tradeBatchCreatedAt);
  }

  const endTime = Date.now();
  const totalMinutes = ((endTime - startTime) / 1000 / 60).toFixed(1);

  console.log('\n✅ 回测执行完成！');
  console.log(`   - 总耗时: ${totalMinutes} 分钟`);
  console.log(`   - 有效策略: ${validCount}/${strategies.length}`);
  console.log(`   - 总交易数: ${totalTrades}`);
  console.log(`   - 平均速度: ${((endTime - startTime) / 1000 / strategies.length).toFixed(2)} 秒/策略\n`);
}

/**
 * 查询Top策略
 */
async function queryTopStrategies(resultGroup: string, topN: number, runId?: string): Promise<readonly StrategyResult[]> {
  const effectiveRunId = runId ?? await findLatestRunId(resultGroup);
  if (!effectiveRunId) {
    console.log(`\n🏆 逻辑结果分组 ${resultGroup} 暂无可用结果\n`);
    return [];
  }

  console.log(`\n🏆 查询 Top ${topN} 策略...\n`);
  console.log(`   - 逻辑结果分组: ${resultGroup}`);
  console.log(`   - run_id: ${effectiveRunId}\n`);

  const [results] = await db.query<mysql.RowDataPacket[]>(
    `SELECT * FROM ${BACKTEST_RESULTS_TABLE}
     WHERE result_group = ?
       AND run_id = ?
       AND total_trades > 0
     ORDER BY score DESC, return_pct DESC, total_pnl DESC, strategy_name ASC
     LIMIT ?`,
    [resultGroup, effectiveRunId, topN]
  );

  // 显示Top策略
  console.log('┌─────┬──────────────────────────────┬────────┬─────────┬──────────┬───────────┬──────────┐');
  console.log('│ 排名 │ 策略名称                      │ 类型   │ 交易数  │ 胜率     │ 总盈亏    │ 评分     │');
  console.log('├─────┼──────────────────────────────┼────────┼─────────┼──────────┼───────────┼──────────┤');

  results.forEach((row, i) => {
    const rank = String(i + 1).padStart(4);
    const name = String(row['strategy_name']).substring(0, 28).padEnd(28);
    const type = String(row['strategy_type'] ?? '').padEnd(6);
    const trades = String(row['total_trades'] ?? 0).padStart(8);
    const winRate = (parseFloat(String(row['win_rate'])) * 100).toFixed(1).padStart(7) + '%';
    const pnl = ('$' + parseFloat(String(row['total_pnl'])).toFixed(2)).padStart(10);
    const score = parseFloat(String(row['score'])).toFixed(2).padStart(9);

    console.log(`│ ${rank} │ ${name} │ ${type} │ ${trades} │ ${winRate} │ ${pnl} │ ${score} │`);
  });

  console.log('└─────┴──────────────────────────────┴────────┴─────────┴──────────┴───────────┴──────────┘\n');

  return results as StrategyResult[];
}

/**
 * 保存Top策略到strategies表
 */
async function saveTopStrategies(topResults: readonly StrategyResult[], config: TrainingConfig): Promise<void> {
  console.log(`\n💾 保存 Top ${topResults.length} 策略到 strategies 表...\n`);

  const prefix = config.output.strategyNamePrefix ?? '';
  const descPrefix = config.output.descriptionPrefix ?? '';

  for (let i = 0; i < topResults.length; i++) {
    const result = topResults[i];
    if (!result) continue;

    const params: StrategyParameters = typeof result.parameters === 'string'
      ? JSON.parse(result.parameters)
      : result.parameters;

    const name = `${prefix}${result.strategy_name}`;
    const description = `${descPrefix} - Rank ${i + 1} - Score: ${parseFloat(String(result.score)).toFixed(2)} - WinRate: ${(parseFloat(String(result.win_rate)) * 100).toFixed(1)}% - PnL: ${parseFloat(String(result.total_pnl)).toFixed(2)}`;

    try {
      await db.query(
        `INSERT INTO strategies (name, type, parameters, description, is_active)
         VALUES (?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
         parameters = VALUES(parameters),
         description = VALUES(description),
         updated_at = CURRENT_TIMESTAMP`,
        [name, result.strategy_type, JSON.stringify(params), description]
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ 保存策略失败: ${errorMessage}`);
    }
  }

  console.log('\n✅ Top 策略保存完成！\n');
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  const configPath = process.argv[2];

  if (!configPath) {
    console.error('❌ 请指定配置文件路径');
    console.error('\n使用方法:');
    console.error('  node scripts/train.js <config-file>');
    console.error('\n示例:');
    console.error('  node scripts/train.js configs/training/2025_btcjpy_hf_rsi_macd_tp_atr.json');
    process.exit(1);
  }

  let taskManager: TaskManager | undefined;
  let taskId: string | undefined;

  try {
    // 0. 创建任务管理器并清理僵尸任务
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    策略训练系统                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log('🔍 检查并清理僵尸任务...');
    taskManager = await createTaskManager();
    const cleanupResult = await taskManager.cleanupZombieTasks();

    if (cleanupResult.cleaned > 0) {
      console.log(`⚠️  清理了 ${cleanupResult.cleaned} 个僵尸任务`);
      if (cleanupResult.tradesCleared) {
        console.log('⚠️  trades表已清空（避免数据污染）\n');
      }
    }

    // 1. 加载配置
    const resolvedConfigPath = resolveConfigPath(configPath);
    const config = loadConfig(configPath);
    const policyCatalog = loadRouterPolicyCatalogFromRefs({
      baseFilePath: resolvedConfigPath,
      routerConfigPath: config.regimeRouting?.routerConfigPath,
      policyCatalogPath: config.regimeRouting?.policyCatalogPath
    });
    console.log(`\n📋 训练配置: ${config.name}`);
    console.log(`📝 说明: ${config.description ?? '无'}`);
    if (policyCatalog) {
      console.log(`🧭 路由策略表: ${policyCatalog.routerVersion} / ${policyCatalog.catalogVersion}`);
      summarizePolicyCatalog(policyCatalog).forEach((line) => {
        console.log(`   - ${line}`);
      });
    }

    // 2. 注册任务
    taskId = await taskManager.createTask(
      config.name,
      config.description ?? `Training ${config.name}`
    );

    // 3. 确保数据库表
    const resultGroup = resolveResultGroup(config);
    const runId = createRunId(config);
    await ensureBacktestTable();
    if (config.database.resetTableBeforeRun) {
      await resetBacktestTable(resultGroup);
    }

    // 4. 生成策略
    const strategies = generateStrategies(config);

    // 5. 加载K线数据
    const klines = await loadKlines(config);

    // 6. 执行训练
    await runTraining(config, strategies, klines, config.executor.options, runId);

    // 7. 查询Top策略
    const topN = config.output.topN ?? 10;
    const topResults = await queryTopStrategies(resultGroup, topN, runId);

    // 8. 保存Top策略
    if (topResults.length > 0 && (config.output.persistTopStrategies ?? true)) {
      await saveTopStrategies(topResults, config);
    }

    // 9. 标记任务完成
    if (taskId) {
      await taskManager.completeTask(taskId);
    }

    // 完成
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                  训练完成！                                ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log(`📊 训练摘要:`);
    console.log(`   - 配置: ${config.name}`);
    console.log(`   - 策略数: ${strategies.length}`);
    console.log(`   - Top N: ${topN} 个策略已保存`);
    console.log(`   - 结果表: ${BACKTEST_RESULTS_TABLE}`);
    console.log(`   - 逻辑分组: ${resultGroup}`);
    console.log(`   - run_id: ${runId}`);
    if (policyCatalog) {
      console.log(`   - 路由策略表: ${policyCatalog.routerVersion} (${policyCatalog.catalogVersion})`);
    }
    console.log('');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('\n❌ 训练失败:', errorMessage);
    console.error(errorStack);

    // 标记任务失败
    if (taskManager && taskId) {
      await taskManager.failTask(taskId, error);
    }

    process.exit(1);
  } finally {
    await db.end();
  }
}

// 执行
if (require.main === module) {
  main();
}

export { main, loadConfig, queryTopStrategies };
