import type { BacktestResult, BacktestStats, TradeRecord } from '../types';

type JsonObject = Record<string, any>;

export interface TimeRangeLike {
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly startIso?: string;
  readonly endIso?: string;
}

function toTimeRange(value: unknown): TimeRangeLike | null {
  const source = value && typeof value === 'object' ? value as JsonObject : null;
  if (!source) {
    return null;
  }

  const startTimeMs = Number(source['startTimeMs'] ?? (source['startIso'] ? Date.parse(String(source['startIso'])) : Number.NaN));
  const endTimeMs = Number(source['endTimeMs'] ?? (source['endIso'] ? Date.parse(String(source['endIso'])) : Number.NaN));
  if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs)) {
    return null;
  }

  return {
    startTimeMs,
    endTimeMs,
    ...(source['startIso'] ? { startIso: String(source['startIso']) } : {}),
    ...(source['endIso'] ? { endIso: String(source['endIso']) } : {}),
  };
}

function finalizeTimeRange(range: TimeRangeLike): TimeRangeLike {
  return {
    startTimeMs: range.startTimeMs,
    endTimeMs: range.endTimeMs,
    startIso: range.startIso ?? new Date(range.startTimeMs).toISOString(),
    endIso: range.endIso ?? new Date(range.endTimeMs).toISOString(),
  };
}

export function resolveEvaluationTimeRange(config: unknown): TimeRangeLike {
  const source = config && typeof config === 'object' ? config as JsonObject : {};
  const validationTarget = source['validationTarget'] && typeof source['validationTarget'] === 'object'
    ? source['validationTarget'] as JsonObject
    : {};

  const explicitEvaluation = toTimeRange(validationTarget['evaluationTimeRange']);
  if (explicitEvaluation) {
    return finalizeTimeRange(explicitEvaluation);
  }

  const targetRange = toTimeRange({
    startTimeMs: validationTarget['startTimeMs'],
    endTimeMs: validationTarget['endTimeMs'],
    startIso: validationTarget['startIso'],
    endIso: validationTarget['endIso'],
  });
  if (targetRange) {
    return finalizeTimeRange(targetRange);
  }

  const configRange = toTimeRange(source['timeRange']);
  if (!configRange) {
    throw new Error('evaluation timeRange is missing');
  }

  return finalizeTimeRange(configRange);
}

export function resolveExecutionTimeRange(config: unknown): TimeRangeLike {
  const source = config && typeof config === 'object' ? config as JsonObject : {};
  const validationTarget = source['validationTarget'] && typeof source['validationTarget'] === 'object'
    ? source['validationTarget'] as JsonObject
    : {};

  const explicitExecution = toTimeRange(validationTarget['executionTimeRange']);
  if (explicitExecution) {
    return finalizeTimeRange(explicitExecution);
  }

  const configRange = toTimeRange(source['timeRange']);
  if (!configRange) {
    throw new Error('execution timeRange is missing');
  }

  return finalizeTimeRange(configRange);
}

export function filterTradesByExitTime(
  trades: readonly TradeRecord[],
  range: TimeRangeLike
): readonly TradeRecord[] {
  return trades.filter((trade) => {
    const exitTime = Number(trade.exit_time);
    return Number.isFinite(exitTime)
      && exitTime >= range.startTimeMs
      && exitTime <= range.endTimeMs;
  });
}

function calculateMaxDrawdown(pnlSeries: readonly number[]): number {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const pnl of pnlSeries) {
    equity += pnl;
    if (equity > peak) {
      peak = equity;
    }
    if (peak - equity > maxDrawdown) {
      maxDrawdown = peak - equity;
    }
  }

  return maxDrawdown;
}

function calculateSharpeRatio(pnlSeries: readonly number[], avgPnl: number): number {
  if (pnlSeries.length <= 1) {
    return 0;
  }

  const variance = pnlSeries.reduce((sum, pnl) => sum + ((pnl - avgPnl) ** 2), 0) / (pnlSeries.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) {
    return 0;
  }

  return avgPnl / stdDev;
}

export function rebuildBacktestResultFromTrades(
  trades: readonly TradeRecord[],
  initialCapital: number
): BacktestResult {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      stats: {
        totalTrades: 0,
        grossPnl: 0,
        totalCommission: 0,
        totalPnl: 0,
        returnPct: 0,
        winRate: 0,
        avgPnl: 0,
        maxDrawdown: 0,
        maxDrawdownPct: 0,
        sharpeRatio: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        score: 0,
      },
      trades,
    };
  }

  const pnlSeries = trades.map((trade) => Number(trade.pnl || 0));
  const grossPnlSeries = trades.map((trade) => Number(trade.gross_pnl ?? trade.pnl ?? 0));
  const commissionSeries = trades.map((trade) => Number(trade.commission_fee ?? 0));
  const totalPnl = pnlSeries.reduce((sum, pnl) => sum + pnl, 0);
  const grossPnl = grossPnlSeries.reduce((sum, pnl) => sum + pnl, 0);
  const totalCommission = commissionSeries.reduce((sum, fee) => sum + fee, 0);
  const wins = pnlSeries.filter((pnl) => pnl > 0);
  const losses = pnlSeries.filter((pnl) => pnl <= 0);
  const avgPnl = totalPnl / totalTrades;
  const avgWin = wins.length ? wins.reduce((sum, pnl) => sum + pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((sum, pnl) => sum + pnl, 0) / losses.length : 0;
  const winRate = wins.length / totalTrades;
  const maxDrawdown = calculateMaxDrawdown(pnlSeries);
  const returnPct = initialCapital !== 0 ? (totalPnl / initialCapital) * 100 : 0;
  const maxDrawdownPct = initialCapital !== 0 ? (maxDrawdown / initialCapital) * 100 : 0;
  const sharpeRatio = calculateSharpeRatio(pnlSeries, avgPnl);
  const grossProfit = wins.reduce((sum, pnl) => sum + pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, pnl) => sum + pnl, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Number.POSITIVE_INFINITY : 0) : grossProfit / grossLoss;

  const stats: BacktestStats = {
    totalTrades,
    grossPnl,
    totalCommission,
    totalPnl,
    returnPct,
    winRate,
    avgPnl,
    maxDrawdown,
    maxDrawdownPct,
    sharpeRatio,
    avgWin,
    avgLoss,
    profitFactor,
    score: (returnPct * 0.4) + (winRate * 100 * 0.2) + (profitFactor * 10 * 0.2) + (sharpeRatio * 10 * 0.2),
  };

  return {
    stats,
    trades,
  };
}

export function narrowBacktestResultToEvaluationRange(
  result: BacktestResult,
  range: TimeRangeLike,
  initialCapital: number
): BacktestResult {
  return rebuildBacktestResultFromTrades(
    filterTradesByExitTime(result.trades, range),
    initialCapital
  );
}
