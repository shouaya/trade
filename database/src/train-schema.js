const { BACKTEST_RESULTS_DDL } = require('./backtest-results.schema');
const { TRAIN_CONFIGS_DDL } = require('./train-configs.schema');
const { TRAIN_RUN_REQUESTS_DDL } = require('./train-run-requests.schema');
const {
  dropColumnIfExists,
  dropIndexIfExists,
  ensureColumn,
  ensureIndex,
  modifyColumnIfExists
} = require('./schema-utils');
const {
  BACKTEST_RESULTS_TABLE,
  TRAIN_CONFIGS_TABLE,
  TRAIN_RUN_REQUESTS_TABLE
} = require('./table-names');

async function ensureBacktestResultsSchema(db, tableName = BACKTEST_RESULTS_TABLE) {
  await db.query(BACKTEST_RESULTS_DDL.replaceAll(BACKTEST_RESULTS_TABLE, tableName));

  await ensureColumn(db, tableName, 'result_group', `VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'logical result group' AFTER id`);
  await ensureColumn(db, tableName, 'run_id', `VARCHAR(64) NOT NULL DEFAULT '' COMMENT 'single training or validation run id' AFTER result_group`);
  await ensureColumn(db, tableName, 'config_name', `VARCHAR(255) NULL COMMENT 'config name' AFTER run_id`);
  await ensureColumn(db, tableName, 'mode', `VARCHAR(20) NULL COMMENT 'training / validation' AFTER config_name`);
  await ensureColumn(db, tableName, 'symbol', `VARCHAR(20) NULL COMMENT 'market symbol' AFTER mode`);
  await ensureColumn(db, tableName, 'interval_type', `VARCHAR(20) NULL COMMENT 'kline interval' AFTER symbol`);
  await ensureColumn(db, tableName, 'period_start_ms', `BIGINT NULL COMMENT 'period start timestamp in ms' AFTER interval_type`);
  await ensureColumn(db, tableName, 'period_end_ms', `BIGINT NULL COMMENT 'period end timestamp in ms' AFTER period_start_ms`);
  await ensureColumn(db, tableName, 'gross_profit', `DECIMAL(15, 2) DEFAULT 0 AFTER max_drawdown_pct`);
  await ensureColumn(db, tableName, 'gross_loss', `DECIMAL(15, 2) DEFAULT 0 AFTER gross_profit`);
  await ensureColumn(db, tableName, 'executor_version', `VARCHAR(20) NULL AFTER score`);
  await ensureColumn(db, tableName, 'executor_options', `JSON NULL AFTER executor_version`);
  await ensureColumn(db, tableName, 'updated_at', `TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at`);

  await modifyColumnIfExists(db, tableName, 'gross_pnl', 'DECIMAL(15, 2) DEFAULT 0');
  await modifyColumnIfExists(db, tableName, 'total_commission', 'DECIMAL(15, 4) DEFAULT 0');
  await modifyColumnIfExists(db, tableName, 'total_pnl', 'DECIMAL(15, 2) DEFAULT 0');
  await modifyColumnIfExists(db, tableName, 'avg_pnl', 'DECIMAL(15, 2) DEFAULT 0');
  await modifyColumnIfExists(db, tableName, 'max_drawdown', 'DECIMAL(15, 2) DEFAULT 0');
  await modifyColumnIfExists(db, tableName, 'max_drawdown_pct', 'DECIMAL(10, 4) DEFAULT 0');
  await modifyColumnIfExists(db, tableName, 'gross_profit', 'DECIMAL(15, 2) DEFAULT 0');
  await modifyColumnIfExists(db, tableName, 'gross_loss', 'DECIMAL(15, 2) DEFAULT 0');
  await modifyColumnIfExists(db, tableName, 'avg_win', 'DECIMAL(15, 2) DEFAULT 0');
  await modifyColumnIfExists(db, tableName, 'avg_loss', 'DECIMAL(15, 2) DEFAULT 0');
  await modifyColumnIfExists(db, tableName, 'max_win', 'DECIMAL(15, 2) DEFAULT 0');
  await modifyColumnIfExists(db, tableName, 'max_loss', 'DECIMAL(15, 2) DEFAULT 0');
  await modifyColumnIfExists(db, tableName, 'score', 'DECIMAL(15, 4) DEFAULT 0');
  await modifyColumnIfExists(db, tableName, 'return_pct', 'DECIMAL(12, 4) DEFAULT 0');
  await modifyColumnIfExists(db, tableName, 'sharpe_ratio', 'DECIMAL(10, 4) DEFAULT 0');
  await modifyColumnIfExists(db, tableName, 'profit_factor', 'DECIMAL(10, 4) DEFAULT 0');

  await ensureIndex(db, tableName, 'idx_result_group', 'INDEX idx_result_group (result_group)');
  await ensureIndex(db, tableName, 'idx_result_group_run_id', 'INDEX idx_result_group_run_id (result_group, run_id)');
  await ensureIndex(db, tableName, 'idx_symbol_mode', 'INDEX idx_symbol_mode (symbol, mode)');
  await ensureIndex(db, tableName, 'uniq_result_group_run_strategy', 'UNIQUE INDEX uniq_result_group_run_strategy (result_group, run_id, strategy_name)');
}

async function ensureTrainConfigsSchema(db) {
  await db.query(TRAIN_CONFIGS_DDL);
  await dropIndexIfExists(db, TRAIN_CONFIGS_TABLE, 'idx_synced_at');
  await dropColumnIfExists(db, TRAIN_CONFIGS_TABLE, 'file_mtime');
  await dropColumnIfExists(db, TRAIN_CONFIGS_TABLE, 'synced_at');
  await dropColumnIfExists(db, TRAIN_CONFIGS_TABLE, 'file_path');
  await dropColumnIfExists(db, TRAIN_CONFIGS_TABLE, 'file_name');
}

async function ensureTrainRunRequestsSchema(db) {
  await db.query(TRAIN_RUN_REQUESTS_DDL);
  await ensureColumn(db, TRAIN_RUN_REQUESTS_TABLE, 'execution_pid', 'INT NULL AFTER worker_pid');
  await ensureColumn(db, TRAIN_RUN_REQUESTS_TABLE, 'cancel_requested', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER execution_pid');
}

module.exports = {
  ensureBacktestResultsSchema,
  ensureTrainConfigsSchema,
  ensureTrainRunRequestsSchema
};
