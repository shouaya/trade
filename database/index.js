const { BACKTEST_RESULTS_DDL } = require('./src/backtest-results.schema');
const { KLINES_DDL, ensureKlineSchema } = require('./src/klines.schema');
const {
  BACKTEST_RESULTS_TABLE,
  TABLES,
  TRAIN_CONFIGS_TABLE,
  TRAIN_RUN_REQUESTS_TABLE
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
  ensureTrainConfigsSchema,
  ensureTrainRunRequestsSchema
} = require('./src/train-schema');
const { STRATEGIES_DDL } = require('./src/strategies.schema');
const { TASKS_DDL } = require('./src/tasks.schema');
const { TRADES_DDL } = require('./src/trades.schema');
const { TRAIN_CONFIGS_DDL } = require('./src/train-configs.schema');
const { TRAIN_RUN_REQUESTS_DDL } = require('./src/train-run-requests.schema');

const INIT_DDLS = [
  KLINES_DDL,
  TRADES_DDL,
  STRATEGIES_DDL,
  BACKTEST_RESULTS_DDL,
  TASKS_DDL,
  TRAIN_CONFIGS_DDL,
  TRAIN_RUN_REQUESTS_DDL
];

module.exports = {
  BACKTEST_RESULTS_TABLE,
  BACKTEST_RESULTS_DDL,
  INIT_DDLS,
  KLINES_DDL,
  STRATEGIES_DDL,
  TABLES,
  TASKS_DDL,
  TRADES_DDL,
  TRAIN_CONFIGS_TABLE,
  TRAIN_CONFIGS_DDL,
  TRAIN_RUN_REQUESTS_TABLE,
  TRAIN_RUN_REQUESTS_DDL,
  allTablesExist,
  createMysqlConnectionWithFallback,
  createMysqlPromisePool,
  ensureBacktestResultsSchema,
  ensureTrainConfigsSchema,
  ensureTrainRunRequestsSchema,
  ensureKlineSchema,
  getMysqlConnectionOptions,
  loadEnvFiles,
  tableExists,
  warmupMysqlConnection
};
