export const KLINES_DDL: string;
export const BACKTEST_RESULTS_DDL: string;
export const STRATEGIES_DDL: string;
export const TASKS_DDL: string;
export const TRADES_DDL: string;
export const TRAIN_CONFIGS_DDL: string;
export const TRAIN_RUN_REQUESTS_DDL: string;
export const INIT_DDLS: readonly string[];
export const BACKTEST_RESULTS_TABLE: "backtest_results";
export const TRAIN_CONFIGS_TABLE: "train_configs";
export const TRAIN_RUN_REQUESTS_TABLE: "train_run_requests";
export const TABLES: {
  readonly BACKTEST_RESULTS: "backtest_results";
  readonly KLINES: "klines";
  readonly STRATEGIES: "strategies";
  readonly TASKS: "tasks";
  readonly TRADES: "trades";
  readonly TRAIN_CONFIGS: "train_configs";
  readonly TRAIN_RUN_REQUESTS: "train_run_requests";
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
export function ensureTrainConfigsSchema(db: QueryableDatabase): Promise<void>;
export function ensureTrainRunRequestsSchema(db: QueryableDatabase): Promise<void>;
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
