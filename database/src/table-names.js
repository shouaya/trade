const TABLES = Object.freeze({
  BACKTEST_RESULTS: 'backtest_results',
  KLINES: 'klines',
  STRATEGIES: 'strategies',
  TASKS: 'tasks',
  TRADES: 'trades',
  TRAIN_CONFIGS: 'train_configs',
  TRAIN_RUN_REQUESTS: 'train_run_requests'
});

module.exports = {
  BACKTEST_RESULTS_TABLE: TABLES.BACKTEST_RESULTS,
  TABLES,
  TRAIN_CONFIGS_TABLE: TABLES.TRAIN_CONFIGS,
  TRAIN_RUN_REQUESTS_TABLE: TABLES.TRAIN_RUN_REQUESTS
};
