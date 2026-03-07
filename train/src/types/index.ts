/**
 * Type Definitions for Trading System
 */

// ============================================================================
// Database Types
// ============================================================================

export interface KlineData {
  readonly id: number;
  readonly open_time: string;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly bid_open?: string | null;
  readonly bid_high?: string | null;
  readonly bid_low?: string | null;
  readonly bid_close?: string | null;
  readonly ask_open?: string | null;
  readonly ask_high?: string | null;
  readonly ask_low?: string | null;
  readonly ask_close?: string | null;
  readonly volume: string | null;
  readonly symbol: string;
  readonly interval_type: string;
}

export interface TradeRecord {
  readonly id?: number | undefined;
  readonly direction: 'long' | 'short';
  readonly entry_time: number;
  readonly entry_price: number;
  readonly entry_index: number;
  readonly entry_rsi: number | null;
  readonly entry_macd?: number | null | undefined;
  readonly entry_macd_signal?: number | null | undefined;
  readonly entry_macd_histogram?: number | null | undefined;
  readonly lot_size: number;
  readonly stop_loss: number | null;
  readonly take_profit: number | null;
  readonly hold_minutes: number | null;
  readonly exit_time: number;
  readonly exit_price: number;
  readonly exit_rsi?: number | null | undefined;
  readonly exit_macd?: number | null | undefined;
  readonly exit_macd_signal?: number | null | undefined;
  readonly exit_macd_histogram?: number | null | undefined;
  readonly exit_reason: ExitReason;
  readonly pnl: number;
  readonly pips?: number | undefined;
  readonly percent?: number | undefined;
  readonly actual_hold_minutes: number;
  readonly strategy_name: string;
  readonly symbol: string;
  readonly created_at?: Date | undefined;
}

export type ExitReason =
  | 'stop_loss'
  | 'take_profit'
  | 'hold_time_reached'
  | 'trailing_stop'
  | 'rsi_revert'
  | 'no_overnight'
  | 'no_weekend'
  | 'backtest_end';

export interface Task {
  readonly task_id: string;
  readonly config_name: string;
  readonly description: string;
  readonly pid: number;
  readonly status: TaskStatus;
  readonly started_at: Date;
  readonly completed_at: Date | null;
}

export type TaskStatus = 'running' | 'completed' | 'failed';

// ============================================================================
// Strategy Types
// ============================================================================

export interface Strategy {
  readonly id: number;
  readonly name: string;
  readonly type: StrategyType;
  readonly parameters: StrategyParameters;
}

export type StrategyType = 'rsi_only';

export interface StrategyParameters {
  readonly grid?: GridParameters;
  readonly rsi: RSIParameters;
  readonly macd?: MACDParameters;
  readonly risk: RiskParameters;
  readonly atr?: ATRParameters;
  readonly tradingSchedule?: string;
  readonly tradingTimeRestriction?: TimeRestriction | null;
}

export interface GridParameters {
  readonly enabled: boolean;
  readonly levels?: number;
  readonly rangePercent?: number;
  readonly profitPerGrid?: number;
}

export interface RSIParameters {
  readonly enabled: boolean;
  readonly period: number;
  readonly oversold?: number;
  readonly overbought?: number;
}

export interface MACDParameters {
  readonly enabled: boolean;
  readonly fastPeriod?: number;
  readonly slowPeriod?: number;
  readonly signalPeriod?: number;
}

export interface RiskParameters {
  readonly maxPositions: number;
  readonly lotSize: number;
  readonly stopLossPercent: number | null;
  readonly takeProfitPercent: number | null;
  readonly maxHoldMinutes: number | null;
}

export interface ATRParameters {
  readonly slMultiplier: number;
  readonly tpMultiplier: number;
}

export interface TimeRestriction {
  readonly enabled: boolean;
  readonly utcExcludeStart?: string;
  readonly utcExcludeEnd?: string;
}

// ============================================================================
// Position Types
// ============================================================================

export interface Position {
  readonly direction: 'long' | 'short';
  readonly entry_time: number;
  readonly entry_price: number;
  readonly entry_index: number;
  readonly entry_rsi: number | null;
  readonly lot_size: number;
  readonly stop_loss: number | null;
  readonly take_profit: number | null;
  readonly hold_minutes: number | null;
  readonly strategy_name: string;
  readonly symbol: string;
  trailingActivated: boolean;
  trailingStopPrice: number | null;
}

