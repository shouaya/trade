const { BACKTEST_RESULTS_DDL } = require('./backtest-results.schema');
const {
  GENERIC_CONFIG_DETAILS_DDL,
  POLICY_CONFIG_DETAILS_DDL,
  ROLLING_POOL_DETAILS_DDL,
  ROLLING_RULE_DETAILS_DDL,
  ROUTER_CONFIG_DETAILS_DDL,
  SNAPSHOT_CONFIG_DETAILS_DDL,
  TRAIN_CONFIGS_DDL,
  TRAINING_CONFIG_DETAILS_DDL,
  VALIDATION_CONFIG_DETAILS_DDL
} = require('./train-configs.schema');
const { TRAIN_RUN_REQUESTS_DDL } = require('./train-run-requests.schema');
const { TRAIN_GOAL_TRACKING_DDL } = require('./train-goal-tracking.schema');
const { TRAIN_ARTIFACTS_DDL } = require('./train-artifacts.schema');
const {
  ANALYSIS_ARTIFACTS_DDL,
  FEATURE_CANDIDATE_POOLS_DDL,
  FEATURE_CANDIDATE_POOL_ITEMS_DDL,
  FEATURE_EMBEDDINGS_DDL,
  FEATURE_MATCHES_DDL,
  FEATURE_MEMORIES_DDL,
  FEATURE_WRITEBACKS_DDL,
  MARKET_WINDOWS_DDL,
  STRATEGY_DEFINITIONS_DDL,
  STRATEGY_LIBRARY_MEMBERS_DDL,
  STRATEGY_PARAMETER_SETS_DDL,
  TRAIN_RUNS_DDL,
  UNKNOWN_FEATURE_EVENTS_DDL,
  WINDOW_BEST_ACTIONS_DDL,
  WINDOW_STRATEGY_EVALUATIONS_DDL
} = require('./feature-memory.schema');
const {
  dropColumnIfExists,
  dropIndexIfExists,
  ensureColumn,
  ensureIndex,
  modifyColumnIfExists
} = require('./schema-utils');
const {
  BACKTEST_RESULTS_TABLE,
  GENERIC_CONFIG_DETAILS_TABLE,
  POLICY_CONFIG_DETAILS_TABLE,
  ROLLING_POOL_DETAILS_TABLE,
  ROLLING_RULE_DETAILS_TABLE,
  ROUTER_CONFIG_DETAILS_TABLE,
  SNAPSHOT_CONFIG_DETAILS_TABLE,
  TABLES,
  TRAIN_CONFIGS_TABLE,
  TRAIN_GOAL_TRACKING_TABLE,
  TRAINING_CONFIG_DETAILS_TABLE,
  VALIDATION_CONFIG_DETAILS_TABLE,
  TRAIN_RUN_REQUESTS_TABLE,
  TRAIN_ARTIFACTS_TABLE
} = require('./table-names');

async function ensureBacktestResultsSchema(db, tableName = BACKTEST_RESULTS_TABLE) {
  await db.query(BACKTEST_RESULTS_DDL.replaceAll(BACKTEST_RESULTS_TABLE, tableName));

  await ensureColumn(db, tableName, 'result_group', `VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'logical result group' AFTER id`);
  await ensureColumn(db, tableName, 'run_id', `VARCHAR(64) NOT NULL DEFAULT '' COMMENT 'single training or validation run id' AFTER result_group`);
  await ensureColumn(db, tableName, 'train_id', `VARCHAR(100) NULL COMMENT 'root training lineage id' AFTER run_id`);
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
  await ensureIndex(
    db,
    tableName,
    'idx_result_group_run_rank',
    'INDEX idx_result_group_run_rank (result_group, run_id, score, return_pct, total_pnl, strategy_name)'
  );
  await ensureIndex(db, tableName, 'idx_train_id', 'INDEX idx_train_id (train_id)');
  await ensureIndex(db, tableName, 'idx_symbol_mode', 'INDEX idx_symbol_mode (symbol, mode)');
  await ensureIndex(db, tableName, 'uniq_result_group_run_strategy', 'UNIQUE INDEX uniq_result_group_run_strategy (result_group, run_id, strategy_name)');
}

