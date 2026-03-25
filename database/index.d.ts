export const KLINES_DDL: string;
export const BACKTEST_RESULTS_DDL: string;
export const STRATEGIES_DDL: string;
export const TASKS_DDL: string;
export const TRADES_DDL: string;
export const TRAIN_CONFIGS_DDL: string;
export const TRAINING_CONFIG_DETAILS_DDL: string;
export const VALIDATION_CONFIG_DETAILS_DDL: string;
export const SNAPSHOT_CONFIG_DETAILS_DDL: string;
export const ROLLING_POOL_DETAILS_DDL: string;
export const ROLLING_RULE_DETAILS_DDL: string;
export const ROUTER_CONFIG_DETAILS_DDL: string;
export const POLICY_CONFIG_DETAILS_DDL: string;
export const GENERIC_CONFIG_DETAILS_DDL: string;
export const TRAIN_RUN_REQUESTS_DDL: string;
export const TRAIN_GOAL_TRACKING_DDL: string;
export const TRAIN_ARTIFACTS_DDL: string;
export const TRAIN_RUNS_DDL: string;
export const MARKET_WINDOWS_DDL: string;
export const FEATURE_MEMORIES_DDL: string;
export const FEATURE_MATCHES_DDL: string;
export const STRATEGY_DEFINITIONS_DDL: string;
export const STRATEGY_PARAMETER_SETS_DDL: string;
export const STRATEGY_LIBRARY_MEMBERS_DDL: string;
export const FEATURE_CANDIDATE_POOLS_DDL: string;
export const FEATURE_CANDIDATE_POOL_ITEMS_DDL: string;
export const WINDOW_STRATEGY_EVALUATIONS_DDL: string;
export const WINDOW_BEST_ACTIONS_DDL: string;
export const UNKNOWN_FEATURE_EVENTS_DDL: string;
export const FEATURE_WRITEBACKS_DDL: string;
export const ANALYSIS_ARTIFACTS_DDL: string;
export const FEATURE_EMBEDDINGS_DDL: string;
export const INIT_DDLS: readonly string[];
export const ANALYSIS_ARTIFACTS_TABLE: "analysis_artifacts";
export const BACKTEST_RESULTS_TABLE: "backtest_results";
export const FEATURE_CANDIDATE_POOLS_TABLE: "feature_candidate_pools";
export const FEATURE_CANDIDATE_POOL_ITEMS_TABLE: "feature_candidate_pool_items";
export const FEATURE_EMBEDDINGS_TABLE: "feature_embeddings";
export const FEATURE_MATCHES_TABLE: "feature_matches";
export const FEATURE_MEMORIES_TABLE: "feature_memories";
export const FEATURE_WRITEBACKS_TABLE: "feature_writebacks";
export const MARKET_WINDOWS_TABLE: "market_windows";
export const STRATEGY_DEFINITIONS_TABLE: "strategy_definitions";
export const STRATEGY_LIBRARY_MEMBERS_TABLE: "strategy_library_members";
export const STRATEGY_PARAMETER_SETS_TABLE: "strategy_parameter_sets";
export const TRAIN_CONFIGS_TABLE: "train_configs";
export const TRAIN_GOAL_TRACKING_TABLE: "train_goal_tracking";
export const TRAINING_CONFIG_DETAILS_TABLE: "training_config_details";
export const TRAIN_RUNS_TABLE: "train_runs";
export const VALIDATION_CONFIG_DETAILS_TABLE: "validation_config_details";
export const SNAPSHOT_CONFIG_DETAILS_TABLE: "snapshot_config_details";
export const ROLLING_POOL_DETAILS_TABLE: "rolling_pool_details";
export const ROLLING_RULE_DETAILS_TABLE: "rolling_rule_details";
export const ROUTER_CONFIG_DETAILS_TABLE: "router_config_details";
export const POLICY_CONFIG_DETAILS_TABLE: "policy_config_details";
export const GENERIC_CONFIG_DETAILS_TABLE: "generic_config_details";
export const TRAIN_RUN_REQUESTS_TABLE: "train_run_requests";
export const TRAIN_ARTIFACTS_TABLE: "train_artifacts";
export const UNKNOWN_FEATURE_EVENTS_TABLE: "unknown_feature_events";
export const WINDOW_BEST_ACTIONS_TABLE: "window_best_actions";
export const WINDOW_STRATEGY_EVALUATIONS_TABLE: "window_strategy_evaluations";
export const TABLES: {
  readonly ANALYSIS_ARTIFACTS: "analysis_artifacts";
  readonly BACKTEST_RESULTS: "backtest_results";
  readonly FEATURE_CANDIDATE_POOLS: "feature_candidate_pools";
  readonly FEATURE_CANDIDATE_POOL_ITEMS: "feature_candidate_pool_items";
  readonly FEATURE_EMBEDDINGS: "feature_embeddings";
  readonly FEATURE_MATCHES: "feature_matches";
  readonly FEATURE_MEMORIES: "feature_memories";
  readonly FEATURE_WRITEBACKS: "feature_writebacks";
  readonly KLINES: "klines";
  readonly MARKET_WINDOWS: "market_windows";
  readonly STRATEGIES: "strategies";
  readonly STRATEGY_DEFINITIONS: "strategy_definitions";
  readonly STRATEGY_LIBRARY_MEMBERS: "strategy_library_members";
  readonly STRATEGY_PARAMETER_SETS: "strategy_parameter_sets";
  readonly TASKS: "tasks";
  readonly TRADES: "trades";
  readonly TRAIN_CONFIGS: "train_configs";
  readonly TRAIN_GOAL_TRACKING: "train_goal_tracking";
  readonly TRAINING_CONFIG_DETAILS: "training_config_details";
  readonly VALIDATION_CONFIG_DETAILS: "validation_config_details";
  readonly SNAPSHOT_CONFIG_DETAILS: "snapshot_config_details";
  readonly ROLLING_POOL_DETAILS: "rolling_pool_details";
  readonly ROLLING_RULE_DETAILS: "rolling_rule_details";
  readonly ROUTER_CONFIG_DETAILS: "router_config_details";
  readonly POLICY_CONFIG_DETAILS: "policy_config_details";
  readonly GENERIC_CONFIG_DETAILS: "generic_config_details";
  readonly TRAIN_RUN_REQUESTS: "train_run_requests";
  readonly TRAIN_ARTIFACTS: "train_artifacts";
  readonly TRAIN_RUNS: "train_runs";
  readonly UNKNOWN_FEATURE_EVENTS: "unknown_feature_events";
  readonly WINDOW_BEST_ACTIONS: "window_best_actions";
  readonly WINDOW_STRATEGY_EVALUATIONS: "window_strategy_evaluations";
};