export interface TrailingConfig {
  readonly activationPercent: number;
  readonly lockProfitPercent: number;
  readonly lockProfitAmount: number;
}

// ============================================================================
// Backtest Types
// ============================================================================

export interface BacktestStats {
  readonly totalTrades: number;
  readonly totalPnl: number;
  readonly winRate: number;
  readonly avgPnl: number;
  readonly maxDrawdown: number;
  readonly sharpeRatio: number;
  readonly avgWin: number;
  readonly avgLoss: number;
  readonly profitFactor: number;
  readonly score: number;
}

export interface BacktestResult {
  readonly stats: BacktestStats;
  readonly trades: readonly TradeRecord[];
}

export interface ExecutorOptions {
  readonly enableMA200Filter?: boolean;
  readonly enableSlippage?: boolean;
  readonly enableMultiTimeframe?: boolean;
  readonly enableATRSizing?: boolean;
  readonly enableTrailingStop?: boolean;
  readonly enableRSIReversion?: boolean;
  readonly trailingConfig?: TrailingConfig;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface TrainingConfig {
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly symbol: string;
  readonly intervalType: string;
  readonly tableName: string;
  readonly topN: number;
  readonly retainDays: number;
  readonly strategyNamePrefix: string;
  readonly descriptionPrefix: string;
}

export interface ValidationConfig {
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly symbol: string;
  readonly intervalType: string;
  readonly strategyNames: readonly string[];
}

// ============================================================================
// Parameter Space Types
// ============================================================================

export interface ParameterSpace {
  readonly rsi: {
    readonly period: readonly number[];
    readonly oversold: readonly number[];
    readonly overbought: readonly number[];
  };
  readonly risk: {
    readonly maxPositions: readonly number[];
    readonly lotSize: readonly number[];
    readonly stopLossPercent: readonly (number | null)[];
    readonly takeProfitPercent: readonly (number | null)[];
    readonly maxHoldMinutes: readonly (number | null)[];
  };
  readonly atr?: {
    readonly slMultiplier: readonly number[];
    readonly tpMultiplier: readonly number[];
  } | null;
}

export interface GenerateOptions {
  readonly limit?: number | null;
  readonly types?: readonly StrategyType[] | null;
  readonly parameters?: Partial<ParameterSpace> | null;
}

// ============================================================================
// Signal Types
// ============================================================================

export type SignalDirection = 'long' | 'short' | 'hold';

export interface Signal {
  readonly direction: SignalDirection;
  readonly rsi?: number | null;
  readonly macd?: number | null;
}

// ============================================================================
// Indicator Types
// ============================================================================

export interface RSIValue {
  readonly avgGain: number;
  readonly avgLoss: number;
  readonly value: number;
}

export interface ATRValue {
  readonly tr: number;
  readonly atr: number;
}

export interface SLTPPrices {
  readonly stopLoss: number;
  readonly takeProfit: number;
}

// ============================================================================
// Database Connection Types
// ============================================================================

export interface DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

export interface TaskManagerResult {
  readonly cleaned: number;
  readonly tradesCleared: boolean;
  readonly tasks?: readonly Task[];
}

// ============================================================================
// Signal Generator Types
// ============================================================================

export interface SignalGeneratorSignals {
  readonly rsi: RSISignalInfo | null;
  readonly macd: MACDSignalInfo | null;
  readonly grid: GridSignalInfo | null;
  readonly combined: CombinedSignal | null;
}

export interface RSISignalInfo {
  readonly value: number | null;
  readonly signal: 'BUY' | 'SELL' | null;
}

export interface MACDSignalInfo {
  readonly current: MACDValueInfo | null;
  readonly signal: 'BUY' | 'SELL' | null;
  readonly crossSignal?: 'BUY' | 'SELL' | null;
  readonly value?: number;
}

export interface MACDValueInfo {
  readonly macd: number | null;
  readonly signal: number | null;
  readonly histogram: number | null;
}

export interface GridSignalInfo {
  readonly action: 'BUY' | 'SELL' | null;
  readonly level?: number;
  readonly price?: number;
  readonly reason?: string;
}

export interface CombinedSignal {
  readonly action: 'BUY' | 'SELL' | null;
  readonly reason: string;
  readonly confidence?: number | undefined;
  readonly rsiValue?: number | undefined;
  readonly macdValue?: number | undefined;
  readonly gridLevel?: number | undefined;
  readonly votes?: {
    readonly buy: number;
    readonly sell: number;
  } | undefined;
}