async function ensureTrainConfigsSchema(db) {
  await db.query(TRAIN_CONFIGS_DDL);
  await db.query(TRAINING_CONFIG_DETAILS_DDL);
  await db.query(VALIDATION_CONFIG_DETAILS_DDL);
  await db.query(SNAPSHOT_CONFIG_DETAILS_DDL);
  await db.query(ROLLING_POOL_DETAILS_DDL);
  await db.query(ROLLING_RULE_DETAILS_DDL);
  await db.query(ROUTER_CONFIG_DETAILS_DDL);
  await db.query(POLICY_CONFIG_DETAILS_DDL);
  await db.query(GENERIC_CONFIG_DETAILS_DDL);

  await ensureColumn(db, TRAIN_CONFIGS_TABLE, 'train_id', `VARCHAR(100) NULL COMMENT 'root training lineage id' AFTER training_year`);
  await ensureColumn(db, TRAIN_CONFIGS_TABLE, 'parent_config_id', `INT NULL COMMENT 'upstream config version id' AFTER train_id`);
  await ensureColumn(db, TRAIN_CONFIGS_TABLE, 'version_no', `INT NOT NULL DEFAULT 1 COMMENT 'monotonic version within config key' AFTER parent_config_id`);
  await ensureColumn(db, TRAIN_CONFIGS_TABLE, 'status', `VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'draft / active / archived' AFTER version_no`);
  await ensureIndex(db, TRAIN_CONFIGS_TABLE, 'uniq_config_key_version', 'UNIQUE INDEX uniq_config_key_version (config_key, version_no)');
  await ensureIndex(db, TRAIN_CONFIGS_TABLE, 'idx_train_id', 'INDEX idx_train_id (train_id)');
  await ensureIndex(db, TRAIN_CONFIGS_TABLE, 'idx_parent_config_id', 'INDEX idx_parent_config_id (parent_config_id)');
  await ensureIndex(db, TRAIN_CONFIGS_TABLE, 'idx_config_key_status', 'INDEX idx_config_key_status (config_key, status, updated_at)');
  await dropIndexIfExists(db, TRAIN_CONFIGS_TABLE, 'idx_synced_at');
  await dropIndexIfExists(db, TRAIN_CONFIGS_TABLE, 'uniq_config_key');
  await dropColumnIfExists(db, TRAIN_CONFIGS_TABLE, 'file_mtime');
  await dropColumnIfExists(db, TRAIN_CONFIGS_TABLE, 'synced_at');
  await dropColumnIfExists(db, TRAIN_CONFIGS_TABLE, 'file_path');
  await dropColumnIfExists(db, TRAIN_CONFIGS_TABLE, 'file_name');
  await dropColumnIfExists(db, TRAIN_CONFIGS_TABLE, 'content');

  await ensureIndex(db, ROLLING_POOL_DETAILS_TABLE, 'uniq_config_month', 'UNIQUE INDEX uniq_config_month (config_id, month_key)');
  await ensureIndex(db, ROLLING_POOL_DETAILS_TABLE, 'idx_month_key', 'INDEX idx_month_key (month_key)');
  await ensureIndex(db, ROLLING_RULE_DETAILS_TABLE, 'uniq_config_layer_rule', 'UNIQUE INDEX uniq_config_layer_rule (config_id, layer_key, rule_id)');
  await ensureIndex(db, ROLLING_RULE_DETAILS_TABLE, 'idx_layer_key', 'INDEX idx_layer_key (layer_key)');
}