export interface QueryableDatabase {
  query<T = unknown>(sql: string, values?: unknown): Promise<T>;
}

export interface MysqlConnectionDefaults {
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly password?: string;
  readonly database?: string;
}

export interface MysqlConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly charset: string;
  readonly connectionLimit?: number;
  readonly queueLimit?: number;
  readonly waitForConnections?: boolean;
  readonly enableKeepAlive?: boolean;
  readonly keepAliveInitialDelay?: number;
}

export function ensureKlineSchema(db: QueryableDatabase): Promise<void>;
export function ensureBacktestResultsSchema(db: QueryableDatabase, tableName?: string): Promise<void>;
export function ensureTrainDataTraceSchema(db: QueryableDatabase): Promise<void>;
export function ensureTrainConfigsSchema(db: QueryableDatabase): Promise<void>;
export function ensureTrainGoalTrackingSchema(db: QueryableDatabase): Promise<void>;
export function ensureTrainRunRequestsSchema(db: QueryableDatabase): Promise<void>;
export function ensureTrainArtifactsSchema(db: QueryableDatabase): Promise<void>;
export function ensureFeatureMemorySchema(db: QueryableDatabase): Promise<void>;
export function tableExists(db: QueryableDatabase, tableName: string): Promise<boolean>;
export function allTablesExist(db: QueryableDatabase, tableNames: readonly string[]): Promise<boolean>;
export function loadEnvFiles(dotenvModule: { config(options?: { path?: string }): unknown }, envPaths: readonly string[]): void;
export function getMysqlConnectionOptions(options?: {
  readonly defaults?: MysqlConnectionDefaults;
  readonly overrides?: Record<string, unknown>;
}): MysqlConnectionOptions;
export function createMysqlPromisePool(
  mysqlModule: { createPool(options: MysqlConnectionOptions): unknown },
  options?: {
    readonly defaults?: MysqlConnectionDefaults;
    readonly overrides?: Record<string, unknown>;
  }
): any;
export function warmupMysqlConnection(
  db: any,
  options?: {
    readonly successMessage?: string;
    readonly failureMessage?: string;
  }
): Promise<void>;
export function createMysqlConnectionWithFallback(
  mysqlPromiseModule: { createConnection(options: MysqlConnectionOptions): Promise<any> },
  options?: {
    readonly defaults?: MysqlConnectionDefaults;
    readonly overrides?: Record<string, unknown>;
    readonly fallbackHost?: string;
  }
): Promise<any>;
