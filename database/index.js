const { BACKTEST_RESULTS_DDL } = require('./src/backtest-results.schema');
const { KLINES_DDL, ensureKlineSchema } = require('./src/klines.schema');
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
} = require('./src/table-names');
const { allTablesExist, tableExists } = require('./src/table-checks');
const {
  createMysqlConnectionWithFallback,
  createMysqlPromisePool,
  getMysqlConnectionOptions,
  loadEnvFiles,
  warmupMysqlConnection
} = require('./src/mysql-config');
const {
  ensureBacktestResultsSchema,
  ensureTrainDataTraceSchema,
  ensureTrainConfigsSchema,
  ensureTrainRunRequestsSchema,
  ensureTrainGoalTrackingSchema,
  ensureTrainArtifactsSchema
} = require('./src/train-schema');
const { STRATEGIES_DDL } = require('./src/strategies.schema');
const { TASKS_DDL } = require('./src/tasks.schema');
const { TRADES_DDL } = require('./src/trades.schema');
const { TRAIN_CONFIGS_DDL } = require('./src/train-configs.schema');
const {
  GENERIC_CONFIG_DETAILS_DDL,
  POLICY_CONFIG_DETAILS_DDL,
  ROLLING_POOL_DETAILS_DDL,
  ROLLING_RULE_DETAILS_DDL,
  ROUTER_CONFIG_DETAILS_DDL,
  SNAPSHOT_CONFIG_DETAILS_DDL,
  TRAINING_CONFIG_DETAILS_DDL,
  VALIDATION_CONFIG_DETAILS_DDL
} = require('./src/train-configs.schema');
const { TRAIN_RUN_REQUESTS_DDL } = require('./src/train-run-requests.schema');
const { TRAIN_GOAL_TRACKING_DDL } = require('./src/train-goal-tracking.schema');
const { TRAIN_ARTIFACTS_DDL } = require('./src/train-artifacts.schema');

const INIT_DDLS = [
  KLINES_DDL,
  TRADES_DDL,
  STRATEGIES_DDL,
  BACKTEST_RESULTS_DDL,
  TASKS_DDL,
  TRAIN_CONFIGS_DDL,
  TRAINING_CONFIG_DETAILS_DDL,
  VALIDATION_CONFIG_DETAILS_DDL,
  SNAPSHOT_CONFIG_DETAILS_DDL,
  ROLLING_POOL_DETAILS_DDL,
  ROLLING_RULE_DETAILS_DDL,
  ROUTER_CONFIG_DETAILS_DDL,
  POLICY_CONFIG_DETAILS_DDL,
  GENERIC_CONFIG_DETAILS_DDL,
  TRAIN_RUN_REQUESTS_DDL,
  TRAIN_GOAL_TRACKING_DDL,
  TRAIN_ARTIFACTS_DDL
];

module.exports = {
  BACKTEST_RESULTS_TABLE,
  BACKTEST_RESULTS_DDL,
  GENERIC_CONFIG_DETAILS_DDL,
  GENERIC_CONFIG_DETAILS_TABLE,
  INIT_DDLS,
  KLINES_DDL,
  POLICY_CONFIG_DETAILS_DDL,
  POLICY_CONFIG_DETAILS_TABLE,
  ROLLING_POOL_DETAILS_DDL,
  ROLLING_POOL_DETAILS_TABLE,
  ROLLING_RULE_DETAILS_DDL,
  ROLLING_RULE_DETAILS_TABLE,
  ROUTER_CONFIG_DETAILS_DDL,
  ROUTER_CONFIG_DETAILS_TABLE,
  SNAPSHOT_CONFIG_DETAILS_DDL,
  SNAPSHOT_CONFIG_DETAILS_TABLE,
  STRATEGIES_DDL,
  TABLES,
  TASKS_DDL,
  TRADES_DDL,
  TRAIN_CONFIGS_TABLE,
  TRAIN_CONFIGS_DDL,
  TRAIN_GOAL_TRACKING_DDL,
  TRAIN_GOAL_TRACKING_TABLE,
  TRAIN_ARTIFACTS_DDL,
  TRAIN_ARTIFACTS_TABLE,
  TRAINING_CONFIG_DETAILS_DDL,
  TRAINING_CONFIG_DETAILS_TABLE,
  TRAIN_RUN_REQUESTS_TABLE,
  TRAIN_RUN_REQUESTS_DDL,
  VALIDATION_CONFIG_DETAILS_DDL,
  VALIDATION_CONFIG_DETAILS_TABLE,
  allTablesExist,
  createMysqlConnectionWithFallback,
  createMysqlPromisePool,
  ensureBacktestResultsSchema,
  ensureTrainDataTraceSchema,
  ensureTrainConfigsSchema,
  ensureTrainArtifactsSchema,
  ensureTrainGoalTrackingSchema,
  ensureTrainRunRequestsSchema,
  ensureKlineSchema,
  getMysqlConnectionOptions,
  loadEnvFiles,
  tableExists,
  warmupMysqlConnection
};