async function ensureTrainRunRequestsSchema(db) {
  await db.query(TRAIN_RUN_REQUESTS_DDL);
  await ensureColumn(db, TRAIN_RUN_REQUESTS_TABLE, 'train_id', `VARCHAR(100) NULL COMMENT 'root training lineage id' AFTER config_type`);
  await ensureIndex(db, TRAIN_RUN_REQUESTS_TABLE, 'idx_train_id', 'INDEX idx_train_id (train_id)');
  await ensureColumn(db, TRAIN_RUN_REQUESTS_TABLE, 'execution_pid', 'INT NULL AFTER worker_pid');
  await ensureColumn(db, TRAIN_RUN_REQUESTS_TABLE, 'cancel_requested', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER execution_pid');
}

async function ensureTrainGoalTrackingSchema(db) {
  await db.query(TRAIN_GOAL_TRACKING_DDL);
  await ensureIndex(db, TRAIN_GOAL_TRACKING_TABLE, 'uniq_train_goal_tracking', 'UNIQUE INDEX uniq_train_goal_tracking (train_id, config_id)');
  await ensureIndex(db, TRAIN_GOAL_TRACKING_TABLE, 'idx_train_id', 'INDEX idx_train_id (train_id)');
  await ensureIndex(db, TRAIN_GOAL_TRACKING_TABLE, 'idx_config_id', 'INDEX idx_config_id (config_id)');
  await ensureIndex(db, TRAIN_GOAL_TRACKING_TABLE, 'idx_symbol_updated_at', 'INDEX idx_symbol_updated_at (symbol, updated_at)');
}

async function ensureTrainArtifactsSchema(db) {
  await db.query(TRAIN_ARTIFACTS_DDL);
  await ensureIndex(db, TRAIN_ARTIFACTS_TABLE, 'uniq_artifact_key', 'UNIQUE INDEX uniq_artifact_key (artifact_key)');
  await ensureIndex(db, TRAIN_ARTIFACTS_TABLE, 'idx_type_updated_at', 'INDEX idx_type_updated_at (artifact_type, updated_at)');
  await ensureIndex(db, TRAIN_ARTIFACTS_TABLE, 'idx_train_type_updated_at', 'INDEX idx_train_type_updated_at (train_id, artifact_type, updated_at)');
  await ensureIndex(db, TRAIN_ARTIFACTS_TABLE, 'idx_symbol_type_period', 'INDEX idx_symbol_type_period (symbol, artifact_type, period_start_ms, period_end_ms)');
  await ensureIndex(db, TRAIN_ARTIFACTS_TABLE, 'idx_config_key', 'INDEX idx_config_key (config_key)');
}

async function ensureFeatureMemorySchema(db) {
  const ddls = [
    TRAIN_RUNS_DDL,
    MARKET_WINDOWS_DDL,
    FEATURE_MEMORIES_DDL,
    STRATEGY_DEFINITIONS_DDL,
    STRATEGY_PARAMETER_SETS_DDL,
    STRATEGY_LIBRARY_MEMBERS_DDL,
    FEATURE_MATCHES_DDL,
    FEATURE_CANDIDATE_POOLS_DDL,
    FEATURE_CANDIDATE_POOL_ITEMS_DDL,
    WINDOW_STRATEGY_EVALUATIONS_DDL,
    WINDOW_BEST_ACTIONS_DDL,
    UNKNOWN_FEATURE_EVENTS_DDL,
    FEATURE_WRITEBACKS_DDL,
    ANALYSIS_ARTIFACTS_DDL,
    FEATURE_EMBEDDINGS_DDL
  ];

  for (const ddl of ddls) {
    await db.query(ddl);
  }
}

async function ensureTrainDataTraceSchema(db) {
  await ensureColumn(db, TABLES.STRATEGIES, 'train_id', `VARCHAR(100) NULL COMMENT 'root training lineage id' AFTER name`);
  await ensureIndex(db, TABLES.STRATEGIES, 'idx_train_id', 'INDEX idx_train_id (train_id)');

  await ensureColumn(db, TABLES.TRADES, 'train_id', `VARCHAR(100) NULL COMMENT 'root training lineage id' AFTER strategy_name`);
  await ensureIndex(db, TABLES.TRADES, 'idx_train_id', 'INDEX idx_train_id (train_id)');

  await ensureColumn(db, TABLES.TASKS, 'train_id', `VARCHAR(100) NULL COMMENT 'root training lineage id' AFTER task_id`);
  await ensureIndex(db, TABLES.TASKS, 'idx_train_id', 'INDEX idx_train_id (train_id)');
}

module.exports = {
  ensureBacktestResultsSchema,
  ensureTrainConfigsSchema,
  ensureTrainRunRequestsSchema,
  ensureTrainDataTraceSchema,
  ensureTrainGoalTrackingSchema,
  ensureTrainArtifactsSchema,
  ensureFeatureMemorySchema
};
